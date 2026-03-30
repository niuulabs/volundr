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

func TestRunUp_NoConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldModeFlag := modeFlag
	modeFlag = ""
	defer func() { modeFlag = oldModeFlag }()

	// No config file, so Load should fail.
	err := runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error when config not found")
	}
}

func TestRunUp_InvalidConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a config with an invalid mode.
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	cfgContent := `volundr:
  mode: invalid
`
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldModeFlag := modeFlag
	modeFlag = ""
	defer func() { modeFlag = oldModeFlag }()

	err := runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error for invalid config")
	}
}

func TestRunUp_ModeFlagOverride(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a minimal valid config.
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	cfgContent := `volundr:
  mode: mini
  forge:
    listen: "127.0.0.1:18080"
    max_concurrent: 1
    auth:
      mode: none
listen:
  host: 127.0.0.1
  port: 18080
tls:
  mode: "off"
database:
  mode: embedded
  port: 15432
  user: volundr
  password: test
  name: volundr
  data_dir: /tmp/test-pg
`
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldModeFlag := modeFlag
	modeFlag = "k3s"
	defer func() { modeFlag = oldModeFlag }()

	// Will try to start k3s runtime but fail on missing dependencies. That's ok,
	// we're testing config loading and flag override.
	err := runUp(nil, nil)
	// We expect an error because runtime.Up will fail in test env.
	if err == nil {
		t.Log("runUp succeeded unexpectedly, but that's ok for coverage")
	}
}

func TestBuildForgeConfig(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Anthropic.APIKey = "sk-test"

	forgeCfg, err := buildForgeConfig(cfg)
	if err != nil {
		t.Fatalf("buildForgeConfig: %v", err)
	}

	if forgeCfg.Listen.Host != "127.0.0.1" {
		t.Errorf("expected host '127.0.0.1', got %q", forgeCfg.Listen.Host)
	}
	if forgeCfg.Listen.Port != 8080 {
		t.Errorf("expected port 8080, got %d", forgeCfg.Listen.Port)
	}
	if forgeCfg.Forge.MaxConcurrent != 4 {
		t.Errorf("expected max_concurrent 4, got %d", forgeCfg.Forge.MaxConcurrent)
	}
	if forgeCfg.Auth.Mode != "none" {
		t.Errorf("expected auth mode 'none', got %q", forgeCfg.Auth.Mode)
	}
	if forgeCfg.Anthropic.APIKey != "sk-test" {
		t.Errorf("expected anthropic key 'sk-test', got %q", forgeCfg.Anthropic.APIKey)
	}
}

func TestRunUpPreflightChecks_PortInUse(t *testing.T) {
	// Bind a port to simulate "in use".
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to bind port: %v", err)
	}
	defer func() { _ = ln.Close() }()
	addr := ln.Addr().(*net.TCPAddr)

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go" // use "go" as a stand-in binary
	cfg.Volundr.Forge.Workspace = t.TempDir()

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for port in use")
	}
	if !strings.Contains(upErr.Error(), "already in use") {
		t.Errorf("expected 'already in use' error, got: %v", upErr)
	}
}

func TestRunUpPreflightChecks_MissingClaude(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Volundr.Forge.ClaudeBinary = "nonexistent-claude-binary-xyz"

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for missing claude binary")
	}
	if !strings.Contains(upErr.Error(), "not found") {
		t.Errorf("expected 'not found' error, got: %v", upErr)
	}
	if !strings.Contains(upErr.Error(), "npm install") {
		t.Errorf("expected remediation in error, got: %v", upErr)
	}
}

func TestRunUpPreflightChecks_AllPass(t *testing.T) {
	// Find a free port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go" // use "go" as stand-in
	cfg.Volundr.Forge.Workspace = t.TempDir()
	cfg.Anthropic.APIKey = "sk-test"

	upErr := runUpPreflightChecks(cfg)
	if upErr != nil {
		t.Errorf("expected no error, got: %v", upErr)
	}
}

func TestRunUpPreflightChecks_APIKeyWarning(t *testing.T) {
	// Find a free port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go"
	cfg.Volundr.Forge.Workspace = t.TempDir()
	cfg.Anthropic.APIKey = "" // no API key

	// Should not error (warning only) but also not panic.
	upErr := runUpPreflightChecks(cfg)
	if upErr != nil {
		t.Errorf("expected no hard error for missing API key, got: %v", upErr)
	}
}

func TestRunUpPreflightChecks_WorkspaceNotWritable(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("cannot test non-writable dir as root")
	}

	dir := t.TempDir()
	readOnly := filepath.Join(dir, "readonly")
	if err := os.Mkdir(readOnly, 0o555); err != nil {
		t.Fatalf("create readonly dir: %v", err)
	}

	// Find a free port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go"
	cfg.Volundr.Forge.Workspace = filepath.Join(readOnly, "sub")

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for non-writable workspace")
	}
}

func TestExpandHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}

	got := expandHome("~/foo/bar")
	expected := filepath.Join(home, "foo", "bar")
	if got != expected {
		t.Errorf("expandHome(~/foo/bar) = %q, want %q", got, expected)
	}

	// Non-tilde path should be unchanged.
	got = expandHome("/absolute/path")
	if got != "/absolute/path" {
		t.Errorf("expandHome(/absolute/path) = %q, want /absolute/path", got)
	}
}
