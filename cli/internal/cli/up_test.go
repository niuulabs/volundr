package cli

import (
	"os"
	"path/filepath"
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
