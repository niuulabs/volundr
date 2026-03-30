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
	// "go" should always be available in test environment.
	r := CheckBinary("go", "version")
	if !r.OK {
		t.Fatalf("expected go binary to be found, got: %s", r.Message)
	}
	if r.Detail == "" {
		t.Error("expected non-empty detail")
	}
	if !strings.Contains(r.Detail, "go") {
		t.Errorf("expected detail to mention go, got %q", r.Detail)
	}
}

func TestCheckBinary_NotFound(t *testing.T) {
	r := CheckBinary("volundr-nonexistent-binary-99999")
	if r.OK {
		t.Fatal("expected check to fail for nonexistent binary")
	}
	if !strings.Contains(r.Message, "not found") {
		t.Errorf("expected 'not found' in message, got %q", r.Message)
	}
}

func TestCheckBinary_NoVersionArgs(t *testing.T) {
	r := CheckBinary("go")
	if !r.OK {
		t.Fatalf("expected go binary to be found, got: %s", r.Message)
	}
	// Detail should be the path only (no version).
	if strings.Contains(r.Detail, "(") {
		t.Errorf("expected no version in detail without version args, got %q", r.Detail)
	}
}

func TestCheckBinary_VersionCommandFails(t *testing.T) {
	// Pass invalid flags — version extraction fails but binary is still found.
	r := CheckBinary("go", "--nonexistent-flag-xyz")
	if !r.OK {
		t.Fatalf("expected go binary to be found even with bad version flag, got: %s", r.Message)
	}
	// Detail should just be the path (version extraction failed gracefully).
	if strings.Contains(r.Detail, "(") {
		t.Errorf("expected no version when version command fails, got %q", r.Detail)
	}
}

func TestCheckPortAvailable_Free(t *testing.T) {
	// Find a free port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	port := addr.Port
	_ = ln.Close()

	r := CheckPortAvailable("127.0.0.1", port)
	if !r.OK {
		t.Errorf("expected port %d to be available: %s", port, r.Message)
	}
}

func TestCheckPortAvailable_InUse(t *testing.T) {
	// Bind a port and keep it open.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to bind port: %v", err)
	}
	defer func() { _ = ln.Close() }()

	addr := ln.Addr().(*net.TCPAddr)
	port := addr.Port

	r := CheckPortAvailable("127.0.0.1", port)
	if r.OK {
		t.Errorf("expected port %d to be in use", port)
	}
	if !strings.Contains(r.Message, "already in use") {
		t.Errorf("expected 'already in use' in message, got %q", r.Message)
	}
}

func TestCheckDirWritable_OK(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "workspaces")

	r := CheckDirWritable(subDir)
	if !r.OK {
		t.Errorf("expected writable dir check to pass: %s", r.Message)
	}
	if r.Detail != subDir {
		t.Errorf("expected detail %q, got %q", subDir, r.Detail)
	}
}

func TestCheckDirWritable_NotWritable(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("cannot test non-writable dir as root")
	}

	dir := t.TempDir()
	readOnly := filepath.Join(dir, "readonly")
	if err := os.Mkdir(readOnly, 0o555); err != nil {
		t.Fatalf("failed to create readonly dir: %v", err)
	}

	r := CheckDirWritable(filepath.Join(readOnly, "sub"))
	if r.OK {
		t.Error("expected writable check to fail on readonly dir")
	}
}

func TestCheckAPIKeySet_Present(t *testing.T) {
	r := CheckAPIKeySet("sk-ant-test-key")
	if !r.OK {
		t.Errorf("expected check to pass with key set: %s", r.Message)
	}
	if r.Detail != "configured" {
		t.Errorf("expected detail 'configured', got %q", r.Detail)
	}
}

func TestCheckAPIKeySet_Empty(t *testing.T) {
	r := CheckAPIKeySet("")
	if r.OK {
		t.Error("expected check to fail with empty key")
	}
	if !strings.Contains(r.Message, "not set") {
		t.Errorf("expected 'not set' in message, got %q", r.Message)
	}
}

func TestFormatResults(t *testing.T) {
	results := []Result{
		{Name: "claude binary", OK: true, Detail: "/usr/local/bin/claude (v2.1.0)"},
		{Name: "Anthropic API key", OK: false, Message: "not set"},
		{Name: "git binary", OK: true, Detail: "/usr/bin/git (2.39.0)"},
	}

	out := FormatResults(results)

	if !strings.Contains(out, "✓ claude binary") {
		t.Error("expected passing claude check in output")
	}
	if !strings.Contains(out, "✗ Anthropic API key") {
		t.Error("expected failing API key check in output")
	}
	if !strings.Contains(out, "✓ git binary") {
		t.Error("expected passing git check in output")
	}
}

func TestFormatResults_Empty(t *testing.T) {
	out := FormatResults(nil)
	if out != "" {
		t.Errorf("expected empty output for nil results, got %q", out)
	}
}

func TestHasFailures(t *testing.T) {
	allPass := []Result{
		{OK: true},
		{OK: true},
	}
	if HasFailures(allPass) {
		t.Error("expected no failures")
	}

	oneFail := []Result{
		{OK: true},
		{OK: false},
	}
	if !HasFailures(oneFail) {
		t.Error("expected failures")
	}

	if HasFailures(nil) {
		t.Error("expected no failures for nil slice")
	}
}

func TestCheckBinary_NameInResult(t *testing.T) {
	r := CheckBinary("volundr-no-such-binary-xyz")
	if r.Name != "volundr-no-such-binary-xyz binary" {
		t.Errorf("expected name 'volundr-no-such-binary-xyz binary', got %q", r.Name)
	}
}

func TestCheckPortAvailable_NameIncludesPort(t *testing.T) {
	r := CheckPortAvailable("127.0.0.1", 99999)
	expected := fmt.Sprintf("port %d", 99999)
	if r.Name != expected {
		t.Errorf("expected name %q, got %q", expected, r.Name)
	}
}

func TestCheckDirWritable_Name(t *testing.T) {
	r := CheckDirWritable(t.TempDir())
	if r.Name != "workspace directory" {
		t.Errorf("expected name 'workspace directory', got %q", r.Name)
	}
}

func TestCheckAPIKeySet_Name(t *testing.T) {
	r := CheckAPIKeySet("key")
	if r.Name != "Anthropic API key" {
		t.Errorf("expected name 'Anthropic API key', got %q", r.Name)
	}
}
