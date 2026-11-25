package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type fileRecord struct {
	Size       int64
	Hash       string
	Executable bool
}
type manifest map[string]fileRecord

func inventory(dir string) (manifest, error) {
	entries := manifest{}
	err := filepath.WalkDir(dir, func(file string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if !d.Type().IsRegular() {
			return errors.New("Unexpected package file type.")
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		sum, size, err := fileDigest(file)
		if err != nil {
			return err
		}
		name, err := filepath.Rel(dir, file)
		if err != nil {
			return err
		}
		entries[name] = fileRecord{size, sum, info.Mode()&0111 != 0}
		return nil
	})
	return entries, err
}
func atomicJSON(file string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".record-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if err = errors.Join(err, f.Sync(), f.Close()); err != nil {
		return err
	}
	return os.Rename(f.Name(), file)
}
func lock(file string) (*os.File, error) {
	f, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
func receipt(dir string) (manifest, error) {
	data, err := os.ReadFile(filepath.Join(dir, "files.json"))
	if err != nil {
		return nil, err
	}
	var files manifest
	if len(data) > 1<<20 || json.Unmarshal(data, &files) != nil || len(files) == 0 {
		return nil, errors.New("Invalid verified package record.")
	}
	return files, nil
}
func (u updater) packageDir(version string) string {
	return filepath.Join(u.cache, u.agent+"-"+version)
}
func (u updater) ensurePackage(version string) (manifest, error) {
	dest := u.packageDir(version)
	guard, err := lock(dest + ".lock")
	if err != nil {
		return nil, err
	}
	defer guard.Close()
	if files, err := receipt(dest); err == nil {
		return files, nil
	}
	staging, err := os.MkdirTemp(u.cache, ".download-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	payload := filepath.Join(staging, "payload")
	if err = os.Mkdir(payload, 0700); err != nil {
		return nil, err
	}
	if u.agent == "codex" {
		err = fetchCodex(version, payload, u.cosign)
	} else {
		err = fetchClaude(version, payload)
	}
	if err != nil {
		return nil, err
	}
	files, err := inventory(payload)
	if err != nil {
		return nil, err
	}
	if !files[u.binary()].Executable {
		return nil, errors.New("Missing release executable.")
	}
	if err = atomicJSON(filepath.Join(staging, "files.json"), files); err != nil {
		return nil, err
	}
	if err = os.Rename(staging, dest); err != nil {
		return nil, err
	}
	return files, nil
}
func randomName(prefix string) string {
	var id [12]byte
	rand.Read(id[:])
	return prefix + hex.EncodeToString(id[:])
}
func (u updater) stage(version string, files manifest) (staged string, failure error) {
	name := randomName(".tugboat-" + u.agent + "-" + version + "-")
	if err := u.home.Mkdir(name, 0700); err != nil {
		return "", err
	}
	defer func() {
		if failure != nil {
			_ = u.home.RemoveAll(name)
		}
	}()
	dest, err := u.home.OpenRoot(name)
	if err != nil {
		return "", err
	}
	defer dest.Close()
	for file, record := range files {
		if !filepath.IsLocal(file) {
			return "", errors.New("Invalid package path.")
		}
		if err := dest.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return "", err
		}
		if err := copyFile(filepath.Join(u.packageDir(version), "payload", file), dest, file, record); err != nil {
			return "", err
		}
	}
	return name, nil
}
func copyFile(source string, dest *os.Root, name string, r fileRecord) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	mode := os.FileMode(0600)
	if r.Executable {
		mode = 0700
	}
	output, err := dest.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(output, h), io.LimitReader(input, r.Size+1))
	if err = errors.Join(err, output.Close()); err != nil {
		return err
	}
	if n != r.Size || hex.EncodeToString(h.Sum(nil)) != r.Hash {
		return errors.New("Cached package checksum failed.")
	}
	return nil
}
func verifyTree(root *os.Root, files manifest) error {
	directories := map[string]bool{".": true}
	for file := range files {
		for parent := filepath.Dir(file); !directories[parent]; parent = filepath.Dir(parent) {
			directories[parent] = true
		}
	}
	count := 0
	err := fs.WalkDir(root.FS(), ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if !directories[name] {
				return errors.New("Unexpected installed package directory.")
			}
			return nil
		}
		record, ok := files[name]
		if !ok || !d.Type().IsRegular() {
			return errors.New("Unexpected installed package file.")
		}
		f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			return err
		}
		stat := info.Sys().(*syscall.Stat_t)
		if stat.Nlink != 1 || int(stat.Uid) != os.Geteuid() || !info.Mode().IsRegular() || info.Size() != record.Size || (info.Mode()&0111 != 0) != record.Executable {
			return errors.New("Installed package metadata changed.")
		}
		h := sha256.New()
		_, err = io.Copy(h, io.LimitReader(f, record.Size+1))
		if err != nil {
			return err
		}
		if hex.EncodeToString(h.Sum(nil)) != record.Hash {
			return errors.New("Installed package checksum failed.")
		}
		count++
		return nil
	})
	if err != nil {
		return err
	}
	if count != len(files) {
		return errors.New("Missing installed package files.")
	}
	return nil
}
func (u updater) link() string { return ".tugboat-active-" + u.agent }
func (u updater) binary() string {
	if u.agent == "codex" {
		return "bin/codex"
	}
	return "claude"
}
func (u updater) active() (string, string, error) {
	name, err := u.home.Readlink(u.link())
	if err != nil {
		return "", "", err
	}
	for v := range u.legacy {
		if name == u.legacyName(v) {
			return v, name, nil
		}
	}
	prefix := ".tugboat-" + u.agent + "-"
	version, suffix, ok := strings.Cut(strings.TrimPrefix(name, prefix), "-")
	nonce, err := hex.DecodeString(suffix)
	if !ok || !strings.HasPrefix(name, prefix) || !stableVersion.MatchString(version) || err != nil || len(nonce) != 12 {
		return "", "", errors.New("Unexpected active installation path.")
	}
	return version, name, nil
}
func (u updater) verify(name, version string) error {
	info, err := u.home.Lstat(name)
	if err != nil || !info.IsDir() {
		return errors.New("Missing agent installation.")
	}
	dir, err := u.home.OpenRoot(name)
	if err != nil {
		return err
	}
	defer dir.Close()
	var files manifest
	if _, ok := u.legacy[version]; ok && name == u.legacyName(version) {
		files, err = u.legacyFiles(version, dir)
	} else {
		files, err = receipt(u.packageDir(version))
	}
	if err != nil {
		return err
	}
	if err := verifyTree(dir, files); err != nil {
		return err
	}
	program := "/root/" + name + "/" + u.binary()
	out, err := u.guest("/usr/bin/sha256sum", "--", program)
	if err != nil || out != files[u.binary()].Hash+"  "+program {
		return errors.New("The running guest executable failed its package checksum.")
	}
	return nil
}
func (u updater) activate(name string) error {
	temp := randomName(".tugboat-link-")
	if err := u.home.Symlink(name, temp); err != nil {
		return err
	}
	defer u.home.Remove(temp)
	return u.home.Rename(temp, u.link())
}
func (u updater) checkBoot() error {
	boot, err := u.guest("/usr/bin/cat", "/proc/sys/kernel/random/boot_id")
	if err != nil || boot != u.boot {
		return fmt.Errorf("The project guest restarted or stopped.")
	}
	return nil
}
