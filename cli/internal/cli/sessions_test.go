package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
)

// setupMockAPIServer creates a mock API server and configures a context to use it.
// Returns the server (must be closed by caller).
func setupMockAPIServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)

	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: srv.URL,
		Token:  "test-token", //nolint:gosec // test fixture
	}
	setupTestConfig(t, cfg)

	// Clear global flags so newAPIClient uses config.
	oldServer := cfgServer
	oldToken := cfgToken
	oldCtx := cfgContext
	cfgServer = ""
	cfgToken = ""
	cfgContext = ""
	t.Cleanup(func() {
		cfgServer = oldServer
		cfgToken = oldToken
		cfgContext = oldCtx
	})

	return srv
}

func TestSessionsList_Empty(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := sessionsListCmd.RunE(sessionsListCmd, nil); err != nil {
		t.Fatalf("sessions list: %v", err)
	}
}

func TestSessionsList_WithSessions(t *testing.T) {
	sessions := []api.Session{
		{
			ID:         "12345678-1234-1234-1234-123456789abc",
			Name:       "test-session",
			Status:     "running",
			Model:      "claude-sonnet-4",
			Repo:       "org/repo",
			Branch:     "main",
			TokensUsed: 100,
		},
	}

	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sessions)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := sessionsListCmd.RunE(sessionsListCmd, nil); err != nil {
		t.Fatalf("sessions list: %v", err)
	}
}

func TestSessionsList_JSON(t *testing.T) {
	sessions := []api.Session{
		{
			ID:     "12345678-1234-1234-1234-123456789abc",
			Name:   "test-session",
			Status: "running",
			Model:  "claude-sonnet-4",
		},
	}

	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sessions)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	if err := sessionsListCmd.RunE(sessionsListCmd, nil); err != nil {
		os.Stdout = old
		t.Fatalf("sessions list --json: %v", err)
	}

	_ = w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result []api.Session
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\noutput: %s", err, buf.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 session, got %d", len(result))
	}
	if result[0].Name != "test-session" {
		t.Errorf("expected name %q, got %q", "test-session", result[0].Name)
	}
}

func TestSessionsCreate(t *testing.T) {
	created := api.Session{
		ID:     "abc12345-1234-1234-1234-123456789abc",
		Name:   "new-session",
		Model:  "claude-sonnet-4",
		Status: "created",
	}

	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(created)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	// Set flags via the command's flag set.
	_ = sessionsCreateCmd.Flags().Set("name", "new-session")      //nolint:errcheck // test
	_ = sessionsCreateCmd.Flags().Set("repo", "org/repo")         //nolint:errcheck // test
	_ = sessionsCreateCmd.Flags().Set("model", "claude-sonnet-4") //nolint:errcheck // test
	_ = sessionsCreateCmd.Flags().Set("branch", "main")           //nolint:errcheck // test

	if err := sessionsCreateCmd.RunE(sessionsCreateCmd, nil); err != nil {
		t.Fatalf("sessions create: %v", err)
	}
}

func TestSessionsCreate_JSON(t *testing.T) {
	created := api.Session{
		ID:     "abc12345-1234-1234-1234-123456789abc",
		Name:   "new-session",
		Model:  "claude-sonnet-4",
		Status: "created",
	}

	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(created)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	_ = sessionsCreateCmd.Flags().Set("name", "new-session") //nolint:errcheck // test

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	if err := sessionsCreateCmd.RunE(sessionsCreateCmd, nil); err != nil {
		os.Stdout = old
		t.Fatalf("sessions create --json: %v", err)
	}

	_ = w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result api.Session
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v\noutput: %s", err, buf.String())
	}
	if result.Name != "new-session" {
		t.Errorf("expected name %q, got %q", "new-session", result.Name)
	}
}

func TestSessionsStart(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions/test-id/start" && r.Method == http.MethodPost {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if err := sessionsStartCmd.RunE(sessionsStartCmd, []string{"test-id"}); err != nil {
		t.Fatalf("sessions start: %v", err)
	}
}

func TestSessionsStop(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions/test-id/stop" && r.Method == http.MethodPost {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if err := sessionsStopCmd.RunE(sessionsStopCmd, []string{"test-id"}); err != nil {
		t.Fatalf("sessions stop: %v", err)
	}
}

func TestSessionsDelete(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/volundr/sessions/test-id" && r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if err := sessionsDeleteCmd.RunE(sessionsDeleteCmd, []string{"test-id"}); err != nil {
		t.Fatalf("sessions delete: %v", err)
	}
}

func TestSessionsList_ServerError(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sessionsListCmd.RunE(sessionsListCmd, nil)
	if err == nil {
		t.Fatal("expected error when server returns 500")
	}
}

func TestSessionsStart_ServerError(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sessionsStartCmd.RunE(sessionsStartCmd, []string{"test-id"})
	if err == nil {
		t.Fatal("expected error when server returns 500")
	}
}

func TestSessionsStop_ServerError(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sessionsStopCmd.RunE(sessionsStopCmd, []string{"test-id"})
	if err == nil {
		t.Fatal("expected error when server returns 500")
	}
}

func TestSessionsDelete_ServerError(t *testing.T) {
	srv := setupMockAPIServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	err := sessionsDeleteCmd.RunE(sessionsDeleteCmd, []string{"test-id"})
	if err == nil {
		t.Fatal("expected error when server returns 500")
	}
}

func TestNewAPIClient_ContextOverride(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "production",
		Server: "https://prod.example.com",
		Token:  "prod-token",
	}
	cfg.Contexts["staging"] = &remote.Context{
		Name:   "staging",
		Server: "https://staging.example.com",
		Token:  "staging-token",
	}
	setupTestConfig(t, cfg)

	oldServer := cfgServer
	oldToken := cfgToken
	oldCtx := cfgContext
	cfgServer = ""
	cfgToken = ""
	cfgContext = "staging"
	defer func() {
		cfgServer = oldServer
		cfgToken = oldToken
		cfgContext = oldCtx
	}()

	client, err := newAPIClient()
	if err != nil {
		t.Fatalf("newAPIClient: %v", err)
	}
	if client.BaseURL() != "https://staging.example.com" {
		t.Errorf("expected URL %q, got %q", "https://staging.example.com", client.BaseURL())
	}
}

func TestNewAPIClient_MultipleContextsNoFlag(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod", Server: "https://prod.example.com"}
	cfg.Contexts["staging"] = &remote.Context{Name: "staging", Server: "https://staging.example.com"}
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

	_, err := newAPIClient()
	if err == nil {
		t.Fatal("expected error when multiple contexts and no --context flag")
	}
}

func TestNewAPIClient_ServerFlagOnly(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: "https://config.example.com",
		Token:  "config-token",
	}
	setupTestConfig(t, cfg)

	oldServer := cfgServer
	oldToken := cfgToken
	oldCtx := cfgContext
	cfgServer = "https://override.example.com"
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
	if client.BaseURL() != "https://override.example.com" {
		t.Errorf("expected URL %q, got %q", "https://override.example.com", client.BaseURL())
	}
}
