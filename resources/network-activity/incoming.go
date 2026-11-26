package netgw

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/netip"

	"github.com/containers/gvisor-tap-vsock/pkg/services/forwarder"
	"github.com/inetaf/tcpproxy"
	log "github.com/sirupsen/logrus"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
)

type activityIncoming struct {
	*stack.Stack
	*ActivityRecorder
}

func (a activityIncoming) expose(f Forward) (io.Closer, error) {
	address, err := netip.ParseAddrPort(f.Remote)
	if err != nil || !address.Addr().Unmap().Is4() {
		return nil, fmt.Errorf("%w: invalid guest endpoint", ErrForwardInvalid)
	}
	guest := tcpip.FullAddress{NIC: nicID, Addr: tcpip.AddrFrom4(address.Addr().Unmap().As4()), Port: address.Port()}
	if f.Protocol == "udp" {
		return a.exposeUDP(f.Local, guest)
	}
	return a.exposeTCP(f.Local, guest)
}

type incomingTCP struct {
	activityIncoming
	guest tcpip.FullAddress
}

func (t incomingTCP) HandleConn(peer net.Conn) {
	host := endpoint(peer.RemoteAddr())
	flow := t.start(activitySocket{direction: "incoming", protocol: "tcp"}, host)
	defer flow.close()
	proxy := tcpproxy.DialProxy{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			guest, err := gonet.DialContextTCP(ctx, t.Stack, t.guest, ipv4.ProtocolNumber)
			if err != nil {
				flow.result("failed", false)
				return nil, err
			}
			flow.boundToGuest(guest)
			flow.result("connected", true)
			return trackConnection(guest, flow), nil
		},
	}
	proxy.HandleConn(peer)
}

func (a activityIncoming) exposeTCP(local string, guest tcpip.FullAddress) (io.Closer, error) {
	var proxy tcpproxy.Proxy
	proxy.AddRoute(local, incomingTCP{a, guest})
	if err := proxy.Start(); err != nil {
		return nil, err
	}
	go func() {
		if err := proxy.Wait(); err != nil {
			log.Error(err)
		}
	}()
	return &proxy, nil
}

type lastDatagramSource struct {
	*net.UDPConn
	// UDPProxy calls its dialer synchronously after ReadFrom on the same goroutine.
	peer netip.AddrPort
}

func (s *lastDatagramSource) ReadFrom(p []byte) (int, net.Addr, error) {
	count, address, err := s.UDPConn.ReadFrom(p)
	s.peer = endpoint(address)
	return count, address, err
}

func (a activityIncoming) exposeUDP(local string, guest tcpip.FullAddress) (io.Closer, error) {
	address, err := netip.ParseAddrPort(local)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid host endpoint", ErrForwardInvalid)
	}
	listener, err := net.ListenUDP("udp", net.UDPAddrFromAddrPort(address))
	if err != nil {
		return nil, err
	}
	source := &lastDatagramSource{UDPConn: listener}
	proxy, err := forwarder.NewUDPProxy(source, func() (net.Conn, error) {
		flow := a.start(activitySocket{direction: "incoming", protocol: "udp"}, source.peer)
		backend, err := gonet.DialUDP(a.Stack, nil, &guest, ipv4.ProtocolNumber)
		if err != nil {
			flow.result("failed", false)
			flow.close()
			return nil, err
		}
		flow.boundToGuest(backend)
		flow.result("forwarded", true)
		return trackConnection(backend, flow), nil
	})
	if err != nil {
		_ = listener.Close()
		return nil, err
	}
	go proxy.Run()
	return proxy, nil
}

func (s *forwards) listen(f Forward) error {
	if s.recorded == nil {
		return s.fw.Expose(protocolOf(f.Protocol), f.Local, f.Remote)
	}
	listener, err := s.activity.expose(f)
	if err == nil {
		s.recorded[f.key()] = listener
	}
	return err
}

func (s *forwards) stopListening(f Forward) error {
	if s.recorded == nil {
		return s.fw.Unexpose(protocolOf(f.Protocol), f.Local)
	}
	listener := s.recorded[f.key()]
	delete(s.recorded, f.key())
	return listener.Close()
}
