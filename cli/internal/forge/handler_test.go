package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockRunner implements SessionRunner for handler tests.
type mockRunner struct {
	sessions map[string]*Session
}

func newMockRunner() *mockRunner {
	return &mockRunner{sessions: make(map[string]*Session)}
}

func (m *mockRunner) CreateAndStart(_ context.Context, req CreateSessionRequest, ownerID string) (*Session, error) {
	sess := &Session{
		ID:      "mock-id",
		Name:    req.Name,
		Model:   req.Model,
		Status:  StatusStarting,
		OwnerID: ownerID,
	}
	m.sessions[sess.ID] = sess
	return sess, nil
}

func (m *mockRunner) Stop(id string) error {
	sess := m.sessions[id]
	if sess == nil {
		return ErrSessionNotFound
	}
	sess.Status = StatusStopped
	return nil
}

func (m *mockRunner) Delete(id string) error {
	if m.sessions[id] == nil {
		return ErrSessionNotFound
	}
	delete(m.sessions, id)
	return nil
}

func (m *mockRunner) SendMessage(id string, _ string) error {
	sess := m.sessions[id]
	if sess == nil {
		return ErrSessionNotFound
	}
	if sess.Status != StatusRunning {
		return ErrSessionNotRunning
	}
	return nil
}

func (m *mockRunner) StopAll() {
	for _, s := range m.sessions {
		s.Status = StatusStopped
	}
}

func (m *mockRunner) ListSessions() []*Session {
	result := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		cp := *s
		result = append(result, &cp)
	}
	return result
}

func (m *mockRunner) GetSession(id string) *Session {
	s := m.sessions[id]
	if s == nil {
		return nil
	}
	cp := *s
	return &cp
}

func (m *mockRunner) GetStats() StatsResponse {
	active := 0
	for _, s := range m.sessions {
		if s.Status == StatusRunning {
			active++
		}
	}
	return StatsResponse{ActiveSessions: active, TotalSessions: len(m.sessions)}
}

func (m *mockRunner) GetPRStatus(id string) (PRStatusResponse, error) {
	if m.sessions[id] == nil {
		return PRStatusResponse{}, ErrSessionNotFound
	}
	return PRStatusResponse{State: ActivityStateNone}, nil
}

func (m *mockRunner) GetChronicle(id string) (string, error) {
	if m.sessions[id] == nil {
		return "", ErrSessionNotFound
	}
	return "mock chronicle", nil
}

func (m *mockRunner) SubscribeActivity() (string, <-chan ActivityEvent) {
	ch := make(chan ActivityEvent, 64)
	return "mock-sub", ch
}

func (m *mockRunner) UnsubscribeActivity(_ string) {}

// newTestHandler creates a Handler backed by a mockRunner.
func newTestHandler(t *testing.T) (*Handler, *mockRunner) {
	t.Helper()
	mock := newMockRunner()
	h := NewHandler(mock)
	return h, mock
}

func TestHandler_Health(t *testing.T) {
	h, _ := newTestHandler(t)
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
	h, mock := newTestHandler(t)
	mock.sessions["a"] = &Session{ID: "a", Status: StatusRunning}
	mock.sessions["b"] = &Session{ID: "b", Status: StatusStopped}

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
	h, _ := newTestHandler(t)
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
	h, _ := newTestHandler(t)
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
	h, mock := newTestHandler(t)
	mock.sessions["sess-1"] = &Session{
		ID:     "sess-1",
		Name:   "test-session",
		Status: StatusRunning,
		Model:  "claude-sonnet-4-6",
	}

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
	h, _ := newTestHandler(t)
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
	h, _ := newTestHandler(t)
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
	h, _ := newTestHandler(t)
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
	h, _ := newTestHandler(t)
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

func TestHandler_GetPRStatus_NotFound(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions/nonexistent/pr", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_GetChronicle_NotFound(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions/nonexistent/chronicle", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}
