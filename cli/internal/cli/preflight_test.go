package cli

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunInitPreflight(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfg := &config.Config{
		Runtime: "local",
		Listen:  config.ListenConfig{Host: "127.0.0.1", Port: 8080},
	}

	// runInitPreflight only prints warnings, never returns errors.
	// We just verify it doesn't panic.
	runInitPreflight(cfg, "test-api-key")
}

func TestRunInitPreflight_NoAPIKey(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfg := &config.Config{
		Runtime: "local",
		Listen:  config.ListenConfig{Host: "127.0.0.1", Port: 8080},
	}

	// Should still succeed (warnings only).
	runInitPreflight(cfg, "")
}

func TestRunUpPreflight_PortInUse(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Bind a port so it's in use.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind port: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	cfg := &config.Config{
		Runtime:   "local",
		Listen:    config.ListenConfig{Host: "127.0.0.1", Port: port},
		Anthropic: config.AnthropicConfig{APIKey: "test-key"},
	}

	err = runUpPreflight(cfg)
	if err == nil {
		t.Fatal("expected error for port in use")
	}
	if !strings.Contains(err.Error(), "already in use") {
		t.Errorf("expected 'already in use' error, got: %v", err)
	}
}

func TestRunUpPreflight_ClaudeMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Override PATH so claude is not found.
	t.Setenv("PATH", tmpDir)

	cfg := &config.Config{
		Runtime:   "local",
		Listen:    config.ListenConfig{Host: "127.0.0.1", Port: 18999},
		Anthropic: config.AnthropicConfig{APIKey: "test-key"},
	}

	err := runUpPreflight(cfg)
	if err == nil {
		t.Fatal("expected error for missing claude binary")
	}
	if !strings.Contains(err.Error(), "claude") {
		t.Errorf("expected claude error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "npm install") {
		t.Errorf("expected remediation hint, got: %v", err)
	}
}

func TestRunUpPreflight_APIKeyWarning(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create a fake claude binary in PATH.
	fakeBin := filepath.Join(tmpDir, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	claudePath := filepath.Join(fakeBin, "claude")
	if err := os.WriteFile(claudePath, []byte("#!/bin/sh\necho claude 1.0"), 0o755); err != nil {
		t.Fatalf("write claude: %v", err)
	}
	t.Setenv("PATH", fakeBin)

	cfg := &config.Config{
		Runtime:   "local",
		Listen:    config.ListenConfig{Host: "127.0.0.1", Port: 18998},
		Anthropic: config.AnthropicConfig{APIKey: ""},
	}

	// Should succeed (API key is a soft warning, not a hard failure).
	err := runUpPreflight(cfg)
	if err != nil {
		t.Errorf("expected no error for missing API key (soft warning), got: %v", err)
	}
}

func TestRunUpPreflight_AllPass(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create a fake claude binary.
	fakeBin := filepath.Join(tmpDir, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	claudePath := filepath.Join(fakeBin, "claude")
	if err := os.WriteFile(claudePath, []byte("#!/bin/sh\necho claude 1.0"), 0o755); err != nil {
		t.Fatalf("write claude: %v", err)
	}
	t.Setenv("PATH", fakeBin)

	// Create credentials.enc so API key check passes.
	credsPath := filepath.Join(tmpDir, "credentials.enc")
	if err := os.WriteFile(credsPath, []byte("encrypted"), 0o600); err != nil {
		t.Fatalf("write creds: %v", err)
	}

	cfg := &config.Config{
		Runtime:   "local",
		Listen:    config.ListenConfig{Host: "127.0.0.1", Port: 18997},
		Anthropic: config.AnthropicConfig{APIKey: "sk-ant-test"},
	}

	err := runUpPreflight(cfg)
	if err != nil {
		t.Errorf("expected all checks to pass, got: %v", err)
	}
}

func TestRunUp_PreflightBlocksPortInUse(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Bind a port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("bind port: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	// Write config with the occupied port.
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	cfgContent := "runtime: local\nlisten:\n  host: 127.0.0.1\n  port: " +
		strings.TrimSpace(strings.Replace(net.JoinHostPort("", fmt.Sprint(port)), ":", "", 1)) +
		"\ntls:\n  mode: \"off\"\ndatabase:\n  mode: embedded\n  port: 15432\n  user: volundr\n  password: test\n  name: volundr\n"
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldRuntimeFlag := runtimeFlag
	runtimeFlag = ""
	defer func() { runtimeFlag = oldRuntimeFlag }()

	err = runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error for port in use")
	}
	// Either port in use or claude missing — both are preflight errors.
	if !strings.Contains(err.Error(), "already in use") && !strings.Contains(err.Error(), "claude") {
		t.Errorf("expected preflight error, got: %v", err)
	}
}
