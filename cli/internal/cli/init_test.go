package cli

import (
	"strings"
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

func TestCheckCommand(t *testing.T) {
	// "go" should always be available in test environment.
	if err := checkCommand("go", "version"); err != nil {
		t.Errorf("expected 'go version' to succeed: %v", err)
	}

	// A nonexistent command should fail.
	if err := checkCommand("volundr-nonexistent-tool-12345"); err == nil {
		t.Error("expected error for nonexistent command")
	}
}

func TestInstallInstructionsForOS(t *testing.T) {
	tests := []struct {
		name     string
		tool     string
		goos     string
		goarch   string
		contains string
	}{
		{"kubectl darwin", "kubectl", "darwin", "arm64", "brew install kubectl"},
		{"kubectl linux", "kubectl", "linux", "amd64", "kubernetes.io/docs/tasks/tools/install-kubectl-linux"},
		{"kubectl linux arch", "kubectl", "linux", "arm64", "arm64"},
		{"kubectl other", "kubectl", "windows", "amd64", "kubernetes.io/docs/tasks/tools/"},
		{"helm darwin", "helm", "darwin", "arm64", "brew install helm"},
		{"helm linux", "helm", "linux", "amd64", "get-helm-3"},
		{"helm other", "helm", "windows", "amd64", "helm.sh/docs/intro/install"},
		{"unknown tool", "unknown", "linux", "amd64", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := installInstructionsForOS(tt.tool, tt.goos, tt.goarch)
			if tt.contains == "" {
				if result != "" {
					t.Errorf("expected empty, got %q", result)
				}
				return
			}
			if !strings.Contains(result, tt.contains) {
				t.Errorf("installInstructionsForOS(%q, %q, %q) = %q, expected to contain %q",
					tt.tool, tt.goos, tt.goarch, result, tt.contains)
			}
		})
	}
}

func TestInstallInstructions(t *testing.T) {
	// Wrapper should return non-empty for known tools.
	if result := installInstructions("kubectl"); !strings.Contains(result, "kubernetes.io") {
		t.Errorf("expected kubernetes.io in result, got %q", result)
	}
	if result := installInstructions("helm"); !strings.Contains(result, "helm.sh") {
		t.Errorf("expected helm.sh in result, got %q", result)
	}
	if result := installInstructions("unknown"); result != "" {
		t.Errorf("expected empty for unknown tool, got %q", result)
	}
}

func TestMaskKey(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty", "", "****"},
		{"short", "abc", "****"},
		{"exactly 4", "abcd", "****"},
		{"5 chars", "abcde", "****bcde"},
		{"long key", "sk-ant-api03-abcdefghijklmnop", "****mnop"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := maskKey(tt.input)
			if got != tt.expected {
				t.Errorf("maskKey(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestDefaultStr(t *testing.T) {
	if got := defaultStr("hello", "fallback"); got != "hello" {
		t.Errorf("defaultStr(\"hello\", \"fallback\") = %q, want \"hello\"", got)
	}
	if got := defaultStr("", "fallback"); got != "fallback" {
		t.Errorf("defaultStr(\"\", \"fallback\") = %q, want \"fallback\"", got)
	}
}

func TestListenHostLabel(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"127.0.0.1", "localhost"},
		{"localhost", "localhost"},
		{"", "localhost"},
		{"0.0.0.0", "all"},
		{"192.168.1.100", "192.168.1.100"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := listenHostLabel(tt.input)
			if got != tt.expected {
				t.Errorf("listenHostLabel(%q) = %q, want %q", tt.input, got, tt.expected)
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

	// Should start with "niuu-"
	if len(passphrase) < 5 || passphrase[:5] != "niuu-" {
		t.Errorf("expected passphrase to start with 'niuu-', got %q", passphrase)
	}
}

func TestLegacyMachinePassphrase(t *testing.T) {
	passphrase := legacyMachinePassphrase()
	if passphrase == "" {
		t.Error("expected non-empty passphrase")
	}

	// Should start with "volundr-"
	if len(passphrase) < 8 || passphrase[:8] != "volundr-" {
		t.Errorf("expected legacy passphrase to start with 'volundr-', got %q", passphrase)
	}

	// New and legacy should differ.
	newPassphrase := machinePassphrase()
	if passphrase == newPassphrase {
		t.Error("expected legacy and new passphrases to differ")
	}
}
