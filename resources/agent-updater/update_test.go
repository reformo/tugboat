package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func archive(t *testing.T, version string, incompatible bool) []byte {
	t.Helper()
	var data bytes.Buffer
	zipped := gzip.NewWriter(&data)
	writer := tar.NewWriter(zipped)
	script := "#!/bin/sh\nif test \"$1\" = '--version'; then echo 'codex-cli " + version + "';exit;fi\n"
	if incompatible {
		script += "case \"$*\" in *resume*) exit 1;; esac\n"
	}
	script += "echo '--help --sandbox [possible values: workspace-write] --ask-for-approval never --no-daemon'\n"
	if err := writer.WriteHeader(&tar.Header{Name: "bin/codex", Mode: 0755, Size: int64(len(script)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(writer, script); err != nil {
		t.Fatal(err)
	}
	if err := errors.Join(writer.Close(), zipped.Close()); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}
func TestBootUpdates(t *testing.T) {
	root := t.TempDir()
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(text), 0700); err != nil {
			t.Fatal(err)
		}
	}
	write("boot", "boot-1")
	write("brig", "#!/bin/sh\nset -eu\nshift 3\ncase \"$1\" in /usr/bin/cat) cat \"$TEST_ROOT/boot\";; /usr/bin/sha256sum) cd \"$TEST_ROOT/home\"; value=$(shasum -a 256 \"${3#/root/}\"); printf '%s  %s\\n' \"${value%% *}\" \"$3\";; *) command=\"$TEST_ROOT/home/${1#/root/}\"; shift; exec \"$command\" \"$@\";; esac\n")
	write("cosign", "#!/bin/sh\nset -eu\ntest \"$1\" = verify-blob && test \"$2\" = --bundle && test \"$(cat \"$3\")\" = good && test \"$4\" = --certificate-identity && test \"$6\" = --certificate-oidc-issuer && test \"$7\" = https://token.actions.githubusercontent.com\n")
	t.Setenv("TEST_ROOT", root)
	for _, name := range []string{"home", "cache"} {
		if err := os.Mkdir(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	home, err := os.OpenRoot(filepath.Join(root, "home"))
	if err != nil {
		t.Fatal(err)
	}
	defer home.Close()
	u := updater{home: home, cache: filepath.Join(root, "cache"), agent: "codex", brig: filepath.Join(root, "brig"), cosign: filepath.Join(root, "cosign"), boot: "boot-1", ref: "project", probes: [][]string{{"--sandbox", "workspace-write"}, {"resume", "saved-id", "--sandbox", "workspace-write"}}}
	state := filepath.Join(root, "codex.json")
	version := "1.0.0"
	badSignature, offline, incompatible, interrupted := false, false, false, false
	discovery, packages := 0, 0
	previous := client.Transport
	defer func() { client.Transport = previous }()
	client.Transport = transport(func(r *http.Request) (*http.Response, error) {
		body := []byte("good")
		switch {
		case strings.HasSuffix(r.URL.Path, "/latest"):
			discovery++
			if offline {
				return nil, errors.New("offline")
			}
			body = []byte(fmt.Sprintf(`{"tag_name":"rust-v%s","prerelease":false,"draft":false}`, version))
		case strings.HasSuffix(r.URL.Path, "/stable"):
			if offline {
				return nil, errors.New("offline")
			}
			body = []byte("1.2.3")
		case strings.HasSuffix(r.URL.Path, ".sigstore"):
			if badSignature {
				body = []byte("bad")
			}
		case strings.HasSuffix(r.URL.Path, codexArchive):
			packages++
			if interrupted {
				return nil, errors.New("connection reset")
			}
			body = archive(t, version, incompatible)
		default:
			return nil, errors.New("unexpected URL")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body))}, nil
	})
	// Concurrent starts share the host lock and its boot receipt.
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := u.execute("update", state)
			if err != nil || s.Active != "1.0.0" {
				t.Errorf("install %v %v", s, err)
			}
		}()
	}
	wg.Wait()
	if discovery != 1 || packages != 1 {
		t.Fatalf("duplicate checks: %d %d", discovery, packages)
	}
	write("home/transcript", "saved chat")
	if _, err := u.execute("verify", state); err != nil || discovery != 1 {
		t.Fatal("chat triggered discovery or failed", err)
	}
	next := func(boot string) status {
		u.boot = boot
		write("boot", boot)
		s, err := u.execute("update", state)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	if s := next("boot-2"); s.Result != "Current" || packages != 1 || discovery != 2 {
		t.Fatal("unchanged release", s)
	}
	original, _ := home.Readlink(u.link())
	version = "2.0.0"
	badSignature = true
	if s := next("boot-3"); s.Active != "1.0.0" || !strings.Contains(s.Result, "signature") {
		t.Fatal("bad signature", s)
	}
	badSignature = false
	interrupted = true
	if s := next("boot-4"); s.Active != "1.0.0" || s.Selected != "2.0.0" {
		t.Fatal("interruption", s)
	}
	interrupted = false
	incompatible = true
	if s := next("boot-5"); s.Active != "1.0.0" || !strings.Contains(s.Result, "resume") {
		t.Fatal("incompatible", s)
	}
	offline = true
	if s := next("boot-6"); s.Active != "1.0.0" || !strings.Contains(s.Result, "latest") {
		t.Fatal("offline", s)
	}
	current, _ := home.Readlink(u.link())
	if current != original {
		t.Fatal("lost working installation")
	}
	sibling := u
	sibling.agent = "claude"
	s, err := sibling.execute("update", filepath.Join(root, "claude.json"))
	if err != nil || s.Active != "" {
		t.Fatal("first installation failure", s, err)
	}
	offline = false
	incompatible = false
	// Seed a previously verified Claude package. The signed-manifest fixture
	// below checks the verification step without downloading a vendor binary.
	sibling.probes = [][]string{{"--permission-mode", "auto"}, {"--resume", "saved-id", "--permission-mode", "auto"}}
	claudeCache := sibling.packageDir("1.2.3")
	payload := filepath.Join(claudeCache, "payload")
	if err := os.MkdirAll(payload, 0700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif test \"$1\" = --version; then echo '1.2.3 (Claude Code)'; exit; fi\necho '--help --resume --permission-mode (auto, manual)'\n"
	if err := os.WriteFile(filepath.Join(payload, "claude"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	manifest, err := inventory(payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := atomicJSON(filepath.Join(claudeCache, "files.json"), manifest); err != nil {
		t.Fatal(err)
	}
	write("boot", "boot-claude")
	sibling.boot = "boot-claude"
	s, err = sibling.execute("update", filepath.Join(root, "claude.json"))
	if err != nil || s.Result != "Installed" {
		t.Fatal("first Claude install", s, err)
	}
	claudeLink, err := home.Readlink(sibling.link())
	if err != nil {
		t.Fatal(err)
	}
	version = "2.0.1"
	if s := next("boot-7"); s.Active != version {
		t.Fatal("upgrade", s)
	}
	sibling.boot = u.boot
	s, err = sibling.execute("update", filepath.Join(root, "claude.json"))
	if err != nil || s.Result != "Current" {
		t.Fatal("sibling update", s, err)
	}
	link, err := home.Readlink(sibling.link())
	if err != nil || link != claudeLink {
		t.Fatal("sibling installation changed", err)
	}
	if _, err := u.execute("verify", state); err != nil {
		t.Fatal(err)
	}
	if b, err := home.ReadFile("transcript"); err != nil || string(b) != "saved chat" {
		t.Fatal("lost transcript")
	}
	// Existing projects can adopt the old, authenticated package even offline.
	legacyName := u.legacyName(version)
	staged, err := home.Readlink(u.link())
	if err != nil {
		t.Fatal(err)
	}
	if err = home.Rename(staged, legacyName); err != nil {
		t.Fatal(err)
	}
	if err = home.Remove(u.link()); err != nil {
		t.Fatal(err)
	}
	filesForLegacy, err := receipt(u.packageDir(version))
	if err != nil {
		t.Fatal(err)
	}
	bin := filesForLegacy["bin/codex"]
	u.legacy = map[string]string{version: fmt.Sprintf("%s %d 1 bin/codex", bin.Hash, bin.Size)}
	offline = true
	if s := next("boot-8"); s.Active != version || !strings.Contains(s.Result, "latest") {
		t.Fatal("legacy fallback", s)
	}
	// A second project installs from the same host cache.
	count := packages
	otherHome, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer otherHome.Close()
	other := u
	other.home = otherHome
	files, err := other.ensurePackage(version)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = other.stage(version, files); err != nil || packages != count {
		t.Fatal("cache reuse", err)
	}
}
func TestRejectUnstableReleases(t *testing.T) {
	for _, release := range []string{`{"tag_name":"rust-v1.2.3","prerelease":true,"draft":false}`, `{"tag_name":"rust-v1.2.3-alpha.1","prerelease":false,"draft":false}`, `{"tag_name":"rust-v1.2.3","prerelease":false,"draft":true}`, `{"tag_name":"rust-v1.2.3"}`} {
		if _, err := parseRelease("codex", []byte(release)); err == nil {
			t.Fatal(release)
		}
	}
	for _, version := range []string{"1.2.3-rc1", "1.2.3/other", "1.2", "01.2.3"} {
		if _, err := parseRelease("claude", []byte(version)); err == nil {
			t.Fatal(version)
		}
	}
}

func TestClaudeManifest(t *testing.T) {
	body, err := os.ReadFile("testdata/manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	signature, err := os.ReadFile("testdata/manifest.json.sig")
	if err != nil {
		t.Fatal(err)
	}
	n, sum, err := claudeManifest("2.1.326", body, signature)
	if err != nil || n != 370271672 || sum != "98d56f6ffe53469767a74864a38eaf359d62ef557a8de1b1ad524d61a66ec119" {
		t.Fatal("signed platform selection", n, sum, err)
	}
	if _, _, err = claudeManifest("2.1.327", body, signature); err == nil {
		t.Fatal("wrong release")
	}
	if _, _, err = claudeManifest("2.1.326", append(body, ' '), signature); err == nil {
		t.Fatal("modified release")
	}
}
