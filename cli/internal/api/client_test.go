package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestNewClient(t *testing.T) {
	c := NewClient("http://localhost:8000", "my-token")
	if c.baseURL != "http://localhost:8000" {
		t.Errorf("expected baseURL %q, got %q", "http://localhost:8000", c.baseURL)
	}
	if c.token != "my-token" {
		t.Errorf("expected token %q, got %q", "my-token", c.token)
	}
	if c.httpClient == nil {
		t.Fatal("expected non-nil httpClient")
	}
	if c.ctx != nil {
		t.Error("expected nil ctx for simple client")
	}
}

func TestNewClientWithContext(t *testing.T) {
	rctx := &remote.Context{
		Name:   "test",
		Server: "https://test.example.com",
		Issuer: "https://idp.example.com",
	}
	cfg := remote.DefaultConfig()

	c := NewClientWithContext("https://test.example.com", "tok", rctx, cfg)
	if c.baseURL != "https://test.example.com" {
		t.Errorf("expected baseURL %q, got %q", "https://test.example.com", c.baseURL)
	}
	if c.token != "tok" {
		t.Errorf("expected token %q, got %q", "tok", c.token)
	}
	if c.ctx != rctx {
		t.Error("expected ctx to be the provided context")
	}
	if c.cfg != cfg {
		t.Error("expected cfg to be the provided config")
	}
}

func TestListSessions(t *testing.T) {
	sessions := []Session{
		{ID: "s1", Name: "session-1", Status: "running"},
		{ID: "s2", Name: "session-2", Status: "stopped"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if r.Method != "GET" {
			t.Errorf("unexpected method %q", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("unexpected auth header %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "test-token")
	got, err := c.ListSessions()
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(got))
	}
	if got[0].ID != "s1" {
		t.Errorf("expected first session ID %q, got %q", "s1", got[0].ID)
	}
	if got[1].Status != "stopped" {
		t.Errorf("expected second session status %q, got %q", "stopped", got[1].Status)
	}
}

func TestListSessions_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestGetSession(t *testing.T) {
	session := Session{ID: "abc", Name: "my-session", Status: "running", Model: "claude"}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions/abc" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GetSession("abc")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.ID != "abc" {
		t.Errorf("expected ID %q, got %q", "abc", got.ID)
	}
	if got.Model != "claude" {
		t.Errorf("expected model %q, got %q", "claude", got.Model)
	}
}

func TestCreateSession(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("unexpected method %q", r.Method)
		}
		if r.URL.Path != "/api/v1/volundr/sessions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}

		var create SessionCreate
		json.NewDecoder(r.Body).Decode(&create)
		if create.Name != "new-session" {
			t.Errorf("expected name %q, got %q", "new-session", create.Name)
		}

		resp := Session{ID: "new-id", Name: create.Name, Status: "creating"}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.CreateSession(SessionCreate{Name: "new-session", Model: "claude"})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if got.ID != "new-id" {
		t.Errorf("expected ID %q, got %q", "new-id", got.ID)
	}
}

func TestStartSession(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("unexpected method %q", r.Method)
		}
		if r.URL.Path != "/api/v1/volundr/sessions/s1/start" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.StartSession("s1"); err != nil {
		t.Fatalf("StartSession: %v", err)
	}
}

func TestStopSession(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions/s1/stop" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.StopSession("s1"); err != nil {
		t.Fatalf("StopSession: %v", err)
	}
}

func TestDeleteSession(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("unexpected method %q", r.Method)
		}
		if r.URL.Path != "/api/v1/volundr/sessions/s1" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.DeleteSession("s1"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
}

func TestListModels(t *testing.T) {
	models := []ModelInfo{
		{ID: "m1", Name: "Claude", Provider: "anthropic"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/models" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListModels()
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 model, got %d", len(got))
	}
	if got[0].Provider != "anthropic" {
		t.Errorf("expected provider %q, got %q", "anthropic", got[0].Provider)
	}
}

func TestGetStats(t *testing.T) {
	stats := StatsResponse{TotalSessions: 42, ActiveSessions: 5}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/stats" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if got.TotalSessions != 42 {
		t.Errorf("expected TotalSessions 42, got %d", got.TotalSessions)
	}
}

func TestGetAuthConfig(t *testing.T) {
	authResp := AuthDiscoveryResponse{
		Issuer:   "https://idp.example.com",
		ClientID: "my-client",
		Scopes:   "openid profile",
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/auth/config" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		// Should NOT have Authorization header.
		if r.Header.Get("Authorization") != "" {
			t.Error("GetAuthConfig should not send Authorization header")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(authResp)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GetAuthConfig()
	if err != nil {
		t.Fatalf("GetAuthConfig: %v", err)
	}
	if got.Issuer != "https://idp.example.com" {
		t.Errorf("expected issuer %q, got %q", "https://idp.example.com", got.Issuer)
	}
	if got.ClientID != "my-client" {
		t.Errorf("expected client_id %q, got %q", "my-client", got.ClientID)
	}
}

func TestAuthHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer my-secret-token" {
			t.Errorf("expected Bearer auth header, got %q", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "my-secret-token")
	_, _ = c.ListSessions()
}

func TestAuthHeader_Empty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "" {
			t.Errorf("expected no auth header, got %q", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "")
	_, _ = c.ListSessions()
}

func TestEnsureValidToken_NoRefresh(t *testing.T) {
	// Client without context should not panic.
	c := NewClient("http://localhost", "tok")
	c.ensureValidToken() // should be a no-op

	// Client with context but no refresh token.
	c2 := NewClientWithContext("http://localhost", "tok", &remote.Context{
		Name:   "test",
		Token:  "tok",
		Issuer: "https://idp.example.com",
	}, nil)
	c2.ensureValidToken() // should be a no-op (no refresh token)
	if c2.token != "tok" {
		t.Errorf("token should be unchanged, got %q", c2.token)
	}
}

func TestEnsureValidToken_NotExpired(t *testing.T) {
	// Token that expires far in the future -- should not attempt refresh.
	futureExpiry := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	rctx := &remote.Context{
		Name:         "test",
		Token:        "valid-tok",
		RefreshToken: "refresh-tok",
		TokenExpiry:  futureExpiry,
		Issuer:       "https://idp.example.com",
		ClientID:     "client-id",
	}

	c := NewClientWithContext("http://localhost", "valid-tok", rctx, nil)
	c.ensureValidToken()
	if c.token != "valid-tok" {
		t.Errorf("expected token unchanged, got %q", c.token)
	}
}

func TestEnsureValidToken_BadExpiry(t *testing.T) {
	rctx := &remote.Context{
		Name:         "test",
		Token:        "tok",
		RefreshToken: "refresh-tok",
		TokenExpiry:  "not-a-date",
		Issuer:       "https://idp.example.com",
		ClientID:     "client-id",
	}

	c := NewClientWithContext("http://localhost", "tok", rctx, nil)
	c.ensureValidToken() // should be a no-op due to parse error
	if c.token != "tok" {
		t.Errorf("expected token unchanged, got %q", c.token)
	}
}

func TestEnsureValidToken_MissingIssuer(t *testing.T) {
	// Token expired but no issuer configured -- should skip refresh.
	pastExpiry := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	rctx := &remote.Context{
		Name:         "test",
		Token:        "expired-tok",
		RefreshToken: "refresh-tok",
		TokenExpiry:  pastExpiry,
		Issuer:       "",
		ClientID:     "client-id",
	}

	c := NewClientWithContext("http://localhost", "expired-tok", rctx, nil)
	c.ensureValidToken()
	if c.token != "expired-tok" {
		t.Errorf("expected token unchanged, got %q", c.token)
	}
}

func TestEnsureValidToken_MissingClientID(t *testing.T) {
	pastExpiry := time.Now().Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	rctx := &remote.Context{
		Name:         "test",
		Token:        "expired-tok",
		RefreshToken: "refresh-tok",
		TokenExpiry:  pastExpiry,
		Issuer:       "https://idp.example.com",
		ClientID:     "",
	}

	c := NewClientWithContext("http://localhost", "expired-tok", rctx, nil)
	c.ensureValidToken()
	if c.token != "expired-tok" {
		t.Errorf("expected token unchanged, got %q", c.token)
	}
}

func TestDecodeResponse_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for 403 response")
	}
}

func TestDecodeResponse_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not valid json"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for invalid JSON response")
	}
}

func TestToken_Accessor(t *testing.T) {
	c := NewClient("http://localhost", "my-tok")
	if c.Token() != "my-tok" {
		t.Errorf("expected %q, got %q", "my-tok", c.Token())
	}
}

func TestBaseURL_Accessor(t *testing.T) {
	c := NewClient("http://localhost:9000", "tok")
	if c.BaseURL() != "http://localhost:9000" {
		t.Errorf("expected %q, got %q", "http://localhost:9000", c.BaseURL())
	}
}

func TestStartSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("session not found"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	err := c.StartSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestStopSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("already stopped"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	err := c.StopSession("s1")
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
}

func TestDeleteSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	err := c.DeleteSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for 404 response")
	}
}

func TestListChronicles(t *testing.T) {
	chronicles := []Chronicle{
		{ID: "c1", SessionID: "s1", Status: "completed"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/chronicles" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(chronicles)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListChronicles()
	if err != nil {
		t.Fatalf("ListChronicles: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 chronicle, got %d", len(got))
	}
	if got[0].ID != "c1" {
		t.Errorf("expected ID %q, got %q", "c1", got[0].ID)
	}
}

func TestGetTimeline(t *testing.T) {
	resp := TimelineResponse{
		Events: []TimelineEvent{
			{T: 0, Type: "message", Label: "hello"},
		},
		Files:     []TimelineFile{},
		Commits:   []TimelineCommit{},
		TokenBurn: []int{100},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/chronicles/s1/timeline" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GetTimeline("s1")
	if err != nil {
		t.Fatalf("GetTimeline: %v", err)
	}
	if len(got.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got.Events))
	}
}

// --- WebSocket client tests ---

func TestNewWSClient(t *testing.T) {
	ws := NewWSClient("http://localhost:8000", "my-token")
	if ws.baseURL != "ws://localhost:8000" {
		t.Errorf("expected ws URL, got %q", ws.baseURL)
	}
	if ws.token != "my-token" {
		t.Errorf("expected token %q, got %q", "my-token", ws.token)
	}
	if ws.state != WSDisconnected {
		t.Errorf("expected disconnected, got %v", ws.state)
	}
}

func TestNewWSClient_HTTPS(t *testing.T) {
	ws := NewWSClient("https://secure.example.com", "tok")
	if ws.baseURL != "wss://secure.example.com" {
		t.Errorf("expected wss URL, got %q", ws.baseURL)
	}
}

func TestWSClient_State_Initial(t *testing.T) {
	ws := NewWSClient("http://localhost", "")
	if ws.State() != WSDisconnected {
		t.Errorf("expected disconnected, got %v", ws.State())
	}
}

func TestWSClient_SendText_NotConnected(t *testing.T) {
	ws := NewWSClient("http://localhost", "")
	err := ws.SendText("hello")
	if err == nil {
		t.Fatal("expected error sending text without connection")
	}
}

func TestWSClient_SendRaw_NotConnected(t *testing.T) {
	ws := NewWSClient("http://localhost", "")
	err := ws.SendRaw([]byte("data"))
	if err == nil {
		t.Fatal("expected error sending raw without connection")
	}
}

func TestWSClient_Close_NilConn(t *testing.T) {
	ws := NewWSClient("http://localhost", "")
	err := ws.Close()
	if err != nil {
		t.Fatalf("expected nil error closing nil conn, got %v", err)
	}
}

func TestWSClient_SetState_Callback(t *testing.T) {
	ws := NewWSClient("http://localhost", "")
	var got WSState
	ws.OnStateChange = func(s WSState) {
		got = s
	}
	ws.setState(WSConnecting)
	if got != WSConnecting {
		t.Errorf("expected connecting, got %v", got)
	}
}

func TestWSState_String(t *testing.T) {
	tests := []struct {
		state WSState
		want  string
	}{
		{WSDisconnected, "disconnected"},
		{WSConnecting, "connecting"},
		{WSConnected, "connected"},
		{WSReconnecting, "reconnecting"},
		{WSState(99), "unknown"},
	}
	for _, tt := range tests {
		got := tt.state.String()
		if got != tt.want {
			t.Errorf("WSState(%d).String() = %q, want %q", tt.state, got, tt.want)
		}
	}
}

func TestWSClient_Connect_InvalidURL(t *testing.T) {
	ws := NewWSClient("http://127.0.0.1:1", "tok")
	err := ws.Connect("/ws/test")
	if err == nil {
		t.Fatal("expected error connecting to invalid address")
	}
	if ws.State() != WSDisconnected {
		t.Errorf("expected disconnected after failed connect, got %v", ws.State())
	}
}

// --- Terminal WebSocket client tests ---

func TestNewTerminalWSClient(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost:8000", "tok")
	if tw.baseURL != "ws://localhost:8000" {
		t.Errorf("expected ws URL, got %q", tw.baseURL)
	}
	if tw.token != "tok" {
		t.Errorf("expected token %q, got %q", "tok", tw.token)
	}
	if tw.state != WSDisconnected {
		t.Errorf("expected disconnected, got %v", tw.state)
	}
}

func TestNewTerminalWSClient_HTTPS(t *testing.T) {
	tw := NewTerminalWSClient("https://secure.example.com", "tok")
	if tw.baseURL != "wss://secure.example.com" {
		t.Errorf("expected wss URL, got %q", tw.baseURL)
	}
}

func TestTerminalWSClient_State_Initial(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost", "")
	if tw.State() != WSDisconnected {
		t.Errorf("expected disconnected, got %v", tw.State())
	}
}

func TestTerminalWSClient_SendRaw_NotConnected(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost", "")
	err := tw.SendRaw([]byte("data"))
	if err == nil {
		t.Fatal("expected error sending raw without connection")
	}
}

func TestTerminalWSClient_SendResize_NotConnected(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost", "")
	err := tw.SendResize(80, 24)
	if err == nil {
		t.Fatal("expected error sending resize without connection")
	}
}

func TestTerminalWSClient_Close_NilConn(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost", "")
	err := tw.Close()
	if err != nil {
		t.Fatalf("expected nil error closing nil conn, got %v", err)
	}
}

func TestTerminalWSClient_SetState_Callback(t *testing.T) {
	tw := NewTerminalWSClient("http://localhost", "")
	var got WSState
	tw.OnStateChange = func(s WSState) {
		got = s
	}
	tw.setState(WSConnected)
	if got != WSConnected {
		t.Errorf("expected connected, got %v", got)
	}
}

func TestTerminalWSClient_Connect_InvalidURL(t *testing.T) {
	tw := NewTerminalWSClient("http://127.0.0.1:1", "tok")
	err := tw.Connect("/ws/terminal")
	if err == nil {
		t.Fatal("expected error connecting to invalid address")
	}
	if tw.State() != WSDisconnected {
		t.Errorf("expected disconnected after failed connect, got %v", tw.State())
	}
}

// --- SSE client tests ---

func TestNewSSEClient(t *testing.T) {
	sse := NewSSEClient("http://localhost:8000", "my-token")
	if sse.baseURL != "http://localhost:8000" {
		t.Errorf("expected baseURL %q, got %q", "http://localhost:8000", sse.baseURL)
	}
	if sse.token != "my-token" {
		t.Errorf("expected token %q, got %q", "my-token", sse.token)
	}
	if sse.client == nil {
		t.Error("expected non-nil http client")
	}
}

func TestSSEClient_Close_Idempotent(t *testing.T) {
	sse := NewSSEClient("http://localhost", "tok")
	// Close without ever connecting should not panic.
	sse.Close()
	// Double close should not panic.
	sse.Close()
}

func TestSSEClient_Connect_NonOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	sse := NewSSEClient(srv.URL, "tok")
	err := sse.Connect("/events")
	if err == nil {
		t.Fatal("expected error for non-200 SSE response")
	}
}

func TestSSEClient_Connect_ParsesEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("expected Accept: text/event-stream, got %q", r.Header.Get("Accept"))
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("unexpected auth header %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("server does not support flushing")
		}
		fmt.Fprintf(w, "id: 1\nevent: update\ndata: hello world\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	sse := NewSSEClient(srv.URL, "tok")

	received := make(chan SSEEvent, 1)
	sse.OnEvent = func(e SSEEvent) {
		received <- e
	}

	if err := sse.Connect("/events"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case evt := <-received:
		if evt.ID != "1" {
			t.Errorf("expected event ID %q, got %q", "1", evt.ID)
		}
		if evt.Event != "update" {
			t.Errorf("expected event type %q, got %q", "update", evt.Event)
		}
		if evt.Data != "hello world" {
			t.Errorf("expected data %q, got %q", "hello world", evt.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for SSE event")
	}

	sse.Close()
}

func TestSSEClient_Connect_MultilineData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		fmt.Fprintf(w, "data: line one\ndata: line two\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	sse := NewSSEClient(srv.URL, "")

	received := make(chan SSEEvent, 1)
	sse.OnEvent = func(e SSEEvent) {
		received <- e
	}

	if err := sse.Connect("/events"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case evt := <-received:
		if !strings.Contains(evt.Data, "line one") || !strings.Contains(evt.Data, "line two") {
			t.Errorf("expected multiline data, got %q", evt.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for SSE event")
	}

	sse.Close()
}

func TestSSEClient_Connect_NoAuthHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("expected no Authorization header for empty token")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Close immediately.
	}))
	defer srv.Close()

	sse := NewSSEClient(srv.URL, "")
	if err := sse.Connect("/events"); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	sse.Close()
}

// --- do() method edge cases ---

func TestDo_ContentTypeJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", r.Header.Get("Content-Type"))
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	resp, err := c.do("GET", "/api/test", nil)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	resp.Body.Close()
}

func TestDo_WithBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if body["key"] != "value" {
			t.Errorf("expected body key=value, got %v", body)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	resp, err := c.do("POST", "/api/test", map[string]string{"key": "value"})
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	resp.Body.Close()
}

func TestGetAuthConfig_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.GetAuthConfig()
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestGetSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("not found"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.GetSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestCreateSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("invalid"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.CreateSession(SessionCreate{Name: "test"})
	if err == nil {
		t.Fatal("expected error for 400")
	}
}
