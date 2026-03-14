package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestTokenStillValid_TableDriven(t *testing.T) {
	tests := []struct {
		name     string
		ctx      *remote.Context
		expected bool
	}{
		{
			name:     "empty token",
			ctx:      &remote.Context{Token: "", TokenExpiry: "2099-01-01T00:00:00Z"}, //nolint:gosec // G101: test fixture, not real credentials
			expected: false,
		},
		{
			name:     "empty expiry",
			ctx:      &remote.Context{Token: "tok", TokenExpiry: ""},
			expected: false,
		},
		{
			name:     "bad expiry format",
			ctx:      &remote.Context{Token: "tok", TokenExpiry: "not-a-date"},
			expected: false,
		},
		{
			name: "expired",
			ctx: &remote.Context{
				Token:       "tok",
				TokenExpiry: time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339),
			},
			expected: false,
		},
		{
			name: "expires within 30s",
			ctx: &remote.Context{
				Token:       "tok",
				TokenExpiry: time.Now().Add(10 * time.Second).UTC().Format(time.RFC3339),
			},
			expected: false,
		},
		{
			name: "exactly 30s",
			ctx: &remote.Context{
				Token:       "tok",
				TokenExpiry: time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339),
			},
			expected: false,
		},
		{
			name: "valid token",
			ctx: &remote.Context{
				Token:       "tok",
				TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tokenStillValid(tt.ctx)
			if got != tt.expected {
				t.Errorf("tokenStillValid() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestResolveAuthConfig_FlagIssuerOnly(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = "https://flag-issuer.com"
	loginClientID = ""
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	rctx := &remote.Context{
		Server:   "http://localhost:8000",
		Issuer:   "",
		ClientID: "saved-client-id",
	}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://flag-issuer.com" {
		t.Errorf("expected flag issuer, got %q", issuer)
	}
	if clientID != "saved-client-id" {
		t.Errorf("expected saved client ID, got %q", clientID)
	}
}

func TestResolveAuthConfig_FlagClientIDOnly(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = ""
	loginClientID = "flag-client-id"
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	rctx := &remote.Context{
		Server:   "http://localhost:8000",
		Issuer:   "https://saved-issuer.com",
		ClientID: "",
	}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://saved-issuer.com" {
		t.Errorf("expected saved issuer, got %q", issuer)
	}
	if clientID != "flag-client-id" {
		t.Errorf("expected flag client ID, got %q", clientID)
	}
}

func TestResolveAuthConfig_DiscoveryFromServer(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"issuer":    "https://discovered-issuer.com",
			"client_id": "discovered-client",
		})
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://discovered-issuer.com" {
		t.Errorf("expected discovered issuer, got %q", issuer)
	}
	if clientID != "discovered-client" {
		t.Errorf("expected discovered client ID, got %q", clientID)
	}
}

func TestResolveAuthConfig_DiscoveryFails_FallsBackToSaved(t *testing.T) {
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	rctx := &remote.Context{
		Server:   srv.URL,
		Issuer:   "https://saved-issuer.com",
		ClientID: "saved-client",
	}

	issuer, clientID, err := resolveAuthConfig(rctx)
	if err != nil {
		t.Fatalf("resolveAuthConfig: %v", err)
	}
	if issuer != "https://saved-issuer.com" {
		t.Errorf("expected saved issuer, got %q", issuer)
	}
	if clientID != "saved-client" {
		t.Errorf("expected saved client ID, got %q", clientID)
	}
}

func TestTryAuthDiscovery_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{invalid json`))
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}
	result := tryAuthDiscovery(rctx)
	if result != nil {
		t.Error("expected nil for invalid JSON response")
	}
}

func TestTryAuthDiscovery_SuccessfulDiscovery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"issuer":    "https://idp.example.com",
			"client_id": "test-client",
		})
	}))
	defer srv.Close()

	rctx := &remote.Context{Server: srv.URL}
	result := tryAuthDiscovery(rctx)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Issuer != "https://idp.example.com" {
		t.Errorf("expected issuer %q, got %q", "https://idp.example.com", result.Issuer)
	}
	if result.ClientID != "test-client" {
		t.Errorf("expected clientID %q, got %q", "test-client", result.ClientID)
	}
}

func TestSortedContextKeys_TableDriven(t *testing.T) {
	tests := []struct {
		name     string
		keys     []string
		expected []string
	}{
		{"empty", nil, []string{}},
		{"single", []string{"a"}, []string{"a"}},
		{"already sorted", []string{"a", "b", "c"}, []string{"a", "b", "c"}},
		{"reverse", []string{"z", "m", "a"}, []string{"a", "m", "z"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := remote.DefaultConfig()
			for _, k := range tt.keys {
				cfg.Contexts[k] = &remote.Context{Name: k}
			}

			got := sortedContextKeys(cfg)
			if len(got) != len(tt.expected) {
				t.Fatalf("expected %d keys, got %d", len(tt.expected), len(got))
			}
			for i, k := range got {
				if k != tt.expected[i] {
					t.Errorf("key[%d] = %q, want %q", i, k, tt.expected[i])
				}
			}
		})
	}
}

func TestLoginAllContexts_AllSkipped_ValidTokens(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{
		Name:        "a",
		Server:      "https://a.example.com",
		Token:       "tok-a",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	cfg.Contexts["b"] = &remote.Context{
		Name:        "b",
		Server:      "https://b.example.com",
		Token:       "tok-b",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	setupTestConfig(t, cfg)

	oldForce := loginForce
	loginForce = false
	defer func() { loginForce = oldForce }()

	// All tokens are valid, so all contexts should be skipped.
	err := loginAllContexts(cfg)
	if err != nil {
		t.Fatalf("loginAllContexts: %v", err)
	}
}

func TestLoginAllContexts_SkipNoServer(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{
		Name:   "a",
		Server: "",
	}
	setupTestConfig(t, cfg)

	oldForce := loginForce
	loginForce = false
	defer func() { loginForce = oldForce }()

	err := loginAllContexts(cfg)
	if err != nil {
		t.Fatalf("loginAllContexts: %v", err)
	}
}

func TestLoginAllContexts_SkipNoAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{
		Name:   "a",
		Server: srv.URL,
	}
	setupTestConfig(t, cfg)

	oldForce := loginForce
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginForce = false
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginForce = oldForce
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	err := loginAllContexts(cfg)
	if err != nil {
		t.Fatalf("loginAllContexts: %v", err)
	}
}

func TestLoginAllContexts_MixedSkippedAndNoAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	cfg := remote.DefaultConfig()
	cfg.Contexts["valid"] = &remote.Context{
		Name:        "valid",
		Server:      "https://valid.example.com",
		Token:       "tok",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	cfg.Contexts["no-server"] = &remote.Context{
		Name:   "no-server",
		Server: "",
	}
	cfg.Contexts["no-auth"] = &remote.Context{
		Name:   "no-auth",
		Server: srv.URL,
	}
	setupTestConfig(t, cfg)

	oldForce := loginForce
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	loginForce = false
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		loginForce = oldForce
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	err := loginAllContexts(cfg)
	if err != nil {
		t.Fatalf("loginAllContexts: %v", err)
	}
}

func TestLoginCmd_MultipleContexts_CallsLoginAll(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{
		Name:        "a",
		Server:      "https://a.example.com",
		Token:       "tok-a",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	cfg.Contexts["b"] = &remote.Context{
		Name:        "b",
		Server:      "https://b.example.com",
		Token:       "tok-b",
		TokenExpiry: time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339),
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	oldForce := loginForce
	cfgContext = ""
	loginForce = false
	defer func() {
		cfgContext = oldCtx
		loginForce = oldForce
	}()

	// With multiple contexts and no --context flag, login should try all.
	err := loginCmd.RunE(loginCmd, nil)
	if err != nil {
		t.Fatalf("login (multi-context): %v", err)
	}
}

func TestLoginCmd_SingleContext_NoIssuer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: srv.URL,
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	oldIssuer := loginIssuer
	oldClientID := loginClientID
	cfgContext = ""
	loginIssuer = ""
	loginClientID = ""
	defer func() {
		cfgContext = oldCtx
		loginIssuer = oldIssuer
		loginClientID = oldClientID
	}()

	// Single context but no issuer discoverable -> loginSingleContext should fail.
	err := loginCmd.RunE(loginCmd, nil)
	if err == nil {
		t.Fatal("expected error when no auth config available")
	}
}

func TestLoginCmd_NoContexts(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := loginCmd.RunE(loginCmd, nil)
	if err == nil {
		t.Fatal("expected error when no contexts configured")
	}
}
