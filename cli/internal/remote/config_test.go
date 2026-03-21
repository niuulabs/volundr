package remote

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Theme != "dark" {
		t.Errorf("expected theme %q, got %q", "dark", cfg.Theme)
	}

	if cfg.Contexts == nil {
		t.Fatal("expected non-nil Contexts map")
	}

	if len(cfg.Contexts) != 0 {
		t.Errorf("expected empty Contexts map, got %d entries", len(cfg.Contexts))
	}
}

func TestConfigDirUsesVolundrHome(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(envHome, tmpDir)

	dir, err := ConfigDir()
	if err != nil {
		t.Fatalf("config dir: %v", err)
	}
	if dir != tmpDir {
		t.Errorf("expected %q, got %q", tmpDir, dir)
	}
}

func TestConfigPathUsesVolundrHome(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(envHome, tmpDir)

	path, err := ConfigPath()
	if err != nil {
		t.Fatalf("config path: %v", err)
	}

	expected := filepath.Join(tmpDir, remotesFile)
	if path != expected {
		t.Errorf("expected %q, got %q", expected, path)
	}
}

func TestSaveAndLoadWithVolundrHome(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(envHome, tmpDir)

	cfg := DefaultConfig()
	cfg.Contexts["dev"] = &Context{
		Name:   "dev",
		Server: "https://dev.example.com",
		Token:  "tok-dev",
	}

	if err := cfg.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Verify the file was written to VOLUNDR_HOME/remotes.yaml.
	if _, err := os.Stat(filepath.Join(tmpDir, remotesFile)); err != nil {
		t.Fatalf("expected remotes.yaml in VOLUNDR_HOME: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	dev := loaded.GetContext("dev")
	if dev == nil {
		t.Fatal("expected dev context to exist")
	}
	if dev.Server != "https://dev.example.com" {
		t.Errorf("expected server %q, got %q", "https://dev.example.com", dev.Server)
	}
}

func TestConfigSaveAndLoad(t *testing.T) {
	// Use a temp directory as the config home.
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	cfg := DefaultConfig()
	cfg.Theme = "light"
	cfg.Contexts["prod"] = &Context{
		Name:   "production",
		Server: "https://prod.example.com",
		Token:  "tok-prod",
	}
	cfg.Contexts["staging"] = &Context{
		Name:   "staging",
		Server: "https://staging.example.com",
		Token:  "tok-staging",
	}

	if err := cfg.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if loaded.Theme != "light" {
		t.Errorf("expected theme %q, got %q", "light", loaded.Theme)
	}

	if len(loaded.Contexts) != 2 {
		t.Fatalf("expected 2 contexts, got %d", len(loaded.Contexts))
	}

	prod := loaded.GetContext("prod")
	if prod == nil {
		t.Fatal("expected prod context to exist")
	}
	if prod.Server != "https://prod.example.com" {
		t.Errorf("expected server %q, got %q", "https://prod.example.com", prod.Server)
	}
	if prod.Token != "tok-prod" {
		t.Errorf("expected token %q, got %q", "tok-prod", prod.Token)
	}
	if prod.Name != "production" {
		t.Errorf("expected name %q, got %q", "production", prod.Name)
	}

	staging := loaded.GetContext("staging")
	if staging == nil {
		t.Fatal("expected staging context to exist")
	}
	if staging.Server != "https://staging.example.com" {
		t.Errorf("expected server %q, got %q", "https://staging.example.com", staging.Server)
	}
}

func TestConfigMigration(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	// Write an old-format config.
	configDir := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	oldConfig := `server: https://old.example.com
token: old-token
theme: dark
`
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(oldConfig), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if cfg.Theme != "dark" {
		t.Errorf("expected theme %q, got %q", "dark", cfg.Theme)
	}

	if len(cfg.Contexts) != 1 {
		t.Fatalf("expected 1 context after migration, got %d", len(cfg.Contexts))
	}

	ctx := cfg.GetContext("default")
	if ctx == nil {
		t.Fatal("expected default context after migration")
	}
	if ctx.Server != "https://old.example.com" {
		t.Errorf("expected server %q, got %q", "https://old.example.com", ctx.Server)
	}
	if ctx.Token != "old-token" {
		t.Errorf("expected token %q, got %q", "old-token", ctx.Token)
	}
	if ctx.Name != "default" {
		t.Errorf("expected name %q, got %q", "default", ctx.Name)
	}

	// Save in new format and reload — should NOT trigger migration again.
	if err := cfg.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}

	reloaded, err := Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}

	if len(reloaded.Contexts) != 1 {
		t.Fatalf("expected 1 context after re-save, got %d", len(reloaded.Contexts))
	}

	rctx := reloaded.GetContext("default")
	if rctx == nil {
		t.Fatal("expected default context after re-save")
	}
	if rctx.Server != "https://old.example.com" {
		t.Errorf("expected server %q after re-save, got %q", "https://old.example.com", rctx.Server)
	}
}

func TestConfigMigrationPreservesAllFields(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	configDir := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	oldConfig := `server: https://full.example.com
token: my-token
refresh_token: my-refresh
token_expiry: "2025-12-31T23:59:59Z"
issuer: https://idp.example.com
client_id: my-client-id
theme: light
`
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(oldConfig), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if cfg.Theme != "light" {
		t.Errorf("expected theme %q, got %q", "light", cfg.Theme)
	}

	ctx := cfg.GetContext("default")
	if ctx == nil {
		t.Fatal("expected default context")
	}

	checks := map[string]string{
		"Server":       ctx.Server,
		"Token":        ctx.Token,
		"RefreshToken": ctx.RefreshToken,
		"TokenExpiry":  ctx.TokenExpiry,
		"Issuer":       ctx.Issuer,
		"ClientID":     ctx.ClientID,
		"Name":         ctx.Name,
	}
	expected := map[string]string{ //nolint:gosec // test fixture, not real credentials
		"Server":       "https://full.example.com",
		"Token":        "my-token",
		"RefreshToken": "my-refresh",
		"TokenExpiry":  "2025-12-31T23:59:59Z",
		"Issuer":       "https://idp.example.com",
		"ClientID":     "my-client-id",
		"Name":         "default",
	}

	for field, got := range checks {
		want := expected[field]
		if got != want {
			t.Errorf("%s: expected %q, got %q", field, want, got)
		}
	}
}

func TestAddContext(t *testing.T) {
	cfg := DefaultConfig()

	ctx := &Context{
		Name:   "prod",
		Server: "https://prod.example.com",
	}

	if err := cfg.AddContext("prod", ctx); err != nil {
		t.Fatalf("add: %v", err)
	}

	if len(cfg.Contexts) != 1 {
		t.Errorf("expected 1 context, got %d", len(cfg.Contexts))
	}

	if cfg.GetContext("prod") != ctx {
		t.Error("expected to get back the same context")
	}

	// Adding duplicate should fail.
	err := cfg.AddContext("prod", &Context{Name: "dup"})
	if err == nil {
		t.Error("expected error adding duplicate context")
	}
}

func TestRemoveContext(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["prod"] = &Context{Name: "prod", Server: "https://prod.example.com"}

	if err := cfg.RemoveContext("prod"); err != nil {
		t.Fatalf("remove: %v", err)
	}

	if len(cfg.Contexts) != 0 {
		t.Errorf("expected 0 contexts, got %d", len(cfg.Contexts))
	}

	// Removing non-existent should fail.
	err := cfg.RemoveContext("nonexistent")
	if err == nil {
		t.Error("expected error removing non-existent context")
	}
}

func TestRenameContext(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["old"] = &Context{Name: "old", Server: "https://old.example.com"}

	if err := cfg.RenameContext("old", "new"); err != nil {
		t.Fatalf("rename: %v", err)
	}

	if cfg.GetContext("old") != nil {
		t.Error("expected old key to be gone")
	}

	ctx := cfg.GetContext("new")
	if ctx == nil {
		t.Fatal("expected new key to exist")
	}
	if ctx.Name != "new" {
		t.Errorf("expected name to be updated to %q, got %q", "new", ctx.Name)
	}
	if ctx.Server != "https://old.example.com" {
		t.Errorf("expected server to be preserved, got %q", ctx.Server)
	}

	// Rename non-existent should fail.
	err := cfg.RenameContext("nonexistent", "something")
	if err == nil {
		t.Error("expected error renaming non-existent context")
	}

	// Rename to existing key should fail.
	cfg.Contexts["existing"] = &Context{Name: "existing"}
	err = cfg.RenameContext("new", "existing")
	if err == nil {
		t.Error("expected error renaming to existing key")
	}
}

func TestGetContext(t *testing.T) {
	cfg := DefaultConfig()
	ctx := &Context{Name: "test", Server: "https://test.example.com"}
	cfg.Contexts["test"] = ctx

	got := cfg.GetContext("test")
	if got != ctx {
		t.Error("expected to get the context back")
	}

	if cfg.GetContext("nonexistent") != nil {
		t.Error("expected nil for non-existent context")
	}
}

func TestClearTokens(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["prod"] = &Context{ //nolint:gosec // test fixture, not real credentials
		Name:         "prod",
		Server:       "https://prod.example.com",
		Token:        "my-token",
		RefreshToken: "my-refresh",
		TokenExpiry:  "2025-12-31T23:59:59Z",
		Issuer:       "https://idp.example.com",
		ClientID:     "my-client",
	}

	if err := cfg.ClearTokens("prod"); err != nil {
		t.Fatalf("clear tokens: %v", err)
	}

	ctx := cfg.GetContext("prod")
	if ctx.Token != "" {
		t.Errorf("expected empty token, got %q", ctx.Token)
	}
	if ctx.RefreshToken != "" {
		t.Errorf("expected empty refresh token, got %q", ctx.RefreshToken)
	}
	if ctx.TokenExpiry != "" {
		t.Errorf("expected empty token expiry, got %q", ctx.TokenExpiry)
	}

	// Non-token fields should be preserved.
	if ctx.Server != "https://prod.example.com" {
		t.Errorf("expected server preserved, got %q", ctx.Server)
	}
	if ctx.Issuer != "https://idp.example.com" {
		t.Errorf("expected issuer preserved, got %q", ctx.Issuer)
	}
	if ctx.ClientID != "my-client" {
		t.Errorf("expected client_id preserved, got %q", ctx.ClientID)
	}

	// Clear tokens for non-existent context should fail.
	err := cfg.ClearTokens("nonexistent")
	if err == nil {
		t.Error("expected error clearing tokens for non-existent context")
	}
}

func TestResolveContext_SingleContext(t *testing.T) {
	cfg := DefaultConfig()
	ctx := &Context{Name: "only", Server: "https://only.example.com"}
	cfg.Contexts["only"] = ctx

	// No key hint, single context — should auto-resolve.
	got, key, err := cfg.ResolveContext("")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if key != "only" {
		t.Errorf("expected key %q, got %q", "only", key)
	}
	if got != ctx {
		t.Error("expected the same context")
	}
}

func TestResolveContext_ExplicitKey(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["a"] = &Context{Name: "a"}
	cfg.Contexts["b"] = &Context{Name: "b"}

	got, key, err := cfg.ResolveContext("b")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if key != "b" {
		t.Errorf("expected key %q, got %q", "b", key)
	}
	if got.Name != "b" {
		t.Errorf("expected name %q, got %q", "b", got.Name)
	}
}

func TestResolveContext_MultipleNoHint(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["a"] = &Context{Name: "a"}
	cfg.Contexts["b"] = &Context{Name: "b"}

	_, _, err := cfg.ResolveContext("")
	if err == nil {
		t.Error("expected error when multiple contexts and no hint")
	}
}

func TestResolveContext_Empty(t *testing.T) {
	cfg := DefaultConfig()

	_, _, err := cfg.ResolveContext("")
	if err == nil {
		t.Error("expected error when no contexts configured")
	}
}

func TestResolveContext_NonExistentKey(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Contexts["a"] = &Context{Name: "a"}

	_, _, err := cfg.ResolveContext("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent key")
	}
}

func TestLoadNonExistentFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if cfg.Theme != "dark" {
		t.Errorf("expected default theme %q, got %q", "dark", cfg.Theme)
	}
	if len(cfg.Contexts) != 0 {
		t.Errorf("expected empty contexts, got %d", len(cfg.Contexts))
	}
}

func TestLoadInvalidYAML(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	configDir := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	// Write invalid YAML.
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(":::invalid"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	_, err := Load()
	if err == nil {
		t.Error("expected error loading invalid YAML")
	}
}

func TestConfigDir(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")
	t.Setenv(envHomeLegacy, "")

	dir, err := ConfigDir()
	if err != nil {
		t.Fatalf("config dir: %v", err)
	}

	expected := filepath.Join(tmpDir, ".config", "niuu")
	if dir != expected {
		t.Errorf("expected %q, got %q", expected, dir)
	}
}

func TestConfigDir_LegacyFallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")
	t.Setenv(envHomeLegacy, "")

	// Create the legacy directory so it's picked up as fallback.
	legacyPath := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(legacyPath, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	dir, err := ConfigDir()
	if err != nil {
		t.Fatalf("config dir: %v", err)
	}

	if dir != legacyPath {
		t.Errorf("expected legacy fallback %q, got %q", legacyPath, dir)
	}
}

func TestConfigPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")
	t.Setenv(envHomeLegacy, "")

	path, err := ConfigPath()
	if err != nil {
		t.Fatalf("config path: %v", err)
	}

	expected := filepath.Join(tmpDir, ".config", "niuu", "config.yaml")
	if path != expected {
		t.Errorf("expected %q, got %q", expected, path)
	}
}

func TestMigrationEmptyThemeDefaultsToDark(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	configDir := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	// Old format without a theme field.
	oldConfig := `server: https://notheme.example.com
token: tok
`
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(oldConfig), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if cfg.Theme != "dark" {
		t.Errorf("expected theme %q for empty migration, got %q", "dark", cfg.Theme)
	}
}

func TestLoadNewFormatWithNilContexts(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv(envHome, "")

	configDir := filepath.Join(tmpDir, ".config", "volundr")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	// New format but contexts key absent.
	newConfig := `theme: dark
`
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(newConfig), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	if cfg.Contexts == nil {
		t.Fatal("expected non-nil Contexts map")
	}
	if len(cfg.Contexts) != 0 {
		t.Errorf("expected 0 contexts, got %d", len(cfg.Contexts))
	}
}
