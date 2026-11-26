package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/btf"
	"github.com/cilium/ebpf/ringbuf"
	"golang.org/x/sys/unix"
)

const evidencePort = 39473

var origins = []string{"codex", "claude-code", "guest-terminal"}

type actor struct {
	Direction string         `json:"direction"`
	Protocol  string         `json:"protocol"`
	Guest     netip.AddrPort `json:"guest"`
	Peer      netip.AddrPort `json:"peer"`
	Process   string         `json:"process"`
	PID       uint32         `json:"pid"`
	Origin    string         `json:"origin"`
}

func cgroups() string {
	for _, directory := range []string{"/sys/fs/cgroup", "/run/tugboat-network-cgroup"} {
		var fs unix.Statfs_t
		if unix.Statfs(directory, &fs) == nil && fs.Type == unix.CGROUP2_SUPER_MAGIC {
			return filepath.Join(directory, "tugboat-network")
		}
	}
	return ""
}

func prepareCgroups() {
	const directory = "/run/tugboat-network-cgroup"
	if cgroups() == "" {
		if os.MkdirAll(directory, 0700) == nil {
			_ = unix.Mount("none", directory, "cgroup2", 0, "")
		}
	}
	root := cgroups()
	if root == "" {
		return
	}
	for _, origin := range origins {
		_ = os.MkdirAll(filepath.Join(root, origin), 0755)
	}
}

func execLaunch(origin string, arguments []string) error {
	if root := cgroups(); root != "" {
		for _, name := range origins {
			if origin == name {
				_ = os.WriteFile(filepath.Join(root, name, "cgroup.procs"), []byte(strconv.Itoa(os.Getpid())), 0)
				break
			}
		}
	}
	program, err := exec.LookPath(arguments[0])
	if err != nil {
		return err
	}
	return unix.Exec(program, arguments, os.Environ())
}

func gatewayAddress() (netip.AddrPort, error) {
	raw, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return netip.AddrPort{}, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		values := strings.Fields(line)
		if len(values) < 4 || values[1] != "00000000" {
			continue
		}
		gateway, err := strconv.ParseUint(values[2], 16, 32)
		if err == nil && gateway != 0 {
			var address [4]byte
			binary.LittleEndian.PutUint32(address[:], uint32(gateway))
			return netip.AddrPortFrom(netip.AddrFrom4(address), evidencePort), nil
		}
	}
	return netip.AddrPort{}, errors.New("guest network has no IPv4 gateway")
}

func findOrigin(cgroup uint64) string {
	root := cgroups()
	if root == "" {
		return ""
	}
	for _, origin := range origins {
		var stat unix.Stat_t
		if unix.Stat(filepath.Join(root, origin), &stat) == nil && stat.Ino == cgroup {
			return origin
		}
	}
	return ""
}

func executable(raw []byte) string {
	end := bytes.IndexByte(raw, 0)
	if end < 0 || end >= len(raw)-1 {
		return ""
	}
	raw = raw[:end]
	for _, byteValue := range raw {
		if !((byteValue >= 'a' && byteValue <= 'z') || (byteValue >= 'A' && byteValue <= 'Z') ||
			(byteValue >= '0' && byteValue <= '9') || strings.ContainsRune("._-+", rune(byteValue))) {
			return ""
		}
	}
	return string(raw)
}

func readActor(sample []byte, guest, collector netip.Addr) (actor, bool) {
	if len(sample) != sampleSize {
		return actor{}, false
	}
	var clock unix.Timespec
	if unix.ClockGettime(unix.CLOCK_MONOTONIC, &clock) != nil {
		return actor{}, false
	}
	nanoseconds := binary.NativeEndian.Uint64(sample[96:104])
	elapsed := uint64(clock.Nano()) - nanoseconds
	if elapsed > uint64(time.Second) {
		return actor{}, false
	}
	localAddress := netip.AddrFrom4([4]byte(sample[12:16]))
	peerAddress := netip.AddrFrom4([4]byte(sample[16:20]))
	localPort := binary.NativeEndian.Uint16(sample[20:22])
	peerPort := binary.BigEndian.Uint16(sample[22:24])
	kind := binary.NativeEndian.Uint32(sample[24:28])
	if kind == 4 && localAddress.IsUnspecified() {
		localAddress = guest
	}
	if localAddress != guest || peerPort == 0 || localPort == 0 ||
		(peerAddress == collector && peerPort == evidencePort) || kind < 1 || kind > 4 {
		return actor{}, false
	}
	value := actor{
		Direction: "outgoing", Protocol: "tcp",
		Guest:   netip.AddrPortFrom(localAddress, localPort),
		Peer:    netip.AddrPortFrom(peerAddress, peerPort),
		Process: executable(sample[32:96]), PID: binary.NativeEndian.Uint32(sample[8:12]),
		Origin: findOrigin(binary.NativeEndian.Uint64(sample[:8])),
	}
	if kind == 2 || kind == 4 {
		value.Direction = "incoming"
	}
	if kind >= 3 {
		value.Protocol = "udp"
	}
	return value, value.PID != 0
}

func collect(gateway netip.AddrPort, notify func(byte)) error {
	prepareCgroups()
	var namespace unix.Stat_t
	if err := unix.Stat("/proc/self/ns/net", &namespace); err != nil {
		return err
	}
	kernel, err := btf.LoadKernelSpec()
	if err != nil {
		return err
	}
	events, err := ebpf.NewMap(&ebpf.MapSpec{Type: ebpf.RingBuf, MaxEntries: 1 << 20})
	if err != nil {
		return err
	}
	defer events.Close()
	reader, err := ringbuf.NewReader(events)
	if err != nil {
		return err
	}
	defer reader.Close()
	connection, err := net.DialUDP("udp4", nil, net.UDPAddrFromAddrPort(gateway))
	if err != nil {
		return err
	}
	defer connection.Close()
	guest := connection.LocalAddr().(*net.UDPAddr).AddrPort().Addr().Unmap()
	var attached int
	for _, p := range probes {
		probeLink, err := attachProbe(p, kernel, int32(namespace.Ino), events)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Network attribution probe %s is unavailable: %v\n", p.symbol, err)
			continue
		}
		defer probeLink.Close()
		attached++
	}
	if attached == 0 {
		return errors.New("no network attribution probes attached")
	}
	if attached == len(probes) {
		notify(1)
	} else {
		notify(2)
	}
	for {
		record, err := reader.Read()
		if err != nil {
			return err
		}
		value, valid := readActor(record.RawSample, guest, gateway.Addr())
		if !valid {
			continue
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			continue
		}
		_ = connection.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
		_, _ = connection.Write(encoded)
	}
}

func start() error {
	source, err := os.Executable()
	if err != nil {
		return err
	}
	input, output, err := os.Pipe()
	if err != nil {
		return err
	}
	defer input.Close()
	defer output.Close()
	command := exec.Command(source, "collect")
	command.SysProcAttr = &unix.SysProcAttr{Setsid: true}
	command.ExtraFiles = []*os.File{output}
	command.Env = append(os.Environ(), "TUGBOAT_PROBE_READY=1")
	if err := command.Start(); err != nil {
		return err
	}
	_ = output.Close()
	defer command.Process.Release()
	if err := input.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	var result [1]byte
	if _, err := input.Read(result[:]); err != nil || result[0] != 1 {
		return errors.New("network attribution is incomplete")
	}
	return nil
}

func run(arguments []string) error {
	if len(arguments) == 1 && arguments[0] == "start" {
		return start()
	}
	if len(arguments) >= 3 && arguments[0] == "launch" {
		return execLaunch(arguments[1], arguments[2:])
	}
	if len(arguments) != 1 || arguments[0] != "collect" {
		return errors.New("invalid network attribution command")
	}
	lock, err := os.OpenFile("/run/tugboat-network-activity.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	var pipe *os.File
	if os.Getenv("TUGBOAT_PROBE_READY") == "1" {
		pipe = os.NewFile(3, "readiness")
	}
	notified := false
	notify := func(status byte) {
		if !notified && pipe != nil {
			_, _ = pipe.Write([]byte{status})
			_ = pipe.Close()
		}
		notified = true
	}
	defer notify(0)
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		if !errors.Is(err, unix.EWOULDBLOCK) {
			return err
		}
		notify(1)
		return nil
	}
	gateway, err := gatewayAddress()
	if err != nil {
		return err
	}
	return collect(gateway, notify)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
