package forge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultForgeConfig(t *testing.T) {
	cfg := DefaultForgeConfig()

	if cfg.Listen.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Listen.Port)
	}
	if cfg.Listen.Host != "127.0.0.1" {
		t.Errorf("expected default host '127.0.0.1', got %q", cfg.Listen.Host)
	}
	if cfg.Forge.MaxConcurrent != 4 {
		t.Errorf("expected max_concurrent 4, got %d", cfg.Forge.MaxConcurrent)
	}
	if cfg.Auth.Mode != "none" {
		t.Errorf("expected auth mode 'none', got %q", cfg.Auth.Mode)
	}
}

func TestConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		modify  func(*Config)
		wantErr bool
	}{
		{
			name:    "valid defaults",
			modify:  func(_ *Config) {},
			wantErr: false,
		},
		{
			name:    "invalid port",
			modify:  func(c *Config) { c.Listen.Port = 0 },
			wantErr: true,
		},
		{
			name:    "invalid max_concurrent",
			modify:  func(c *Config) { c.Forge.MaxConcurrent = 0 },
			wantErr: true,
		},
		{
			name:    "invalid auth mode",
			modify:  func(c *Config) { c.Auth.Mode = "magic" },
			wantErr: true,
		},
		{
			name:    "pat mode is valid",
			modify:  func(c *Config) { c.Auth.Mode = "pat" },
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultForgeConfig()
			tt.modify(cfg)
			err := cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLoadForgeConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "forge.yaml")

	content := `
listen:
  host: "127.0.0.1"
  port: 9090
forge:
  max_concurrent: 8
  claude_binary: "/usr/local/bin/claude"
auth:
  mode: pat
  tokens:
    - name: tyr
      token: secret-123
`
	if err := os.WriteFile(cfgPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadForgeConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadForgeConfig: %v", err)
	}

	if cfg.Listen.Host != "127.0.0.1" {
		t.Errorf("expected host '127.0.0.1', got %q", cfg.Listen.Host)
	}
	if cfg.Listen.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Listen.Port)
	}
	if cfg.Forge.MaxConcurrent != 8 {
		t.Errorf("expected max_concurrent 8, got %d", cfg.Forge.MaxConcurrent)
	}
	if cfg.Forge.ClaudeBinary != "/usr/local/bin/claude" {
		t.Errorf("expected claude_binary '/usr/local/bin/claude', got %q", cfg.Forge.ClaudeBinary)
	}
	if cfg.Auth.Mode != "pat" {
		t.Errorf("expected auth mode 'pat', got %q", cfg.Auth.Mode)
	}
	if len(cfg.Auth.Tokens) != 1 || cfg.Auth.Tokens[0].Name != "tyr" {
		t.Errorf("expected 1 token named 'tyr', got %v", cfg.Auth.Tokens)
	}
}

func TestConfig_ResolveAnthropicKey(t *testing.T) {
	cfg := DefaultForgeConfig()

	// Direct value takes precedence.
	cfg.Anthropic.APIKey = "sk-direct"
	if got := cfg.ResolveAnthropicKey(); got != "sk-direct" {
		t.Errorf("expected 'sk-direct', got %q", got)
	}

	// Falls back to env var.
	cfg.Anthropic.APIKey = ""
	cfg.Anthropic.APIKeyEnv = "TEST_FORGE_API_KEY"
	t.Setenv("TEST_FORGE_API_KEY", "sk-from-env")

	if got := cfg.ResolveAnthropicKey(); got != "sk-from-env" {
		t.Errorf("expected 'sk-from-env', got %q", got)
	}
}

func TestConfig_ResolveAnthropicKey_DefaultEnv(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Anthropic.APIKey = ""
	cfg.Anthropic.APIKeyEnv = ""
	t.Setenv("ANTHROPIC_API_KEY", "sk-default-env")

	if got := cfg.ResolveAnthropicKey(); got != "sk-default-env" {
		t.Errorf("expected 'sk-default-env', got %q", got)
	}
}

func TestConfig_ResolveGitHubToken(t *testing.T) {
	cfg := DefaultForgeConfig()

	// Direct value takes precedence.
	cfg.Git.GitHub.Token = "ghp-direct"
	if got := cfg.ResolveGitHubToken(); got != "ghp-direct" {
		t.Errorf("expected 'ghp-direct', got %q", got)
	}

	// Falls back to env var.
	cfg.Git.GitHub.Token = ""
	cfg.Git.GitHub.TokenEnv = "TEST_GH_TOKEN"
	t.Setenv("TEST_GH_TOKEN", "ghp-from-env")

	if got := cfg.ResolveGitHubToken(); got != "ghp-from-env" {
		t.Errorf("expected 'ghp-from-env', got %q", got)
	}

	// Default env var.
	cfg.Git.GitHub.TokenEnv = ""
	t.Setenv("GITHUB_TOKEN", "ghp-default")
	if got := cfg.ResolveGitHubToken(); got != "ghp-default" {
		t.Errorf("expected 'ghp-default', got %q", got)
	}
}

func TestLoadForgeConfig_NotFound(t *testing.T) {
	_, err := LoadForgeConfig("/nonexistent/path/config.yaml")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestLoadForgeConfig_InvalidYAML(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(cfgPath, []byte("{{not yaml"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := LoadForgeConfig(cfgPath)
	if err == nil {
		t.Error("expected error for invalid YAML")
	}
}

func TestConfig_IsMacOS(t *testing.T) {
	// Just verify the function runs without panic.
	_ = IsMacOS()
}
