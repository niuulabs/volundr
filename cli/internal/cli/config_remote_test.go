package cli

import (
	"testing"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestConfigGet_ThemeDefault(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	// Default theme is "dark"
	if err := configGetCmd.RunE(configGetCmd, []string{"theme"}); err != nil {
		t.Fatalf("config get theme: %v", err)
		return
	}
}

func TestConfigSet_ThemeAndReload(t *testing.T) {
	setupTestConfig(t, nil)

	tests := []struct {
		name  string
		value string
	}{
		{"set to light", "light"},
		{"set to dark", "dark"},
		{"set to custom", "my-custom-theme"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := configSetCmd.RunE(configSetCmd, []string{"theme", tt.value}); err != nil {
				t.Fatalf("config set theme %s: %v", tt.value, err)
				return
			}

			cfg, err := remote.Load()
			if err != nil {
				t.Fatalf("load: %v", err)
				return
			}
			if cfg.Theme != tt.value {
				t.Errorf("expected theme %q, got %q", tt.value, cfg.Theme)
			}
		})
	}
}

func TestConfigGet_ContextScoped_AllKeys(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["test"] = &remote.Context{ //nolint:gosec // test fixture
		Name:         "test",
		Server:       "https://test.example.com",
		Token:        "test-token",
		RefreshToken: "test-refresh",
		TokenExpiry:  "2099-01-01T00:00:00Z",
		Issuer:       "https://issuer.example.com",
		ClientID:     "test-client-id",
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "test"
	defer func() { cfgContext = oldCtx }()

	keys := []string{"server", "token", "refresh_token", "token_expiry", "issuer", "client-id"}
	for _, key := range keys {
		t.Run(key, func(t *testing.T) {
			if err := configGetCmd.RunE(configGetCmd, []string{key}); err != nil {
				t.Fatalf("config get %s: %v", key, err)
				return
			}
		})
	}
}

func TestConfigSet_ContextScoped_AllKeys(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["test"] = &remote.Context{Name: "test"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "test"
	defer func() { cfgContext = oldCtx }()

	tests := []struct {
		key   string
		value string
	}{
		{"server", "https://new.example.com"},
		{"token", "new-token"},
		{"refresh_token", "new-refresh"},
		{"token_expiry", "2099-06-01T00:00:00Z"},
		{"issuer", "https://new-issuer.example.com"},
		{"client-id", "new-client-id"},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			if err := configSetCmd.RunE(configSetCmd, []string{tt.key, tt.value}); err != nil {
				t.Fatalf("config set %s: %v", tt.key, err)
				return
			}
		})
	}
}

func TestConfigGet_NoContext(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	// Getting a context-scoped key with no contexts should fail.
	err := configGetCmd.RunE(configGetCmd, []string{"server"})
	if err == nil {
		t.Fatal("expected error when getting context-scoped key with no contexts")
		return
	}
}

func TestConfigSet_NoContext(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	// Setting a context-scoped key with no contexts should fail.
	err := configSetCmd.RunE(configSetCmd, []string{"server", "https://example.com"})
	if err == nil {
		t.Fatal("expected error when setting context-scoped key with no contexts")
		return
	}
}

func TestConfigGet_NonexistentContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "nonexistent"
	defer func() { cfgContext = oldCtx }()

	err := configGetCmd.RunE(configGetCmd, []string{"server"})
	if err == nil {
		t.Fatal("expected error for nonexistent context")
		return
	}
}
