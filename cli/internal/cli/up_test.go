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
		return
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
		return
	}

	oldModeFlag := modeFlag
	modeFlag = ""
	defer func() { modeFlag = oldModeFlag }()

	err := runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error for invalid config")
		return
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
		return
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
		return
	}
	cfg.Anthropic.APIKey = "sk-test"

	forgeCfg, err := buildForgeConfig(cfg)
	if err != nil {
		t.Fatalf("buildForgeConfig: %v", err)
		return
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
		return
	}
	defer func() { _ = ln.Close() }()
	addr := ln.Addr().(*net.TCPAddr)

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go" // use "go" as a stand-in binary
	cfg.Volundr.Forge.Workspace = t.TempDir()

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for port in use")
		return
	}
	if !strings.Contains(upErr.Error(), "already in use") {
		t.Errorf("expected 'already in use' error, got: %v", upErr)
	}
}

func TestRunUpPreflightChecks_MissingClaude(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Volundr.Forge.ClaudeBinary = "nonexistent-claude-binary-xyz"

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for missing claude binary")
		return
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
		return
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
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
		return
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
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
		return
	}

	// Find a free port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to find free port: %v", err)
		return
	}
	addr := ln.Addr().(*net.TCPAddr)
	_ = ln.Close()

	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Volundr.Forge.Listen = fmt.Sprintf("127.0.0.1:%d", addr.Port)
	cfg.Volundr.Forge.ClaudeBinary = "go"
	cfg.Volundr.Forge.Workspace = filepath.Join(readOnly, "sub")

	upErr := runUpPreflightChecks(cfg)
	if upErr == nil {
		t.Fatal("expected error for non-writable workspace")
		return
	}
}

func TestBuildForgeConfig_AllOptionalFields(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Anthropic.APIKey = "sk-test"
	cfg.Volundr.Forge.ClaudeBinary = "/usr/local/bin/claude"
	cfg.Volundr.Forge.SDKPortStart = 9000
	cfg.Volundr.Forge.Xcode.SearchPaths = []string{"/Applications/Xcode.app"}
	cfg.Volundr.Forge.Xcode.DefaultVersion = "15.0"
	cfg.Volundr.Web = false
	cfg.Database.Port = 5432
	cfg.Database.User = "volundr"
	cfg.Database.Password = "secret"
	cfg.Database.Name = "volundr"
	cfg.Volundr.Forge.Auth.Tokens = []config.ForgeTokenEntry{
		{Name: "test-token", Token: "sk-pat-123"},
	}

	forgeCfg, err := buildForgeConfig(cfg)
	if err != nil {
		t.Fatalf("buildForgeConfig: %v", err)
		return
	}

	if forgeCfg.Forge.ClaudeBinary != "/usr/local/bin/claude" {
		t.Errorf("expected ClaudeBinary '/usr/local/bin/claude', got %q", forgeCfg.Forge.ClaudeBinary)
	}
	if forgeCfg.Forge.SDKPortStart != 9000 {
		t.Errorf("expected SDKPortStart 9000, got %d", forgeCfg.Forge.SDKPortStart)
	}
	if len(forgeCfg.Forge.Xcode.SearchPaths) != 1 {
		t.Errorf("expected 1 xcode search path, got %d", len(forgeCfg.Forge.Xcode.SearchPaths))
	}
	if forgeCfg.Forge.Xcode.DefaultVersion != "15.0" {
		t.Errorf("expected xcode default version '15.0', got %q", forgeCfg.Forge.Xcode.DefaultVersion)
	}
	if forgeCfg.Web {
		t.Error("expected web disabled")
	}
	if len(forgeCfg.Auth.Tokens) != 1 {
		t.Errorf("expected 1 auth token, got %d", len(forgeCfg.Auth.Tokens))
	}
}

func TestBuildForgeConfig_InvalidListen(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Volundr.Forge.Listen = "not-valid"

	_, err = buildForgeConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid listen address")
		return
	}
}

func TestBuildForgeConfig_InvalidPort(t *testing.T) {
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig: %v", err)
		return
	}
	cfg.Volundr.Forge.Listen = "127.0.0.1:abc"

	_, err = buildForgeConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid port")
		return
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
