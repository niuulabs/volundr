package cli

import (
	"testing"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestLogout_SpecificContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{ //nolint:gosec // test fixture
		Name:         "prod",
		Server:       "https://prod.example.com",
		Token:        "prod-token",
		RefreshToken: "prod-refresh",
		TokenExpiry:  "2099-01-01T00:00:00Z",
	}
	cfg.Contexts["staging"] = &remote.Context{ //nolint:gosec // test fixture
		Name:         "staging",
		Server:       "https://staging.example.com",
		Token:        "staging-token",
		RefreshToken: "staging-refresh",
		TokenExpiry:  "2099-01-01T00:00:00Z",
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "prod"
	defer func() { cfgContext = oldCtx }()

	if err := logoutCmd.RunE(logoutCmd, nil); err != nil {
		t.Fatalf("logout: %v", err)
	}

	loaded, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	// Prod should be cleared.
	prod := loaded.GetContext("prod")
	if prod.Token != "" {
		t.Errorf("expected empty token for prod, got %q", prod.Token)
	}

	// Staging should be untouched.
	staging := loaded.GetContext("staging")
	if staging.Token != "staging-token" {
		t.Errorf("expected staging token preserved, got %q", staging.Token)
	}
}

func TestLogout_NonexistentContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "nonexistent"
	defer func() { cfgContext = oldCtx }()

	err := logoutCmd.RunE(logoutCmd, nil)
	if err == nil {
		t.Fatal("expected error for nonexistent context")
	}
}

func TestLogout_MultipleContextsNoFlag(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{Name: "a", Token: "tok-a"}
	cfg.Contexts["b"] = &remote.Context{Name: "b", Token: "tok-b"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := logoutCmd.RunE(logoutCmd, nil)
	if err == nil {
		t.Fatal("expected error when multiple contexts and no --context flag")
	}
}
