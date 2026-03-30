package preflight

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckBinary_Found(t *testing.T) {
	// "go" should always be available in the test environment.
	result := CheckBinary("go", "version")
	if !result.OK {
		t.Errorf("expected go binary to be found, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "found at") {
		t.Errorf("expected message to contain 'found at', got: %s", result.Message)
	}
	if result.Name != "go binary" {
		t.Errorf("expected name 'go binary', got: %s", result.Name)
	}
}

func TestCheckBinary_FoundNoVersion(t *testing.T) {
	// Check a binary without requesting version.
	result := CheckBinary("go")
	if !result.OK {
		t.Errorf("expected go binary to be found, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "found at") {
		t.Errorf("expected 'found at' in message, got: %s", result.Message)
	}
	// Without version args, message should not contain parentheses with version.
	if strings.Contains(result.Message, "(go version") {
		t.Errorf("unexpected version in message without version args: %s", result.Message)
	}
}

func TestCheckBinary_NotFound(t *testing.T) {
	result := CheckBinary("volundr-nonexistent-binary-12345")
	if result.OK {
		t.Error("expected binary not found")
	}
	if !strings.Contains(result.Message, "not found in PATH") {
		t.Errorf("expected 'not found in PATH' in message, got: %s", result.Message)
	}
}

func TestCheckBinary_FoundVersionFails(t *testing.T) {
	// "go" with an invalid version flag — binary exists but version extraction fails gracefully.
	result := CheckBinary("go", "--nonexistent-flag-xyz")
	if !result.OK {
		t.Errorf("expected binary to be found even if version fails, got: %s", result.Message)
	}
	// Should still report found, just without version.
	if !strings.Contains(result.Message, "found at") {
		t.Errorf("expected 'found at' in message, got: %s", result.Message)
	}
}

func TestCheckAPIKey_InConfig(t *testing.T) {
	result := CheckAPIKey("sk-ant-test-key", "")
	if !result.OK {
		t.Errorf("expected API key check to pass with config key, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "set in config") {
		t.Errorf("expected 'set in config' in message, got: %s", result.Message)
	}
}

func TestCheckAPIKey_InCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	credsPath := filepath.Join(tmpDir, "credentials.enc")
	if err := os.WriteFile(credsPath, []byte("encrypted"), 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	result := CheckAPIKey("", credsPath)
	if !result.OK {
		t.Errorf("expected API key check to pass with credentials file, got: %s", result.Message)
	}
	if !strings.Contains(result.Message, "credentials.enc") {
		t.Errorf("expected 'credentials.enc' in message, got: %s", result.Message)
	}
}

func TestCheckAPIKey_Missing(t *testing.T) {
	result := CheckAPIKey("", "/nonexistent/path/credentials.enc")
	if result.OK {
		t.Error("expected API key check to fail when no key is configured")
	}
	if !strings.Contains(result.Message, "not set") {
		t.Errorf("expected 'not set' in message, got: %s", result.Message)
	}
}

func TestCheckAPIKey_EmptyCredentialsPath(t *testing.T) {
	result := CheckAPIKey("", "")
	if result.OK {
		t.Error("expected API key check to fail with empty paths")
	}
}

func TestCheckPortAvailable_Free(t *testing.T) {
	// Use port 0 to let the OS assign a free port, then check that port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("get free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	result := CheckPortAvailable("127.0.0.1", port)
	if !result.OK {
		t.Errorf("expected port %d to be available, got: %s", port, result.Message)
	}
}

func TestCheckPortAvailable_InUse(t *testing.T) {
	// Bind a port, then check it.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind port: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	result := CheckPortAvailable("127.0.0.1", port)
	if result.OK {
		t.Errorf("expected port %d to be in use", port)
	}
	if !strings.Contains(result.Message, "already in use") {
		t.Errorf("expected 'already in use' in message, got: %s", result.Message)
	}
}

func TestCheckDirWritable_Writable(t *testing.T) {
	tmpDir := t.TempDir()
	result := CheckDirWritable(tmpDir)
	if !result.OK {
		t.Errorf("expected dir to be writable, got: %s", result.Message)
	}
	if result.Message != "writable" {
		t.Errorf("expected 'writable', got: %s", result.Message)
	}
}

func TestCheckDirWritable_CreatesDir(t *testing.T) {
	tmpDir := t.TempDir()
	newDir := filepath.Join(tmpDir, "subdir", "nested")
	result := CheckDirWritable(newDir)
	if !result.OK {
		t.Errorf("expected new dir to be created and writable, got: %s", result.Message)
	}
	if _, err := os.Stat(newDir); os.IsNotExist(err) {
		t.Error("expected directory to be created")
	}
}

func TestCheckDirWritable_NotWritable(t *testing.T) {
	tmpDir := t.TempDir()
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.Mkdir(readOnlyDir, 0o555); err != nil {
		t.Fatalf("create dir: %v", err)
	}

	// Try to write inside the read-only dir (should fail on most systems).
	result := CheckDirWritable(filepath.Join(readOnlyDir, "subdir"))
	// On some CI systems running as root, this may succeed. Accept either outcome.
	if result.OK {
		t.Log("write succeeded (likely running as root), skipping failure assertion")
		return
	}
	if result.Name != "workspace directory" {
		t.Errorf("expected name 'workspace directory', got: %s", result.Name)
	}
}

func TestFormatResult_OK(t *testing.T) {
	r := Result{Name: "test check", OK: true, Message: "all good"}
	formatted := FormatResult(r)
	if !strings.Contains(formatted, "✓") {
		t.Errorf("expected check mark in output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "test check") {
		t.Errorf("expected check name in output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "all good") {
		t.Errorf("expected message in output, got: %s", formatted)
	}
}

func TestFormatResult_Fail(t *testing.T) {
	r := Result{Name: "test check", OK: false, Message: "not found"}
	formatted := FormatResult(r)
	if !strings.Contains(formatted, "✗") {
		t.Errorf("expected cross mark in output, got: %s", formatted)
	}
}

func TestBinaryRemediation_Claude(t *testing.T) {
	msg := BinaryRemediation("claude")
	if !strings.Contains(msg, "npm install -g @anthropic-ai/claude-code") {
		t.Errorf("expected npm install instruction, got: %s", msg)
	}
	if !strings.Contains(msg, "claude_binary") {
		t.Errorf("expected config path hint, got: %s", msg)
	}
}

func TestBinaryRemediation_Git(t *testing.T) {
	msg := BinaryRemediation("git")
	if !strings.Contains(msg, "brew install git") {
		t.Errorf("expected brew install instruction, got: %s", msg)
	}
	if !strings.Contains(msg, "apt install git") {
		t.Errorf("expected apt install instruction, got: %s", msg)
	}
}

func TestBinaryRemediation_Unknown(t *testing.T) {
	msg := BinaryRemediation("unknown-tool")
	if !strings.Contains(msg, "unknown-tool") {
		t.Errorf("expected tool name in message, got: %s", msg)
	}
}

func TestAPIKeyRemediation(t *testing.T) {
	msg := APIKeyRemediation()
	if !strings.Contains(msg, "ANTHROPIC_API_KEY") {
		t.Errorf("expected env var hint, got: %s", msg)
	}
	if !strings.Contains(msg, "volundr init") {
		t.Errorf("expected init hint, got: %s", msg)
	}
}

func TestPortRemediation(t *testing.T) {
	msg := PortRemediation("127.0.0.1", 8080)
	if !strings.Contains(msg, "8080") {
		t.Errorf("expected port in message, got: %s", msg)
	}
	if !strings.Contains(msg, "127.0.0.1") {
		t.Errorf("expected host in message, got: %s", msg)
	}
	if !strings.Contains(msg, "listen:") {
		t.Errorf("expected config hint, got: %s", msg)
	}
}

func TestCheckPortAvailable_ResultName(t *testing.T) {
	result := CheckPortAvailable("127.0.0.1", 0)
	expected := fmt.Sprintf("port %d", 0)
	if result.Name != expected {
		t.Errorf("expected name %q, got %q", expected, result.Name)
	}
}

func TestCheckAPIKey_Name(t *testing.T) {
	result := CheckAPIKey("key", "")
	if result.Name != "Anthropic API key" {
		t.Errorf("expected name 'Anthropic API key', got %q", result.Name)
	}
}

func TestCheckDirWritable_Name(t *testing.T) {
	tmpDir := t.TempDir()
	result := CheckDirWritable(tmpDir)
	if result.Name != "workspace directory" {
		t.Errorf("expected name 'workspace directory', got %q", result.Name)
	}
}
