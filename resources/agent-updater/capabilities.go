package main

import (
	"errors"
	"slices"
	"strings"
)

// Some CLIs print help before validating the arguments on the command line.
// Check the advertised options as well as invoking both selected commands.
func (u updater) checkOptions(program string) error {
	help, err := u.guest(program, "--help")
	if err != nil {
		return err
	}
	first := u.probes[0]
	options := strings.FieldsFunc(help, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == ','
	})
	for i, argument := range first {
		if !strings.HasPrefix(argument, "--") {
			continue
		}
		option, _, _ := strings.Cut(argument, "=")
		if !slices.Contains(options, option) {
			return errors.New("Installed agent does not advertise " + option + ".")
		}
		switch option {
		case "--permission-mode", "--ask-for-approval", "--sandbox":
			if i+1 == len(first) || !optionValue(help, option, first[i+1]) {
				return errors.New("Installed agent does not advertise the selected value for " + option + ".")
			}
		}
	}
	if u.agent == "claude" && !slices.Contains(options, "--resume") {
		return errors.New("Claude Code does not support resume.")
	}
	return nil
}
func optionValue(help, option, value string) bool {
	_, block, ok := strings.Cut(help, option)
	if !ok {
		return false
	}
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") || strings.Contains(line, ", --") {
			break
		}
		for _, word := range strings.Fields(line) {
			if strings.Trim(word, "\"',:[]()") == value {
				return true
			}
		}
	}
	return false
}
