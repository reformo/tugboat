// The collector runs inside the Linux guest. The BPF programs copy socket
// addresses, process identity and launch cgroup at the point of the operation.
package main

import (
	"fmt"
	"math"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/asm"
	"github.com/cilium/ebpf/btf"
	"github.com/cilium/ebpf/link"
)

const (
	sampleSize = 104
	sampleBase = -sampleSize
	scratch    = sampleBase - 8
)

type probe struct {
	symbol string
	kind   int32
	exit   bool
}

var probes = []probe{
	{"tcp_connect", 1, false},
	{"inet_csk_accept", 2, true},
	{"udp_send_skb", 3, false},
	{"udp_recvmsg", 4, true},
}

type kernelTypes struct {
	*btf.Spec
	err error
}

func (types *kernelTypes) offset(typeName string, fields ...string) int32 {
	if types.err != nil {
		return 0
	}
	var structure *btf.Struct
	if err := types.TypeByName(typeName, &structure); err != nil {
		types.err = err
		return 0
	}
	var fieldType btf.Type = structure
	var offset btf.Bits
	for _, field := range fields {
		member, found := memberNamed(fieldType, field)
		if !found {
			types.err = fmt.Errorf("kernel field %s.%s is unavailable", typeName, field)
			return 0
		}
		offset += member.Offset
		fieldType = member.Type
	}
	if offset%8 != 0 || offset.Bytes() > math.MaxInt16 {
		types.err = fmt.Errorf("unsupported kernel layout for %s", typeName)
		return 0
	}
	return int32(offset.Bytes())
}

// Linux places several socket fields in unnamed unions.
func memberNamed(subject btf.Type, name string) (btf.Member, bool) {
	var members []btf.Member
	switch value := btf.UnderlyingType(subject).(type) {
	case *btf.Struct:
		members = value.Members
	case *btf.Union:
		members = value.Members
	}
	for _, member := range members {
		if member.Name == name {
			return member, true
		}
		if member.Name != "" {
			continue
		}
		if nested, ok := memberNamed(member.Type, name); ok {
			nested.Offset += member.Offset
			return nested, true
		}
	}
	return btf.Member{}, false
}

func readKernel(source asm.Register, offset int32, slot int16, size int32) asm.Instructions {
	return asm.Instructions{
		asm.Mov.Reg(asm.R3, source),
		asm.Add.Imm(asm.R3, offset),
		asm.Mov.Reg(asm.R1, asm.RFP),
		asm.Add.Imm(asm.R1, int32(slot)),
		asm.Mov.Imm(asm.R2, size),
		asm.FnProbeReadKernel.Call(),
		asm.JNE.Imm(asm.R0, 0, "done"),
	}
}

func loadSocket(p probe, types *kernelTypes) asm.Instructions {
	// The tracing context has one slot per argument, then the return value.
	var slot int16
	switch p.kind {
	case 2:
		var function *btf.Func
		if err := types.TypeByName(p.symbol, &function); err != nil {
			types.err = err
			break
		}
		prototype, ok := btf.UnderlyingType(function.Type).(*btf.FuncProto)
		if !ok || len(prototype.Params) > 8 {
			types.err = fmt.Errorf("unsupported kernel function signature for %s", p.symbol)
			break
		}
		slot = int16(len(prototype.Params) * 8)
	}
	result := asm.Instructions{asm.LoadMem(asm.R7, asm.R6, slot, asm.DWord)}
	if p.kind == 3 {
		// udp_send_skb takes the packet and the routing tuple.
		result = append(result, readKernel(asm.R7, types.offset("sk_buff", "sk"), scratch, 8)...)
		result = append(result, asm.LoadMem(asm.R7, asm.RFP, scratch, asm.DWord))
	}
	return append(result, asm.JEq.Imm(asm.R7, 0, "done"))
}

func socketAddress(p probe, types *kernelTypes) asm.Instructions {
	const localAddress = sampleBase + 12
	const peerAddress = sampleBase + 16
	const localPort = sampleBase + 20
	const peerPort = sampleBase + 22
	if p.kind == 3 {
		return udpAddress(types)
	}
	instructions := readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_rcv_saddr"), localAddress, 4)
	instructions = append(instructions, readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_num"), localPort, 2)...)
	if p.kind == 4 {
		return append(instructions, udpAccept(types)...)
	}
	instructions = append(instructions, readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_daddr"), peerAddress, 4)...)
	return append(instructions, readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_dport"), peerPort, 2)...)
}

func udpAddress(types *kernelTypes) asm.Instructions {
	instructions := asm.Instructions{asm.LoadMem(asm.R8, asm.R6, 8, asm.DWord)}
	instructions = append(instructions, readKernel(asm.R8, types.offset("flowi4", "saddr"), sampleBase+12, 4)...)
	instructions = append(instructions, readKernel(asm.R8, types.offset("flowi4", "daddr"), sampleBase+16, 4)...)
	instructions = append(instructions, readKernel(asm.R8, types.offset("flowi4", "uli", "ports", "sport"), sampleBase+20, 2)...)
	instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, sampleBase+20, asm.Half),
		asm.HostTo(asm.BE, asm.R1, asm.Half), asm.StoreMem(asm.RFP, sampleBase+20, asm.R1, asm.Half))
	return append(instructions, readKernel(asm.R8, types.offset("flowi4", "uli", "ports", "dport"), sampleBase+22, 2)...)
}

func udpAccept(types *kernelTypes) asm.Instructions {
	var function *btf.Func
	if err := types.TypeByName("udp_recvmsg", &function); err != nil {
		types.err = err
		return nil
	}
	prototype, ok := btf.UnderlyingType(function.Type).(*btf.FuncProto)
	if !ok || len(prototype.Params) < 2 || len(prototype.Params) > 8 {
		types.err = fmt.Errorf("unsupported kernel function signature for udp_recvmsg")
		return nil
	}
	instructions := asm.Instructions{
		asm.LoadMem(asm.R1, asm.R6, int16(len(prototype.Params)*8), asm.Word),
		asm.JSLT.Imm32(asm.R1, 0, "done"),
		asm.LoadMem(asm.R8, asm.R6, 8, asm.DWord),
	}
	instructions = append(instructions, readKernel(asm.R8, types.offset("msghdr", "msg_name"), scratch, 8)...)
	instructions = append(instructions, asm.LoadMem(asm.R8, asm.RFP, scratch, asm.DWord),
		asm.JEq.Imm(asm.R8, 0, "done"))
	instructions = append(instructions, readKernel(asm.R8, types.offset("sockaddr_in", "sin_family"), scratch, 2)...)
	instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, scratch, asm.Half),
		asm.JEq.Imm(asm.R1, 2, "udp_v4"),
		asm.JNE.Imm(asm.R1, 10, "done"))
	ipv6Offset := types.offset("sockaddr_in6", "sin6_addr")
	instructions = append(instructions, readKernel(asm.R8, ipv6Offset+8, scratch, 4)...)
	instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, scratch, asm.Word),
		asm.HostTo(asm.BE, asm.R1, asm.Word), asm.JNE.Imm(asm.R1, 0xffff, "done"))
	instructions = append(instructions, readKernel(asm.R8, ipv6Offset+12, sampleBase+16, 4)...)
	instructions = append(instructions, asm.Ja.Label("udp_port"))
	ipv4 := readKernel(asm.R8, types.offset("sockaddr_in", "sin_addr"), sampleBase+16, 4)
	ipv4[0] = ipv4[0].WithSymbol("udp_v4")
	instructions = append(instructions, ipv4...)
	port := readKernel(asm.R8, types.offset("sockaddr_in", "sin_port"), sampleBase+22, 2)
	port[0] = port[0].WithSymbol("udp_port")
	return append(instructions, port...)
}

func executableName(types *kernelTypes) asm.Instructions {
	instructions := asm.Instructions{asm.FnGetCurrentTask.Call(), asm.Mov.Reg(asm.R9, asm.R0)}
	offsets := []int32{
		types.offset("task_struct", "mm"),
		types.offset("mm_struct", "exe_file"),
		types.offset("file", "f_path", "dentry"),
		types.offset("dentry", "d_name", "name"),
	}
	for _, offset := range offsets {
		read := readKernel(asm.R9, offset, scratch, 8)
		// A missing executable must not discard the socket or its origin.
		read[len(read)-1] = asm.JNE.Imm(asm.R0, 0, "emit")
		instructions = append(instructions, read...)
		instructions = append(instructions, asm.LoadMem(asm.R9, asm.RFP, scratch, asm.DWord),
			asm.JEq.Imm(asm.R9, 0, "emit"))
	}
	return append(instructions,
		asm.Mov.Reg(asm.R1, asm.RFP),
		asm.Add.Imm(asm.R1, sampleBase+32),
		asm.Mov.Imm(asm.R2, 64),
		asm.Mov.Reg(asm.R3, asm.R9),
		asm.FnProbeReadKernelStr.Call())
}

func instructionsFor(p probe, types *kernelTypes, namespace int32, ring *ebpf.Map) asm.Instructions {
	instructions := asm.Instructions{asm.Mov.Reg(asm.R6, asm.R1), asm.Mov.Imm(asm.R0, 0)}
	for offset := int16(sampleBase); offset < 0; offset += 8 {
		instructions = append(instructions, asm.StoreMem(asm.RFP, offset, asm.R0, asm.DWord))
	}
	instructions = append(instructions, loadSocket(p, types)...)
	instructions = append(instructions, readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_family"), scratch, 2)...)
	instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, scratch, asm.Half),
		asm.JEq.Imm(asm.R1, 2, "namespace"),
		asm.JNE.Imm(asm.R1, 10, "done"))
	// A dual-stack socket can carry a mapped IPv4 connection. Check the
	// mapped prefix before using the socket's IPv4 fields.
	if p.kind == 1 || p.kind == 2 {
		instructions = append(instructions, readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_v6_daddr")+8, scratch, 4)...)
		instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, scratch, asm.Word),
			asm.HostTo(asm.BE, asm.R1, asm.Word), asm.JNE.Imm(asm.R1, 0xffff, "done"))
	}
	readNamespace := readKernel(asm.R7, types.offset("sock", "__sk_common", "skc_net", "net"), scratch, 8)
	readNamespace[0] = readNamespace[0].WithSymbol("namespace")
	instructions = append(instructions, readNamespace...)
	instructions = append(instructions, asm.LoadMem(asm.R8, asm.RFP, scratch, asm.DWord))
	instructions = append(instructions, readKernel(asm.R8, types.offset("net", "ns", "inum"), scratch, 4)...)
	instructions = append(instructions, asm.LoadMem(asm.R1, asm.RFP, scratch, asm.Word), asm.JNE.Imm32(asm.R1, namespace, "done"))
	instructions = append(instructions, socketAddress(p, types)...)
	instructions = append(instructions,
		asm.FnKtimeGetNs.Call(),
		asm.StoreMem(asm.RFP, sampleBase+96, asm.R0, asm.DWord),
		asm.FnGetCurrentCgroupId.Call(),
		asm.StoreMem(asm.RFP, sampleBase, asm.R0, asm.DWord),
		asm.FnGetCurrentPidTgid.Call(),
		asm.RSh.Imm(asm.R0, 32),
		asm.StoreMem(asm.RFP, sampleBase+8, asm.R0, asm.Word),
		asm.StoreImm(asm.RFP, sampleBase+24, int64(p.kind), asm.Word))
	instructions = append(instructions, executableName(types)...)
	return append(instructions,
		asm.LoadMapPtr(asm.R1, ring.FD()).WithSymbol("emit"),
		asm.Mov.Reg(asm.R2, asm.RFP),
		asm.Add.Imm(asm.R2, sampleBase),
		asm.Mov.Imm(asm.R3, sampleSize),
		asm.Mov.Imm(asm.R4, 0),
		asm.FnRingbufOutput.Call(),
		asm.Mov.Imm(asm.R0, 0).WithSymbol("done"),
		asm.Return())
}

func attachProbe(p probe, kernel *btf.Spec, namespace int32, ring *ebpf.Map) (link.Link, error) {
	types := &kernelTypes{Spec: kernel}
	instructions := instructionsFor(p, types, namespace, ring)
	if types.err != nil {
		return nil, types.err
	}
	attach := ebpf.AttachTraceFEntry
	if p.exit {
		attach = ebpf.AttachTraceFExit
	}
	program, err := ebpf.NewProgram(&ebpf.ProgramSpec{
		Name: "tugboat_socket", Type: ebpf.Tracing, AttachType: attach,
		AttachTo: p.symbol, Instructions: instructions, License: "GPL",
	})
	if err != nil {
		return nil, err
	}
	defer program.Close()
	return link.AttachTracing(link.TracingOptions{Program: program})
}
