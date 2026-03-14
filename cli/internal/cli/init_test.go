package cli

import (
	"testing"
)

func TestIsEnvVarName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{"empty string", "", false},
		{"uppercase only", "GITHUB_TOKEN", true},
		{"with digits", "MY_VAR_123", true},
		{"lowercase mixed", "myToken", false},
		{"starts with digit", "123VAR", true},
		{"single char upper", "A", true},
		{"single char lower", "a", false},
		{"with hyphen", "MY-VAR", false},
		{"with space", "MY VAR", false},
		{"all underscores", "___", true},
		{"mixed case", "GitHubToken", false},
		{"uppercase no underscore", "TOKEN", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isEnvVarName(tt.input)
			if got != tt.expected {
				t.Errorf("isEnvVarName(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestMachinePassphrase(t *testing.T) {
	passphrase := machinePassphrase()
	if passphrase == "" {
		t.Error("expected non-empty passphrase")
	}

	// Should be deterministic (same result on repeated calls).
	passphrase2 := machinePassphrase()
	if passphrase != passphrase2 {
		t.Errorf("expected deterministic passphrase, got %q and %q", passphrase, passphrase2)
	}

	// Should start with "volundr-"
	if len(passphrase) < 8 || passphrase[:8] != "volundr-" {
		t.Errorf("expected passphrase to start with 'volundr-', got %q", passphrase)
	}
}
