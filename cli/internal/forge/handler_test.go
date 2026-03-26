package forge

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newTestHandler creates a Handler with an in-memory store and a no-op runner
// suitable for testing API routes that don't need real process spawning.
func newTestHandler(t *testing.T) (*Handler, *Store, *EventBus) {
	t.Helper()

	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Forge.MaxConcurrent = 10

	bus := NewEventBus()
	store := NewStore("")
	runner := NewRunner(cfg, store, bus)

	h := NewHandler(runner, store, bus, cfg)
	return h, store, bus
}

func TestHandler_Health(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestHandler_GetStats(t *testing.T) {
	h, store, _ := newTestHandler(t)
	store.Put(&Session{ID: "a", Status: StatusRunning})
	store.Put(&Session{ID: "b", Status: StatusStopped})

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/stats", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var stats StatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if stats.ActiveSessions != 1 {
		t.Errorf("expected 1 active session, got %d", stats.ActiveSessions)
	}
	if stats.TotalSessions != 2 {
		t.Errorf("expected 2 total sessions, got %d", stats.TotalSessions)
	}
}

func TestHandler_ListSessions_Empty(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var sessions []SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestHandler_GetSession_NotFound(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions/nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_GetSession_Found(t *testing.T) {
	h, store, _ := newTestHandler(t)
	store.Put(&Session{
		ID:     "sess-1",
		Name:   "test-session",
		Status: StatusRunning,
		Model:  "claude-sonnet-4-6",
	})

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions/sess-1", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sess.Name != "test-session" {
		t.Errorf("expected name 'test-session', got %q", sess.Name)
	}
	if sess.Model != "claude-sonnet-4-6" {
		t.Errorf("expected model 'claude-sonnet-4-6', got %q", sess.Model)
	}
}

func TestHandler_CreateSession_MissingName(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"model": "claude-sonnet-4-6"}`)
	req := httptest.NewRequest("POST", "/api/v1/volundr/sessions", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandler_StopSession_NotFound(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("POST", "/api/v1/volundr/sessions/nonexistent/stop", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_DeleteSession_NotFound(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("DELETE", "/api/v1/volundr/sessions/nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_GetMe(t *testing.T) {
	h, _, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/me", nil)
	req.Header.Set("X-Auth-User-Id", "alice")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var me map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if me["user_id"] != "alice" {
		t.Errorf("expected user_id 'alice', got %v", me["user_id"])
	}
}
