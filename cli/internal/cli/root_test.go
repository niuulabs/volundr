package cli

import (
	"testing"
)

func TestRootCmd_HasSubcommands(t *testing.T) {
	subcmds := rootCmd.Commands()
	if len(subcmds) == 0 {
		t.Fatal("expected root command to have subcommands")
	}

	expected := map[string]bool{
		"init":     false,
		"up":       false,
		"down":     false,
		"status":   false,
		"version":  false,
		"tui":      false,
		"sessions": false,
		"config":   false,
		"login":    false,
		"logout":   false,
		"whoami":   false,
		"context":  false,
	}

	for _, cmd := range subcmds {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected subcommand %q not found", name)
		}
	}
}

func TestRootCmd_PersistentFlags(t *testing.T) {
	tests := []struct {
		flag string
	}{
		{"home"},
		{"server"},
		{"token"},
		{"config"},
		{"context"},
		{"json"},
	}

	for _, tt := range tests {
		t.Run(tt.flag, func(t *testing.T) {
			f := rootCmd.PersistentFlags().Lookup(tt.flag)
			if f == nil {
				t.Errorf("expected persistent flag %q not found", tt.flag)
			}
		})
	}
}

func TestRootCmd_SilenceUsage(t *testing.T) {
	if !rootCmd.SilenceUsage {
		t.Error("expected SilenceUsage to be true")
	}
}

func TestRootCmd_SilenceErrors(t *testing.T) {
	if !rootCmd.SilenceErrors {
		t.Error("expected SilenceErrors to be true")
	}
}

func TestVersionCmd_Properties(t *testing.T) {
	if versionCmd.Use != "version" {
		t.Errorf("expected Use %q, got %q", "version", versionCmd.Use)
	}
	if versionCmd.Short == "" {
		t.Error("expected non-empty Short description")
	}
}

func TestContextCmd_HasSubcommands(t *testing.T) {
	subcmds := contextCmd.Commands()
	expected := map[string]bool{
		"add":    false,
		"list":   false,
		"remove": false,
		"rename": false,
	}

	for _, cmd := range subcmds {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected context subcommand %q not found", name)
		}
	}
}

func TestSessionsCmd_HasSubcommands(t *testing.T) {
	subcmds := sessionsCmd.Commands()
	expected := map[string]bool{
		"list":   false,
		"create": false,
		"start":  false,
		"stop":   false,
		"delete": false,
	}

	for _, cmd := range subcmds {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected sessions subcommand %q not found", name)
		}
	}
}

func TestSessionsCmd_Alias(t *testing.T) {
	if len(sessionsCmd.Aliases) == 0 {
		t.Fatal("expected sessions command to have aliases")
	}
	found := false
	for _, a := range sessionsCmd.Aliases {
		if a == "s" {
			found = true
		}
	}
	if !found {
		t.Error("expected 's' alias for sessions command")
	}
}

func TestConfigCmd_HasSubcommands(t *testing.T) {
	subcmds := configCmd.Commands()
	expected := map[string]bool{
		"get": false,
		"set": false,
	}

	for _, cmd := range subcmds {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected config subcommand %q not found", name)
		}
	}
}
