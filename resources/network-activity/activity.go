// Network activity at the isolated gateway. This recorder receives metadata from
// the forwarding paths and never reads traffic buffers.
package netgw

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
)

const (
	activitySegmentSize = 1024 * 1024
	activitySegments    = 64
	activityFlowLimit   = 4096
)

type activityRow struct {
	ID        string  `json:"id"`
	Revision  int64   `json:"revision"`
	Time      int64   `json:"time"`
	Direction string  `json:"direction"`
	Endpoint  string  `json:"endpoint"`
	Protocol  string  `json:"protocol"`
	Result    string  `json:"result"`
	Sent      *uint64 `json:"sent"`
	Received  *uint64 `json:"received"`
	Process   string  `json:"process,omitempty"`
	PID       uint32  `json:"pid,omitempty"`
	Origin    string  `json:"origin,omitempty"`
}

type activityFlow struct {
	recorder               *ActivityRecorder
	row                    activityRow
	sent, received         atomic.Uint64
	lastSent, lastReceived uint64
	measured, dirty        bool
	socket                 activitySocket
	done                   bool
	actorConflict          bool
	dns                    bool
	expires                time.Time
}

type activitySocket struct {
	direction, protocol string
	guest, peer         netip.AddrPort
}

// ActivityRecorder owns one gateway's descriptors and temporary socket evidence.
type ActivityRecorder struct {
	mu        sync.Mutex
	directory string
	file      *os.File
	run       *os.File
	flushed   int
	closed    bool
	size      int
	flows     map[*activityFlow]struct{}
	actors    map[activitySocket]activityActor
}

func OpenActivity(directory string) (*ActivityRecorder, error) {
	if directory == "" {
		return nil, nil
	}
	if !filepath.IsAbs(directory) {
		return nil, fmt.Errorf("network activity directory must be absolute")
	}
	r := &ActivityRecorder{directory: directory, flows: make(map[*activityFlow]struct{}), actors: make(map[activitySocket]activityActor)}
	if _, err := os.Lstat(filepath.Join(directory, "recording")); err == nil {
		r.incomplete()
	}
	run, err := r.publish("recording")
	if err != nil {
		r.incomplete()
		return nil, err
	}
	r.run = run
	if err := r.rotate(); err != nil {
		r.incomplete()
		_ = run.Close()
		return nil, err
	}
	return r, nil
}

func (r *ActivityRecorder) rotate() error {
	if r.file != nil {
		if err := r.file.Sync(); err != nil {
			return err
		}
		_ = r.file.Close()
		r.file = nil
	}
	entries, err := os.ReadDir(r.directory)
	if err != nil {
		return err
	}
	if len(entries) >= activitySegments {
		return fmt.Errorf("network activity queue is full")
	}
	id := uuid.New()
	file, err := r.publish(hex.EncodeToString(id[:]) + ".jsonl")
	if err != nil {
		return err
	}
	r.file, r.size, r.flushed = file, 0, 0
	return nil
}

func (r *ActivityRecorder) publish(name string) (*os.File, error) {
	f, err := os.CreateTemp(r.directory, ".activity-")
	if err != nil {
		return nil, err
	}
	defer os.Remove(f.Name())
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err := os.Rename(f.Name(), filepath.Join(r.directory, name)); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func (r *ActivityRecorder) incomplete() {
	// This marker survives a stopped gateway and is ingested with its rows.
	f, err := os.OpenFile(filepath.Join(r.directory, "incomplete"), os.O_CREATE|os.O_WRONLY, 0600)
	if err == nil {
		_ = f.Close()
	}
}

func (r *ActivityRecorder) write(flow *activityFlow) {
	if r.closed {
		return
	}
	flow.row.Revision++
	row := flow.row
	sent, received := flow.sent.Load(), flow.received.Load()
	if flow.measured {
		row.Sent, row.Received = &sent, &received
	}
	data, err := json.Marshal(row)
	if err == nil && (r.file == nil || r.size+len(data)+1 > activitySegmentSize) {
		err = r.rotate()
	}
	if err == nil {
		var size int
		size, err = r.file.Write(append(data, '\n'))
		r.size += size
		// A later record must start on a new line after a partial write.
		if err != nil {
			r.size = activitySegmentSize
		}
	}
	if err != nil {
		r.incomplete()
		return
	}
	flow.dirty = false
	flow.lastSent, flow.lastReceived = sent, received
}

func (r *ActivityRecorder) start(socket activitySocket, endpoint netip.AddrPort) *activityFlow {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	if socket.protocol == "udp" {
		for flow := range r.flows {
			if flow.socket == socket && (flow.row.Result == "blocked" || flow.row.Result == "failed") && time.Now().Before(flow.expires) {
				return nil
			}
		}
	}
	if len(r.flows) >= activityFlowLimit {
		r.incomplete()
		return nil
	}
	id := uuid.New()
	flow := &activityFlow{recorder: r, socket: socket, row: activityRow{
		ID: hex.EncodeToString(id[:]), Time: time.Now().UnixMilli(), Direction: socket.direction,
		Endpoint: endpoint.String(), Protocol: socket.protocol, Result: "connecting",
	}}
	r.flows[flow] = struct{}{}
	flow.attribute(r.actors[socket])
	delete(r.actors, socket)
	r.write(flow)
	return flow
}

func (f *activityFlow) result(result string, measured bool) {
	if f == nil {
		return
	}
	r := f.recorder
	r.mu.Lock()
	defer r.mu.Unlock()
	f.row.Result, f.measured = result, measured
	f.dirty = true
	r.write(f)
}

func (f *activityFlow) count(sent bool, bytes int) {
	if f == nil || bytes == 0 {
		return
	}
	if sent {
		f.sent.Add(uint64(bytes))
		return
	}
	f.received.Add(uint64(bytes))
}

func (f *activityFlow) pending() bool {
	return f.dirty || f.lastSent != f.sent.Load() || f.lastReceived != f.received.Load()
}

func (f *activityFlow) close() {
	if f == nil {
		return
	}
	r := f.recorder
	r.mu.Lock()
	defer r.mu.Unlock()
	f.done = true
	// Briefly retain the socket for attribution that arrives after forwarding.
	f.expires = time.Now().Add(3 * time.Second)
	if f.row.Protocol == "udp" && (f.row.Result == "blocked" || f.row.Result == "failed") {
		f.expires = time.Now().Add(90 * time.Second)
	}
	if f.pending() {
		r.write(f)
	}
}

func (r *ActivityRecorder) Run(ctx context.Context) {
	if r == nil {
		return
	}
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		select {
		case now := <-timer.C:
			r.flush(now, false)
		case <-ctx.Done():
			return
		}
	}
}

func (r *ActivityRecorder) flush(now time.Time, final bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for socket, actor := range r.actors {
		if now.After(actor.expires) {
			delete(r.actors, socket)
		}
	}
	for flow := range r.flows {
		if flow.pending() {
			r.write(flow)
		}
		if final && !flow.done {
			r.incomplete()
		}
		if final || (flow.done && now.After(flow.expires)) {
			delete(r.flows, flow)
		}
	}
	if r.file != nil && r.size != r.flushed {
		if err := r.file.Sync(); err != nil {
			r.incomplete()
		} else {
			r.flushed = r.size
		}
	}
	if !final {
		return
	}
	r.closed = true
	if r.file != nil {
		_ = r.file.Close()
		r.file = nil
	}
	if r.run != nil {
		_ = os.Remove(filepath.Join(r.directory, "recording"))
		_ = r.run.Close()
		r.run = nil
	}
}

func (r *ActivityRecorder) Close() {
	if r != nil {
		r.flush(time.Now(), true)
	}
}

// Count bytes only at the guest-facing endpoint of a relay.
type activityConn struct {
	net.Conn
	flow *activityFlow
}

func (c activityConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.flow.count(false, n)
	return n, err
}

func (c activityConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.flow.count(true, n)
	return n, err
}

func (c activityConn) CloseWrite() error {
	if conn, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return conn.CloseWrite()
	}
	return nil
}

func (c activityConn) Close() error {
	err := c.Conn.Close()
	c.flow.close()
	return err
}

func trackConnection(connection net.Conn, flow *activityFlow) net.Conn {
	if flow == nil {
		return connection
	}
	return activityConn{connection, flow}
}

func (c activityConn) CloseRead() error {
	if conn, ok := c.Conn.(interface{ CloseRead() error }); ok {
		return conn.CloseRead()
	}
	return nil
}

type activityDatagrams struct {
	*autoStoppingListener
	flow *activityFlow
}

func (c activityDatagrams) ReadFrom(p []byte) (int, net.Addr, error) {
	n, addr, err := c.autoStoppingListener.ReadFrom(p)
	c.flow.count(true, n)
	return n, addr, err
}

func (c activityDatagrams) WriteTo(p []byte, addr net.Addr) (int, error) {
	n, err := c.autoStoppingListener.WriteTo(p, addr)
	c.flow.count(false, n)
	return n, err
}
