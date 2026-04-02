package cli

import (
	"testing"
)

func TestRootCmd_HasSubcommands(t *testing.T) {
	subcmds := rootCmd.Commands()
	if len(subcmds) == 0 {
		t.Fatal("expected root command to have subcommands")
		return
	}

	// Top-level commands under niuu.
	expected := map[string]bool{
		"volundr": false,
		"version": false,
		"tui":     false,
		"config":  false,
		"login":   false,
		"logout":  false,
		"whoami":  false,
		"context": false,
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

func TestVolundrCmd_HasSubcommands(t *testing.T) {
	subcmds := volundrCmd.Commands()
	expected := map[string]bool{
		"init":     false,
		"up":       false,
		"down":     false,
		"status":   false,
		"sessions": false,
	}

	for _, cmd := range subcmds {
		if _, ok := expected[cmd.Name()]; ok {
			expected[cmd.Name()] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected volundr subcommand %q not found", name)
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
		return
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

func TestExecute_Version(t *testing.T) {
	// Execute with "version" should succeed.
	rootCmd.SetArgs([]string{"version", "--json"})
	defer rootCmd.SetArgs(nil)

	if err := Execute(); err != nil {
		t.Fatalf("Execute version: %v", err)
		return
	}
}

func TestExecute_UnknownCommand(t *testing.T) {
	rootCmd.SetArgs([]string{"nonexistent-command"})
	defer rootCmd.SetArgs(nil)

	err := Execute()
	if err == nil {
		t.Fatal("expected error for unknown command")
		return
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

func TestRootCmd_UseName(t *testing.T) {
	if rootCmd.Use != "niuu" {
		t.Errorf("expected root command Use %q, got %q", "niuu", rootCmd.Use)
	}
}

func TestExecute_HomeFlag(t *testing.T) {
	// --home flag sets the home directory env var via PersistentPreRun.
	rootCmd.SetArgs([]string{"--home", "/tmp/test-niuu-home", "version"})
	defer rootCmd.SetArgs(nil)
	if err := Execute(); err != nil {
		t.Fatalf("Execute with --home: %v", err)
		return
	}
}
