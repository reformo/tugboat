package main

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Adopt only versions covered by the previous Tugboat package manifest or
// the executable checksum of this project's registered, signed stock image.
func (u updater) legacyName(version string) string {
	name := ".tugboat-" + u.agent + "-" + version
	if u.agent == "claude" {
		return name + "-stock"
	}
	return name
}

func (u updater) legacyFiles(version string, dir *os.Root) (manifest, error) {
	evidence := u.legacy[version]
	if u.agent == "claude" {
		info, err := dir.Lstat("claude")
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() > maxPackage {
			return nil, errors.New("Invalid stock Claude executable.")
		}
		return manifest{"claude": {info.Size(), evidence, true}}, nil
	}
	files := manifest{}
	for _, line := range strings.Split(strings.TrimSpace(evidence), "\n") {
		fields := strings.SplitN(line, " ", 4)
		if len(fields) != 4 {
			return nil, errors.New("Invalid legacy package manifest.")
		}
		n, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return nil, err
		}
		files[fields[3]] = fileRecord{n, fields[0], fields[2] == "1"}
	}
	return files, nil
}

func (u updater) adoptLegacy() error {
	versions := make([]string, 0, len(u.legacy))
	for v := range u.legacy {
		versions = append(versions, v)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(versions)))
	for _, v := range versions {
		name := u.legacyName(v)
		if u.agent == "claude" {
			if err := u.home.Mkdir(name, 0700); err == nil {
				if _, err = u.guest("/bin/cp", "--", "/usr/local/bin/claude", "/root/"+name+"/claude"); err != nil {
					return err
				}
			}
		}
		if u.compatible(name, v) == nil {
			if err := u.checkBoot(); err != nil {
				return err
			}
			return u.activate(name)
		}
	}
	return fmt.Errorf("No compatible legacy %s installation.", u.agent)
}
