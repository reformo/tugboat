package netgw

import (
	"bytes"
	"encoding/json"
	"net"
	"net/netip"
	"time"

	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
)

const activityEvidencePort = 39473

type activityActor struct {
	Direction string         `json:"direction"`
	Protocol  string         `json:"protocol"`
	Guest     netip.AddrPort `json:"guest"`
	Peer      netip.AddrPort `json:"peer"`
	Process   string         `json:"process"`
	PID       uint32         `json:"pid"`
	Origin    string         `json:"origin"`
	expires   time.Time
	ambiguous bool
}

func endpoint(address net.Addr) netip.AddrPort {
	switch address := address.(type) {
	case *net.TCPAddr:
		return netip.AddrPortFrom(address.AddrPort().Addr().Unmap(), address.AddrPort().Port())
	case *net.UDPAddr:
		return netip.AddrPortFrom(address.AddrPort().Addr().Unmap(), address.AddrPort().Port())
	}
	return netip.AddrPort{}
}

func (r *ActivityRecorder) listenForActors(s *stack.Stack, gateway tcpip.Address) {
	if r == nil {
		return
	}
	connection, err := gonet.DialUDP(s, &tcpip.FullAddress{NIC: nicID, Addr: gateway, Port: activityEvidencePort}, nil, ipv4.ProtocolNumber)
	if err != nil {
		r.incomplete()
		return
	}
	go func() {
		defer connection.Close()
		buffer := make([]byte, 1025)
		for {
			count, source, err := connection.ReadFrom(buffer)
			if err != nil {
				return
			}
			if count > 1024 {
				continue
			}
			var actor activityActor
			decode := json.NewDecoder(bytes.NewReader(buffer[:count]))
			decode.DisallowUnknownFields()
			if decode.Decode(&actor) != nil {
				continue
			}
			if count == 0 || !actor.valid(endpoint(source).Addr().Unmap()) {
				continue
			}
			r.addActor(actor)
		}
	}()
}

func (a activityActor) valid(source netip.Addr) bool {
	if !a.Guest.IsValid() || !a.Peer.IsValid() || a.Guest.Addr() != source ||
		a.Guest.Port() == 0 || a.Peer.Port() == 0 || a.PID == 0 ||
		(a.Direction != "incoming" && a.Direction != "outgoing") ||
		(a.Protocol != "tcp" && a.Protocol != "udp") ||
		(a.Origin != "" && a.Origin != "codex" && a.Origin != "claude-code" && a.Origin != "guest-terminal") ||
		len(a.Process) > 64 {
		return false
	}
	for _, b := range []byte(a.Process) {
		if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' ||
			b == '.' || b == '_' || b == '-' || b == '+') {
			return false
		}
	}
	return true
}

func (r *ActivityRecorder) addActor(actor activityActor) {
	socket := activitySocket{actor.Direction, actor.Protocol, actor.Guest, actor.Peer}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	actor.expires = now.Add(3 * time.Second)
	var matched *activityFlow
	for flow := range r.flows {
		if flow.socket != socket || (flow.done && now.After(flow.expires)) {
			continue
		}
		if matched != nil {
			matched.clearActor()
			flow.clearActor()
			return
		}
		matched = flow
	}
	if matched != nil {
		matched.attribute(actor)
		return
	}
	if previous := r.actors[socket]; now.Before(previous.expires) && !previous.sameProcess(actor) {
		actor.ambiguous = true
	}
	if len(r.actors) < activityFlowLimit {
		r.actors[socket] = actor
	}
}

func (a activityActor) sameProcess(other activityActor) bool {
	return a.PID == other.PID && a.Process == other.Process && a.Origin == other.Origin && !a.ambiguous
}

func (f *activityFlow) attribute(actor activityActor) {
	if time.Now().After(actor.expires) || f.actorConflict {
		return
	}
	previous := activityActor{PID: f.row.PID, Process: f.row.Process, Origin: f.row.Origin}
	if actor.ambiguous || (previous.PID != 0 && !previous.sameProcess(actor)) {
		f.clearActor()
		return
	}
	f.row.PID, f.row.Process, f.row.Origin = actor.PID, actor.Process, actor.Origin
	f.dirty = true
}

func (f *activityFlow) clearActor() {
	f.actorConflict = true
	f.row.Process, f.row.PID, f.row.Origin = "", 0, ""
	f.dirty = true
}

func (f *activityFlow) boundToGuest(connection net.Conn) {
	if f == nil {
		return
	}
	r := f.recorder
	r.mu.Lock()
	defer r.mu.Unlock()
	f.socket.guest, f.socket.peer = endpoint(connection.RemoteAddr()), endpoint(connection.LocalAddr())
	f.attribute(r.actors[f.socket])
	delete(r.actors, f.socket)
}

func (r *ActivityRecorder) outgoing(protocol string, id stack.TransportEndpointID) *activityFlow {
	guest := netip.AddrPortFrom(toNetip(id.RemoteAddress), id.RemotePort)
	peer := netip.AddrPortFrom(toNetip(id.LocalAddress), id.LocalPort)
	return r.start(activitySocket{"outgoing", protocol, guest, peer}, peer)
}

func (r *ActivityRecorder) recordDNS(local, remote net.Addr, refused bool) {
	if r == nil {
		return
	}
	destination, source := endpoint(local), endpoint(remote)
	if !destination.IsValid() || !source.IsValid() {
		return
	}
	_, tcp := remote.(*net.TCPAddr)
	protocol := "udp"
	if tcp {
		protocol = "tcp"
	}
	socket := activitySocket{"outgoing", protocol, source, destination}
	r.mu.Lock()
	for flow := range r.flows {
		if flow.socket != socket || !flow.dns || (tcp && flow.done) {
			continue
		}
		if !tcp {
			flow.expires = time.Now().Add(90 * time.Second)
		}
		if refused && flow.row.Result != "blocked" {
			flow.row.Result = "blocked"
			r.write(flow)
		}
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	if tcp {
		return
	}
	flow := r.start(socket, destination)
	if flow == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	flow.dns, flow.done = true, true
	flow.expires = time.Now().Add(90 * time.Second)
	flow.row.Result = "answered"
	if refused {
		flow.row.Result = "blocked"
	}
	r.write(flow)
}

type activityDNSListener struct {
	net.Listener
	recorder *ActivityRecorder
}

func (l activityDNSListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	peer, guest := endpoint(conn.LocalAddr()), endpoint(conn.RemoteAddr())
	flow := l.recorder.start(activitySocket{"outgoing", "tcp", guest, peer}, peer)
	if flow == nil {
		return conn, nil
	}
	l.recorder.mu.Lock()
	flow.dns = true
	l.recorder.mu.Unlock()
	flow.result("connected", true)
	return trackConnection(conn, flow), nil
}

func (r *ActivityRecorder) dnsListener(listener net.Listener) net.Listener {
	if r == nil {
		return listener
	}
	return activityDNSListener{listener, r}
}
