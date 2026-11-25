package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	_ "crypto/sha512"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/openpgp"
)

//go:embed claude-code.asc
var signingKey string

const claudeRepository = "https://downloads.claude.ai/claude-code-releases"
const codexArchive = "codex-package-aarch64-unknown-linux-musl.tar.gz"
const issuer = "https://token.actions.githubusercontent.com"
const maxPackage = 768 << 20

var stableVersion = regexp.MustCompile("^(0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})$")
var client = &http.Client{Timeout: 6 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
	if req.URL.Scheme != "https" || len(via) > 8 {
		return errors.New("invalid download redirect")
	}
	return nil
}}

func download(address string, limit int64, out io.Writer) error {
	timeout := client.Timeout
	if limit <= 4<<20 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return errors.New("Could not reach the vendor. Check the Mac network connection.")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.ContentLength > limit {
		return errors.New("The vendor download is unavailable or exceeds the size limit.")
	}
	n, err := io.Copy(out, io.LimitReader(response.Body, limit+1))
	if err != nil || n == 0 || n > limit {
		return errors.New("The vendor download was interrupted or exceeds the size limit.")
	}
	return nil
}
func metadata(address string, limit int64) ([]byte, error) {
	var b bytes.Buffer
	err := download(address, limit, &b)
	return b.Bytes(), err
}
func discover(agent string) (string, error) {
	address := claudeRepository + "/stable"
	if agent == "codex" {
		address = "https://api.github.com/repos/openai/codex/releases/latest"
	}
	data, err := metadata(address, 4<<20)
	if err != nil {
		return "", fmt.Errorf("Could not check the latest stable version. %w", err)
	}
	return parseRelease(agent, data)
}
func parseRelease(agent string, data []byte) (string, error) {
	version := strings.TrimSpace(string(data))
	if agent == "codex" {
		var release struct {
			Tag               string `json:"tag_name"`
			Draft, Prerelease *bool
		}
		if json.Unmarshal(data, &release) != nil || release.Draft == nil || *release.Draft || release.Prerelease == nil || *release.Prerelease || !strings.HasPrefix(release.Tag, "rust-v") {
			return "", errors.New("Invalid stable Codex release.")
		}
		version = strings.TrimPrefix(release.Tag, "rust-v")
	}
	if !stableVersion.MatchString(version) {
		return "", errors.New("Invalid stable release version.")
	}
	return version, nil
}
func fetchFile(address, file string, limit int64) error {
	out, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	err = download(address, limit, out)
	return errors.Join(err, out.Close())
}
func fetchClaude(version, dir string) error {
	base := claudeRepository + "/" + version
	manifest, err := metadata(base+"/manifest.json", 1<<20)
	if err != nil {
		return err
	}
	signature, err := metadata(base+"/manifest.json.sig", 64<<10)
	if err != nil {
		return err
	}
	size, sum, err := claudeManifest(version, manifest, signature)
	if err != nil {
		return err
	}
	evidence := filepath.Dir(dir)
	if err := os.WriteFile(filepath.Join(evidence, "manifest.json"), manifest, 0600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(evidence, "manifest.json.sig"), signature, 0600); err != nil {
		return err
	}
	file := filepath.Join(dir, "claude")
	if err := fetchFile(base+"/linux-arm64/claude", file, size); err != nil {
		return err
	}
	digest, n, err := fileDigest(file)
	if err != nil || digest != sum || n != size {
		return errors.New("Claude Code failed the signed manifest checksum.")
	}
	return os.Chmod(file, 0755)
}
func claudeManifest(version string, manifest, signature []byte) (int64, string, error) {
	keys, err := openpgp.ReadArmoredKeyRing(strings.NewReader(signingKey))
	if err != nil {
		return 0, "", err
	}
	signer, err := openpgp.CheckArmoredDetachedSignature(keys, bytes.NewReader(manifest), bytes.NewReader(signature))
	if err != nil || fmt.Sprintf("%X", signer.PrimaryKey.Fingerprint) != "31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE" {
		return 0, "", errors.New("Claude Code manifest signature verification failed.")
	}
	var release struct {
		Version   string
		Platforms map[string]struct {
			Binary, Checksum string
			Size             int64
		}
	}
	if json.Unmarshal(manifest, &release) != nil || release.Version != version {
		return 0, "", errors.New("Incorrect Claude Code manifest version.")
	}
	binary := release.Platforms["linux-arm64"]
	hash, err := hex.DecodeString(binary.Checksum)
	if err != nil || len(hash) != 32 || binary.Binary != "claude" || binary.Size <= 0 || binary.Size > maxPackage {
		return 0, "", errors.New("Invalid Claude Code Linux release manifest.")
	}
	return binary.Size, binary.Checksum, nil
}
func fetchCodex(version, dir, cosign string) error {
	tag := "rust-v" + version
	base := "https://github.com/openai/codex/releases/download/" + url.PathEscape(tag) + "/" + codexArchive
	archive := filepath.Join(filepath.Dir(dir), "archive")
	if err := fetchFile(base, archive, maxPackage); err != nil {
		return err
	}
	if err := fetchFile(base+".sigstore", archive+".sigstore", 1<<20); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	signer := "https://github.com/openai/codex/.github/workflows/rust-release.yml@refs/tags/" + tag
	if exec.CommandContext(ctx, cosign, "verify-blob", "--bundle", archive+".sigstore", "--certificate-identity", signer, "--certificate-oidc-issuer", issuer, archive).Run() != nil {
		return errors.New("Codex release signature verification failed.")
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	return extract(tar.NewReader(gz), dir)
}
func extract(reader *tar.Reader, dir string) error {
	var total int64
	for count := 0; count < 2048; count++ {
		h, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(strings.TrimSuffix(h.Name, "/"), "./")
		if name == "." || name == "" {
			if h.Typeflag == tar.TypeDir {
				continue
			}
		}
		if !filepath.IsLocal(name) || path.Clean(name) != name || strings.Contains(name, "\\") {
			return errors.New("Unsafe Codex archive path.")
		}
		dest := filepath.Join(dir, name)
		if h.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(dest, 0755); err != nil {
				return err
			}
			continue
		}
		if h.Typeflag != tar.TypeReg || h.Size < 0 || h.Size > 1<<30 || total+h.Size > 2<<30 {
			return errors.New("Unsupported Codex package entry.")
		}
		total += h.Size
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		mode := os.FileMode(0644)
		if h.Mode&0111 != 0 {
			mode = 0755
		}
		f, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if err != nil {
			return err
		}
		_, err = io.CopyN(f, reader, h.Size)
		if err = errors.Join(err, f.Close()); err != nil {
			return err
		}
	}
	return errors.New("Too many Codex package entries.")
}
func fileDigest(file string) (string, int64, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, err
}
