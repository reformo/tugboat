package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type updater struct {
	legacy                                map[string]string
	agent, cache, brig, cosign, ref, boot string
	home                                  *os.Root
	probes                                [][]string
}
type status struct {
	Boot     string `json:"boot"`
	Selected string `json:"selected,omitempty"`
	Active   string `json:"active,omitempty"`
	Result   string `json:"result"`
}
type limitedOutput struct{ data bytes.Buffer }

func (b *limitedOutput) Write(p []byte) (int, error) {
	if b.data.Len()+len(p) > 1<<20 {
		return 0, errors.New("Guest output exceeded the limit.")
	}
	return b.data.Write(p)
}
func (u updater) guest(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, u.brig, append([]string{"exec", u.ref, "--"}, args...)...)
	var output limitedOutput
	cmd.Stdout = &output
	if cmd.Run() != nil {
		return "", errors.New("Guest command failed or timed out.")
	}
	return strings.TrimSpace(output.data.String()), nil
}
func (u updater) compatible(name, version string) error {
	if err := u.verify(name, version); err != nil {
		return err
	}
	program := "/root/" + name + "/" + u.binary()
	want := version + " (Claude Code)"
	if u.agent == "codex" {
		want = "codex-cli " + version
	}
	actual, err := u.guest(program, "--version")
	if err != nil || actual != want {
		return errors.New("The installed executable returned the wrong version.")
	}
	if err := u.checkOptions(program); err != nil {
		return err
	}
	for _, probe := range u.probes {
		help, err := u.guest(append([]string{program}, append(probe, "--help")...)...)
		if err != nil || !strings.Contains(help, "--help") {
			return errors.New("The release failed the new chat or resume option check.")
		}
	}
	return nil
}
func (u updater) update(s *status) error {
	version, err := discover(u.agent)
	if err != nil {
		return err
	}
	s.Selected = version
	old, name, err := u.active()
	if err == nil && old == version && u.compatible(name, old) == nil {
		s.Active = version
		s.Result = "Current"
		return nil
	}
	files, err := u.ensurePackage(version)
	if err != nil {
		return err
	}
	if err = u.checkBoot(); err != nil {
		return err
	}
	name, err = u.stage(version, files)
	if err != nil {
		return err
	}
	activated := false
	defer func() {
		if !activated {
			_ = u.home.RemoveAll(name)
		}
	}()
	if err = u.compatible(name, version); err != nil {
		return err
	}
	if err = u.checkBoot(); err != nil {
		return err
	}
	if err = u.activate(name); err != nil {
		return err
	}
	s.Active = version
	activated = true
	s.Result = "Installed"
	return nil
}
func (u updater) execute(mode, file string) (status, error) {
	if mode == "update" {
		guard, err := lock(file + ".lock")
		if err != nil {
			return status{}, err
		}
		defer guard.Close()
		if err = u.checkBoot(); err != nil {
			return status{}, err
		}
		var prior status
		if b, err := os.ReadFile(file); err == nil && json.Unmarshal(b, &prior) == nil && prior.Boot == u.boot {
			return prior, nil
		}
		if _, err := u.home.Lstat(u.link()); errors.Is(err, os.ErrNotExist) && len(u.legacy) > 0 {
			// A missing or damaged legacy installation can still receive a fresh release.
			_ = u.adoptLegacy()
		}
		s := status{Boot: u.boot}
		if err := u.update(&s); err != nil {
			s.Result = err.Error()
			if version, name, err := u.active(); err == nil && u.compatible(name, version) == nil {
				s.Active = version
			}
		}
		if err := u.checkBoot(); err != nil {
			return status{}, err
		}
		return s, atomicJSON(file, s)
	}
	var s status
	b, err := os.ReadFile(file)
	if err != nil || json.Unmarshal(b, &s) != nil || s.Boot != u.boot || s.Active == "" {
		return s, errors.New("This agent is unavailable or its startup checks are still running.")
	}
	version, name, err := u.active()
	if err != nil || version != s.Active {
		return s, errors.New("The active agent changed after verification.")
	}
	return s, u.verify(name, version)
}
func run(args []string) error {
	if len(args) != 10 || (args[0] != "verify" && args[0] != "update") || (args[1] != "codex" && args[1] != "claude") {
		return errors.New("Invalid agent update operation.")
	}
	if !regexp.MustCompile(`^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$`).MatchString(args[7]) {
		return errors.New("Invalid guest boot identifier.")
	}
	// The checked plan supplies the named home. Its parent is outside all guest mounts.
	info, err := os.Lstat(args[3])
	if err != nil || !info.IsDir() {
		return errors.New("Invalid project guest home.")
	}
	home, err := os.OpenRoot(args[3])
	if err != nil {
		return err
	}
	defer home.Close()
	u := updater{agent: args[1], cache: args[2], home: home, brig: args[4], cosign: args[5], ref: args[6], boot: args[7]}
	if json.Unmarshal([]byte(args[9]), &u.legacy) != nil {
		return errors.New("Invalid migration evidence.")
	}
	if json.Unmarshal([]byte(args[8]), &u.probes) != nil || len(u.probes) != 2 {
		return errors.New("Invalid chat capability checks.")
	}
	dir := filepath.Join(u.cache, "projects", filepath.Base(args[3]))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	s, err := u.execute(args[0], filepath.Join(dir, u.agent+".json"))
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(s)
}
func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
