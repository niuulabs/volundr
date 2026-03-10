package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

// setupTestConfig creates a temp dir, sets HOME, and optionally seeds a config.
func setupTestConfig(t *testing.T, cfg *remote.Config) {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	if cfg != nil {
		configDir := filepath.Join(tmpDir, ".config", "volundr")
		if err := os.MkdirAll(configDir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := cfg.Save(); err != nil {
			t.Fatalf("save seed config: %v", err)
		}
	}
}

// --- Context command tests ---

func TestContextAdd(t *testing.T) {
	setupTestConfig(t, nil)

	contextAddServer = "https://prod.example.com"
	contextAddName = "production"
	contextAddIssuer = ""
	contextAddClientID = ""
	defer func() {
		contextAddServer = ""
		contextAddName = ""
	}()

	if err := contextAddCmd.RunE(contextAddCmd, []string{"prod"}); err != nil {
		t.Fatalf("context add: %v", err)
	}

	cfg, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ctx := cfg.GetContext("prod")
	if ctx == nil {
		t.Fatal("expected prod context to exist")
	}
	if ctx.Server != "https://prod.example.com" {
		t.Errorf("expected server %q, got %q", "https://prod.example.com", ctx.Server)
	}
	if ctx.Name != "production" {
		t.Errorf("expected name %q, got %q", "production", ctx.Name)
	}
}

func TestContextAdd_DuplicateKey(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod", Server: "https://prod.example.com"}
	setupTestConfig(t, cfg)

	contextAddServer = "https://other.example.com"
	contextAddName = ""
	defer func() { contextAddServer = "" }()

	err := contextAddCmd.RunE(contextAddCmd, []string{"prod"})
	if err == nil {
		t.Fatal("expected error adding duplicate context")
	}
}

func TestContextAdd_DefaultsNameToKey(t *testing.T) {
	setupTestConfig(t, nil)

	contextAddServer = "https://staging.example.com"
	contextAddName = ""
	defer func() { contextAddServer = "" }()

	if err := contextAddCmd.RunE(contextAddCmd, []string{"staging"}); err != nil {
		t.Fatalf("context add: %v", err)
	}

	cfg, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ctx := cfg.GetContext("staging")
	if ctx == nil {
		t.Fatal("expected staging context")
	}
	if ctx.Name != "staging" {
		t.Errorf("expected name %q, got %q", "staging", ctx.Name)
	}
}

func TestContextAdd_WithIssuer(t *testing.T) {
	setupTestConfig(t, nil)

	contextAddServer = "https://prod.example.com"
	contextAddName = ""
	contextAddIssuer = "https://idp.example.com"
	contextAddClientID = "my-client"
	defer func() {
		contextAddServer = ""
		contextAddIssuer = ""
		contextAddClientID = ""
	}()

	if err := contextAddCmd.RunE(contextAddCmd, []string{"prod"}); err != nil {
		t.Fatalf("context add: %v", err)
	}

	cfg, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ctx := cfg.GetContext("prod")
	if ctx.Issuer != "https://idp.example.com" {
		t.Errorf("expected issuer %q, got %q", "https://idp.example.com", ctx.Issuer)
	}
	if ctx.ClientID != "my-client" {
		t.Errorf("expected clientID %q, got %q", "my-client", ctx.ClientID)
	}
}

func TestContextList_Empty(t *testing.T) {
	setupTestConfig(t, nil)

	contextListJSON = false
	defer func() { contextListJSON = false }()

	if err := contextListCmd.RunE(contextListCmd, nil); err != nil {
		t.Fatalf("context list: %v", err)
	}
}

func TestContextList_WithContexts(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "production", Server: "https://prod.example.com", Token: "tok"}
	cfg.Contexts["staging"] = &remote.Context{Name: "staging", Server: "https://staging.example.com"}
	setupTestConfig(t, cfg)

	contextListJSON = false
	defer func() { contextListJSON = false }()

	if err := contextListCmd.RunE(contextListCmd, nil); err != nil {
		t.Fatalf("context list: %v", err)
	}
}

func TestContextList_JSON(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "production", Server: "https://prod.example.com", Token: "tok"}
	cfg.Contexts["dev"] = &remote.Context{Name: "dev", Server: "https://dev.example.com"}
	setupTestConfig(t, cfg)

	contextListJSON = true
	defer func() { contextListJSON = false }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	if err := contextListCmd.RunE(contextListCmd, nil); err != nil {
		os.Stdout = old
		t.Fatalf("context list --json: %v", err)
	}

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)

	var entries []contextListEntry
	if err := json.Unmarshal(buf.Bytes(), &entries); err != nil {
		t.Fatalf("unmarshal JSON output: %v\noutput: %s", err, buf.String())
	}

	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	found := false
	for _, e := range entries {
		if e.Key == "prod" && e.Authenticated {
			found = true
		}
	}
	if !found {
		t.Error("expected prod to show as authenticated")
	}
}

func TestContextRemove(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "production", Server: "https://prod.example.com"}
	setupTestConfig(t, cfg)

	if err := contextRemoveCmd.RunE(contextRemoveCmd, []string{"prod"}); err != nil {
		t.Fatalf("context remove: %v", err)
	}

	loaded, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.GetContext("prod") != nil {
		t.Error("expected prod context to be removed")
	}
}

func TestContextRemove_NotFound(t *testing.T) {
	setupTestConfig(t, nil)

	err := contextRemoveCmd.RunE(contextRemoveCmd, []string{"nonexistent"})
	if err == nil {
		t.Fatal("expected error removing non-existent context")
	}
}

func TestContextRename(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["old"] = &remote.Context{Name: "old", Server: "https://old.example.com"}
	setupTestConfig(t, cfg)

	if err := contextRenameCmd.RunE(contextRenameCmd, []string{"old", "new"}); err != nil {
		t.Fatalf("context rename: %v", err)
	}

	loaded, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.GetContext("old") != nil {
		t.Error("expected old key to be gone")
	}
	ctx := loaded.GetContext("new")
	if ctx == nil {
		t.Fatal("expected new key to exist")
	}
	if ctx.Server != "https://old.example.com" {
		t.Errorf("expected server preserved, got %q", ctx.Server)
	}
}

func TestContextRename_NotFound(t *testing.T) {
	setupTestConfig(t, nil)

	err := contextRenameCmd.RunE(contextRenameCmd, []string{"nonexistent", "new"})
	if err == nil {
		t.Fatal("expected error renaming non-existent context")
	}
}

// --- Login helper tests ---

func TestTokenStillValid_NoToken(t *testing.T) {
	rctx := &remote.Context{Token: "", TokenExpiry: "2099-01-01T00:00:00Z"}
	if tokenStillValid(rctx) {
		t.Error("expected false for empty token")
	}
}

func TestTokenStillValid_NoExpiry(t *testing.T) {
	rctx := &remote.Context{Token: "tok", TokenExpiry: ""}
	if tokenStillValid(rctx) {
		t.Error("expected false for empty expiry")
	}
}

func TestTokenStillValid_BadExpiry(t *testing.T) {
	rctx := &remote.Context{Token: "tok", TokenExpiry: "not-a-date"}
	if tokenStillValid(rctx) {
		t.Error("expected false for unparseable expiry")
	}
}

func TestTokenStillValid_Expired(t *testing.T) {
	rctx := &remote.Context{
		Token:       "tok",
		TokenExpiry: time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339),
	}
	if tokenStillValid(rctx) {
		t.Error("expected false for expired token")
	}
}

func TestTokenStillValid_ExpiresWithin30s(t *testing.T) {
	rctx := &remote.Context{
		Token:       "tok",
		TokenExpiry: time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339),
	}
	if tokenStillValid(rctx) {
		t.Error("expected false for token expiring within 30s")
	}
}

func TestTokenStillValid_Valid(t *testing.T) {
	rctx := &remote.Context{
		Token:       "tok",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	if !tokenStillValid(rctx) {
		t.Error("expected true for valid token")
	}
}

func TestSortedContextKeys(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["z"] = &remote.Context{Name: "z"}
	cfg.Contexts["a"] = &remote.Context{Name: "a"}
	cfg.Contexts["m"] = &remote.Context{Name: "m"}

	keys := sortedContextKeys(cfg)
	if len(keys) != 3 {
		t.Fatalf("expected 3 keys, got %d", len(keys))
	}
	if keys[0] != "a" || keys[1] != "m" || keys[2] != "z" {
		t.Errorf("expected sorted keys [a, m, z], got %v", keys)
	}
}

func TestSortedContextKeys_Empty(t *testing.T) {
	cfg := remote.DefaultConfig()
	keys := sortedContextKeys(cfg)
	if len(keys) != 0 {
		t.Errorf("expected 0 keys, got %d", len(keys))
	}
}

func TestResolveAuthConfig_BothFlags(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = "https://flag-issuer.com"
	loginClientID = "flag-client-id"
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	rctx := &remote.Context{
		Server:   "https://server.example.com",
		Issuer:   "https://saved-issuer.com",
		ClientID: "saved-client-id",
	}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://flag-issuer.com" {
		t.Errorf("expected flag issuer, got %q", issuer)
	}
	if clientID != "flag-client-id" {
		t.Errorf("expected flag client ID, got %q", clientID)
	}
}

func TestResolveAuthConfig_SavedContext(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	rctx := &remote.Context{
		Server:   "http://localhost:8000",
		Issuer:   "https://saved-issuer.com",
		ClientID: "saved-client-id",
	}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://saved-issuer.com" {
		t.Errorf("expected saved issuer, got %q", issuer)
	}
	if clientID != "saved-client-id" {
		t.Errorf("expected saved client ID, got %q", clientID)
	}
}

func TestResolveAuthConfig_NoConfig(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	rctx := &remote.Context{Server: ""}

	_, _, err := resolveAuthConfig(rctx)
	if err == nil {
		t.Fatal("expected error when no auth config available")
	}
}

func TestTryAuthDiscovery_EmptyServer(t *testing.T) {
	rctx := &remote.Context{Server: ""}
	result := tryAuthDiscovery(rctx)
	if result != nil {
		t.Error("expected nil for empty server")
	}
}

func TestTryAuthDiscovery_Localhost(t *testing.T) {
	rctx := &remote.Context{Server: "http://localhost:8000"}
	result := tryAuthDiscovery(rctx)
	if result != nil {
		t.Error("expected nil for localhost")
	}
}

func TestTryAuthDiscovery_ServerWithAuthConfig(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"issuer":    "https://idp.example.com",
			"client_id": "test-client",
		})
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}
	result := tryAuthDiscovery(rctx)
	if result == nil {
		t.Fatal("expected non-nil result from server with auth config")
	}
	if result.Issuer != "https://idp.example.com" {
		t.Errorf("expected issuer %q, got %q", "https://idp.example.com", result.Issuer)
	}
}

func TestTryAuthDiscovery_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}
	result := tryAuthDiscovery(rctx)
	if result != nil {
		t.Error("expected nil when server returns error")
	}
}

func TestTryAuthDiscovery_EmptyIssuerResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"issuer":    "",
			"client_id": "test-client",
		})
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}
	result := tryAuthDiscovery(rctx)
	if result != nil {
		t.Error("expected nil when issuer is empty")
	}
}

// --- Config get/set tests ---

func TestConfigGet_Theme(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Theme = "light"
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	if err := configGetCmd.RunE(configGetCmd, []string{"theme"}); err != nil {
		t.Fatalf("config get theme: %v", err)
	}
}

func TestConfigSet_Theme(t *testing.T) {
	setupTestConfig(t, nil)

	if err := configSetCmd.RunE(configSetCmd, []string{"theme", "light"}); err != nil {
		t.Fatalf("config set theme: %v", err)
	}

	cfg, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.Theme != "light" {
		t.Errorf("expected theme %q, got %q", "light", cfg.Theme)
	}
}

func TestConfigGet_Server(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{Name: "default", Server: "https://prod.example.com"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "default"
	defer func() { cfgContext = oldCtx }()

	if err := configGetCmd.RunE(configGetCmd, []string{"server"}); err != nil {
		t.Fatalf("config get server: %v", err)
	}
}

func TestConfigSet_Server(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{Name: "default", Server: "https://old.example.com"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "default"
	defer func() { cfgContext = oldCtx }()

	if err := configSetCmd.RunE(configSetCmd, []string{"server", "https://new.example.com"}); err != nil {
		t.Fatalf("config set server: %v", err)
	}

	loaded, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.GetContext("default").Server != "https://new.example.com" {
		t.Errorf("expected updated server")
	}
}

func TestConfigGet_UnknownKey(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{Name: "default"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "default"
	defer func() { cfgContext = oldCtx }()

	err := configGetCmd.RunE(configGetCmd, []string{"nonexistent"})
	if err == nil {
		t.Fatal("expected error for unknown key")
	}
}

func TestConfigSet_UnknownKey(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{Name: "default"}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "default"
	defer func() { cfgContext = oldCtx }()

	err := configSetCmd.RunE(configSetCmd, []string{"nonexistent", "value"})
	if err == nil {
		t.Fatal("expected error for unknown key")
	}
}

// --- Logout tests ---

func TestLogout(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:         "default",
		Server:       "https://prod.example.com",
		Token:        "my-token",
		RefreshToken: "my-refresh",
		TokenExpiry:  "2099-01-01T00:00:00Z",
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = "default"
	defer func() { cfgContext = oldCtx }()

	if err := logoutCmd.RunE(logoutCmd, nil); err != nil {
		t.Fatalf("logout: %v", err)
	}

	loaded, err := remote.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	ctx := loaded.GetContext("default")
	if ctx.Token != "" {
		t.Errorf("expected empty token after logout, got %q", ctx.Token)
	}
	if ctx.RefreshToken != "" {
		t.Errorf("expected empty refresh token after logout, got %q", ctx.RefreshToken)
	}
	if ctx.TokenExpiry != "" {
		t.Errorf("expected empty token expiry after logout, got %q", ctx.TokenExpiry)
	}
	if ctx.Server != "https://prod.example.com" {
		t.Errorf("expected server preserved, got %q", ctx.Server)
	}
}

func TestLogout_NoContext(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := logoutCmd.RunE(logoutCmd, nil)
	if err == nil {
		t.Fatal("expected error when no contexts configured")
	}
}

// --- formatDuration tests ---

func TestFormatDuration_Expired(t *testing.T) {
	got := formatDuration(-5 * time.Minute)
	if got != "expired" {
		t.Errorf("expected %q, got %q", "expired", got)
	}
}

func TestFormatDuration_LessThanMinute(t *testing.T) {
	got := formatDuration(10 * time.Second)
	if got != "less than a minute" {
		t.Errorf("expected %q, got %q", "less than a minute", got)
	}
}

func TestFormatDuration_Minutes(t *testing.T) {
	got := formatDuration(45 * time.Minute)
	if got != "in 45 minutes" {
		t.Errorf("expected %q, got %q", "in 45 minutes", got)
	}
}

func TestFormatDuration_Hours(t *testing.T) {
	got := formatDuration(2 * time.Hour)
	if got != "in 2 hours" {
		t.Errorf("expected %q, got %q", "in 2 hours", got)
	}
}

func TestFormatDuration_HoursAndMinutes(t *testing.T) {
	got := formatDuration(2*time.Hour + 30*time.Minute)
	if got != "in 2h 30m" {
		t.Errorf("expected %q, got %q", "in 2h 30m", got)
	}
}

// --- getContextValue / setContextValue tests ---

func TestGetContextValue_AllKeys(t *testing.T) {
	ctx := &remote.Context{
		Server:       "https://srv.com",
		Token:        "tok",
		RefreshToken: "ref",
		TokenExpiry:  "2099-01-01T00:00:00Z",
		Issuer:       "https://iss.com",
		ClientID:     "cid",
	}

	tests := map[string]string{
		"server":        "https://srv.com",
		"token":         "tok",
		"refresh_token": "ref",
		"token_expiry":  "2099-01-01T00:00:00Z",
		"issuer":        "https://iss.com",
		"client_id":     "cid",
		"client-id":     "cid",
	}

	for key, expected := range tests {
		val, err := getContextValue(ctx, key)
		if err != nil {
			t.Errorf("getContextValue(%q): %v", key, err)
		}
		if val != expected {
			t.Errorf("getContextValue(%q) = %q, want %q", key, val, expected)
		}
	}
}

func TestSetContextValue_AllKeys(t *testing.T) {
	ctx := &remote.Context{}

	tests := []struct {
		key   string
		value string
		check func() string
	}{
		{"server", "https://new.com", func() string { return ctx.Server }},
		{"token", "new-tok", func() string { return ctx.Token }},
		{"refresh_token", "new-ref", func() string { return ctx.RefreshToken }},
		{"token_expiry", "2099-06-01", func() string { return ctx.TokenExpiry }},
		{"issuer", "https://new-iss.com", func() string { return ctx.Issuer }},
		{"client-id", "new-cid", func() string { return ctx.ClientID }},
	}

	for _, tt := range tests {
		if err := setContextValue(ctx, tt.key, tt.value); err != nil {
			t.Errorf("setContextValue(%q): %v", tt.key, err)
		}
		if got := tt.check(); got != tt.value {
			t.Errorf("after setContextValue(%q): got %q, want %q", tt.key, got, tt.value)
		}
	}
}

func TestGetContextValue_Unknown(t *testing.T) {
	ctx := &remote.Context{}
	_, err := getContextValue(ctx, "bogus")
	if err == nil {
		t.Error("expected error for unknown key")
	}
}

func TestSetContextValue_Unknown(t *testing.T) {
	ctx := &remote.Context{}
	err := setContextValue(ctx, "bogus", "val")
	if err == nil {
		t.Error("expected error for unknown key")
	}
}

// --- newAPIClient tests ---

func TestNewAPIClient_SingleContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: "https://prod.example.com",
		Token:  "my-token",
	}
	setupTestConfig(t, cfg)

	oldServer := cfgServer
	oldToken := cfgToken
	oldCtx := cfgContext
	cfgServer = ""
	cfgToken = ""
	cfgContext = ""
	defer func() {
		cfgServer = oldServer
		cfgToken = oldToken
		cfgContext = oldCtx
	}()

	client, err := newAPIClient()
	if err != nil {
		t.Fatalf("newAPIClient: %v", err)
	}
	if client.BaseURL() != "https://prod.example.com" {
		t.Errorf("expected URL %q, got %q", "https://prod.example.com", client.BaseURL())
	}
}

func TestNewAPIClient_FlagOverride(t *testing.T) {
	setupTestConfig(t, nil)

	oldServer := cfgServer
	oldToken := cfgToken
	cfgServer = "https://cli-override.com"
	cfgToken = "cli-token"
	defer func() {
		cfgServer = oldServer
		cfgToken = oldToken
	}()

	client, err := newAPIClient()
	if err != nil {
		t.Fatalf("newAPIClient: %v", err)
	}
	if client.BaseURL() != "https://cli-override.com" {
		t.Errorf("expected URL %q, got %q", "https://cli-override.com", client.BaseURL())
	}
}

func TestNewAPIClient_NoContexts(t *testing.T) {
	setupTestConfig(t, nil)

	oldServer := cfgServer
	oldToken := cfgToken
	oldCtx := cfgContext
	cfgServer = ""
	cfgToken = ""
	cfgContext = ""
	defer func() {
		cfgServer = oldServer
		cfgToken = oldToken
		cfgContext = oldCtx
	}()

	_, err := newAPIClient()
	if err == nil {
		t.Fatal("expected error when no contexts configured")
	}
}
