package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/broker"
)

// mockRunner implements SessionRunner for handler tests.
type mockRunner struct {
	sessions map[string]*Session
}

func newMockRunner() *mockRunner {
	return &mockRunner{sessions: make(map[string]*Session)}
}

func (m *mockRunner) CreateAndStart(_ context.Context, req *CreateSessionRequest, ownerID string) (*Session, error) {
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

func (m *mockRunner) SendMessage(id, _ string) error {
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

func (m *mockRunner) SubscribeActivity() (id string, ch <-chan ActivityEvent) {
	raw := make(chan ActivityEvent, 64)
	return "mock-sub", raw
}

func (m *mockRunner) UnsubscribeActivity(_ string) {}

func (m *mockRunner) GetBroker(_ string) *broker.Broker { return nil }

// newTestHandler creates a Handler backed by a mockRunner.
func newTestHandler(t *testing.T) (*Handler, *mockRunner) {
	t.Helper()
	mock := newMockRunner()
	h := NewHandler(mock, DefaultForgeConfig(), nil)
	return h, mock
}

func TestHandler_Health(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/stats", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/nonexistent", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/sess-1", http.NoBody)
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
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions", body)
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

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/nonexistent/stop", http.NoBody)
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

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/volundr/sessions/nonexistent", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/me", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/nonexistent/pr", http.NoBody)
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

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/nonexistent/chronicle", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_CreateSession_Success(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"name":"my-session","model":"claude-sonnet-4-6"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "alice")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sess.Name != "my-session" {
		t.Errorf("expected name 'my-session', got %q", sess.Name)
	}
	if sess.OwnerID != "alice" {
		t.Errorf("expected owner 'alice', got %q", sess.OwnerID)
	}
}

func TestHandler_CreateSession_InvalidBody(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{invalid json}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandler_CreateSession_DefaultOwner(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"name":"my-session"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rec.Code)
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sess.OwnerID != "local" {
		t.Errorf("expected default owner 'local', got %q", sess.OwnerID)
	}
}

func TestHandler_StopSession_Success(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/stop", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestHandler_DeleteSession_Success(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusStopped}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/volundr/sessions/s1", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}
}

func TestHandler_SendMessage_Success(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"content":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/messages", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_SendMessage_NotFound(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"content":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/nonexistent/messages", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_SendMessage_NotRunning(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusStopped}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"content":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/messages", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
}

func TestHandler_SendMessage_InvalidBody(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{bad json}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/messages", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandler_GetPRStatus_Found(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/s1/pr", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var pr PRStatusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &pr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if pr.State != ActivityStateNone {
		t.Errorf("expected state 'none', got %q", pr.State)
	}
}

func TestHandler_GetChronicle_Found(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/s1/chronicle", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var chronicle ChronicleResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &chronicle); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if chronicle.Summary != "mock chronicle" {
		t.Errorf("expected 'mock chronicle', got %q", chronicle.Summary)
	}
}

func TestHandler_GetMe_DefaultOwner(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/me", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var me map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if me["user_id"] != "local" {
		t.Errorf("expected default user_id 'local', got %v", me["user_id"])
	}
}

func TestHandler_StartSession_NotFound(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/nonexistent/start", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_StartSession_AlreadyRunning(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Name: "test", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/start", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestHandler_StartSession_RestartsStopped(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{
		ID:     "s1",
		Name:   "test",
		Status: StatusStopped,
		Model:  "claude-sonnet-4-6",
	}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/start", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "bob")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if sess.OwnerID != "bob" {
		t.Errorf("expected owner 'bob', got %q", sess.OwnerID)
	}
}

func TestHandler_StreamActivity(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning, OwnerID: "alice"}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/stream", http.NoBody).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		mux.ServeHTTP(rec, req)
		close(done)
	}()

	// Cancel quickly to end SSE stream.
	cancel()
	<-done

	if rec.Header().Get("Content-Type") != "text/event-stream" {
		t.Errorf("expected text/event-stream, got %q", rec.Header().Get("Content-Type"))
	}
	if rec.Body.Len() == 0 {
		t.Error("expected initial snapshot in body")
	}
}

func TestHandler_StopSession_DeletedDuringStop(t *testing.T) {
	// Test the path where session is gone after stop (NoContent response).
	mock := newMockRunner()
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	// Override Stop to also delete the session.
	h := NewHandler(&deletingStopRunner{mockRunner: *mock}, DefaultForgeConfig())

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/stop", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}
}

// deletingStopRunner is a mock that removes the session on Stop.
type deletingStopRunner struct {
	mockRunner
}

func (m *deletingStopRunner) Stop(id string) error {
	delete(m.sessions, id)
	return nil
}

func TestHandler_CreateSession_RunnerError(t *testing.T) {
	// Use a mock that returns error from CreateAndStart (max concurrent).
	mock := newMockRunner()
	mock.sessions["existing"] = &Session{ID: "existing", Status: StatusRunning}

	h := NewHandler(&maxConcurrentRunner{mockRunner: *mock}, DefaultForgeConfig())

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"name":"overflow"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
}

// maxConcurrentRunner always fails CreateAndStart.
type maxConcurrentRunner struct {
	mockRunner
}

func (m *maxConcurrentRunner) CreateAndStart(_ context.Context, _ *CreateSessionRequest, _ string) (*Session, error) {
	return nil, fmt.Errorf("max concurrent sessions reached")
}

func TestHandler_ListSessions_WithSessions(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Name: "one", Status: StatusRunning}
	mock.sessions["s2"] = &Session{ID: "s2", Name: "two", Status: StatusStopped}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var sessions []SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}
