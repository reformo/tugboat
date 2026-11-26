package netgw

import (
	"bytes"
	"encoding/json"
	"net/netip"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopNetworkActivityRecordsPolicyAndCountersPerGateway(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	host := hostIPv4(t)
	server := newEchoServer(t, host)
	policy := mustPolicy(t, "deny", []string{"cidr=" + host + "/32"}, nil)
	recorders := make([]*ActivityRecorder, 0, 2)
	networks := make([]*Network, 0, 2)
	for _, directory := range []string{first, second} {
		recorder, err := OpenActivity(directory)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(recorder.Close)
		network, err := New(Config{
			MTU: 1500, Subnet: testSubnet, GatewayIP: testGatewayIP, GatewayMacAddress: testGatewayMA,
			Egress: policy, Activity: recorder,
		})
		if err != nil {
			t.Fatal(err)
		}
		recorders, networks = append(recorders, recorder), append(networks, network)
	}

	member := join(t, networks[0])
	allowed := newTCPClient(member, host, server.port(), 40001)
	peer := netip.AddrPortFrom(netip.MustParseAddr(host), server.port())
	guest := netip.AddrPortFrom(netip.MustParseAddr(member.ip.String()), 40001)
	recorders[0].addActor(activityActor{Direction: "outgoing", Protocol: "tcp", Guest: guest, Peer: peer,
		Origin: "codex", Process: "curl", PID: 40})
	if !allowed.connect(t) {
		t.Fatal("the allowed destination refused the connection")
	}
	// The packet fixture does not retransmit data. Wait until the gateway has
	// processed the handshake and installed the relay before sending payload.
	deadline := time.Now().Add(time.Second)
	for {
		connected := false
		for _, row := range networkActivityRows(t, first) {
			connected = connected || row.Result == "connected"
		}
		if connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the gateway did not record the established connection")
		}
		time.Sleep(10 * time.Millisecond)
	}
	const payload = "SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3"
	if allowed.say(t, payload) != payload {
		t.Fatal("could not exchange traffic through the isolated gateway")
	}
	blocked := newTCPClient(member, "203.0.113.8", 443, 40002)
	if blocked.connect(t) {
		t.Fatal("the denied address connected")
	}
	var rows map[string]activityRow
	deadline = time.Now().Add(time.Second)
	for {
		recorders[0].flush(time.Now(), false)
		rows = networkActivityRows(t, first)
		ready := false
		for _, row := range rows {
			ready = ready || (row.Received != nil && *row.Received == uint64(len(payload)))
		}
		if ready || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(rows) != 2 || len(networkActivityRows(t, second)) != 0 {
		t.Fatalf("gateway queues were not isolated: %v", rows)
	}
	for _, row := range rows {
		if row.Direction != "outgoing" || row.Protocol != "tcp" || row.Sent == nil || row.Received == nil {
			t.Fatalf("invalid row: %+v", row)
		}
		switch row.Result {
		case "connected":
			if row.Endpoint != peer.String() || row.Origin != "codex" || row.Process != "curl" || row.PID != 40 ||
				*row.Sent != uint64(len(payload)) || *row.Received != uint64(len(payload)) {
				t.Fatalf("invalid successful row: %+v, sent %d, received %d", row, *row.Sent, *row.Received)
			}
		case "blocked":
			if row.Endpoint != "203.0.113.8:443" || row.Origin != "" || row.Process != "" ||
				*row.Sent != 0 || *row.Received != 0 {
				t.Fatalf("invalid denial: %+v", row)
			}
		default:
			t.Fatalf("invalid result: %+v", row)
		}
	}
}

func networkActivityRows(t *testing.T, directory string) map[string]activityRow {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(directory, "*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	rows := make(map[string]activityRow)
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte("SYNTHETIC_TUGBOAT_API_BODY_81F7A2B3")) {
			t.Fatal("the gateway kept a payload")
		}
		for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte{'\n'}) {
			if len(line) == 0 {
				continue
			}
			var row activityRow
			if err := json.Unmarshal(line, &row); err != nil {
				t.Fatal(err)
			}
			if previous := rows[row.ID]; row.Revision > previous.Revision {
				rows[row.ID] = row
			}
		}
	}
	return rows
}
