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
	"github.com/niuulabs/volundr/cli/internal/tracker"
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
		return
	}

	var stats StatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats: %v", err)
		return
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
		return
	}

	var sessions []SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var me map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var pr PRStatusResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &pr); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var chronicle ChronicleResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &chronicle); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
	}

	var me map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
		return
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
		return
	}

	var sess SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode: %v", err)
		return
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
	h := NewHandler(&deletingStopRunner{mockRunner: *mock}, DefaultForgeConfig(), nil)

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

	h := NewHandler(&maxConcurrentRunner{mockRunner: *mock}, DefaultForgeConfig(), nil)

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

// mockTracker implements tracker.Tracker for handler tests.
type mockTracker struct {
	projects []tracker.Project
	issues   map[string][]tracker.Issue
}

func (m *mockTracker) ListProjects() ([]tracker.Project, error) {
	return m.projects, nil
}
func (m *mockTracker) GetProject(_ string) (*tracker.Project, error) { return nil, nil }
func (m *mockTracker) GetProjectFull(_ string) (*tracker.Project, []tracker.Milestone, []tracker.Issue, error) {
	return nil, nil, nil, nil
}
func (m *mockTracker) ListMilestones(_ string) ([]tracker.Milestone, error) { return nil, nil }
func (m *mockTracker) ListIssues(projectID string, _ *string) ([]tracker.Issue, error) {
	return m.issues[projectID], nil
}
func (m *mockTracker) CreateProject(_, _ string) (string, error) { return "", nil }
func (m *mockTracker) CreateMilestone(_, _ string, _ float64) (string, error) {
	return "", nil
}
func (m *mockTracker) CreateIssue(_, _, _ string, _ *string, _ *int) (string, error) {
	return "", nil
}
func (m *mockTracker) UpdateIssueState(_, _ string) error { return nil }
func (m *mockTracker) AddComment(_, _ string) error       { return nil }
func (m *mockTracker) Close() error                       { return nil }

// brokerMockRunner wraps mockRunner but returns a real Broker for one session.
type brokerMockRunner struct {
	mockRunner
	brokerSession string
	brk           *broker.Broker
}

func (m *brokerMockRunner) GetBroker(id string) *broker.Broker {
	if id == m.brokerSession {
		return m.brk
	}
	return nil
}

// nullTransport is a minimal broker.Transport for tests.
type nullTransport struct{}

func (nullTransport) SendUserMessage(_ any, _ string) error          { return nil }
func (nullTransport) SendControlResponse(_ map[string]any) error     { return nil }
func (nullTransport) CLISessionID() string                           { return "test-cli" }

// ---------------------------------------------------------------------------
// Tests for mini-mode and broker endpoints
// ---------------------------------------------------------------------------

func TestEmptyJSON(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// emptyJSON is registered on several paths; pick one.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/templates", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var arr []any
	if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(arr) != 0 {
		t.Errorf("expected empty array, got %d items", len(arr))
	}
}

func TestHandler_ListModels_Default(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/models", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var models []AIModelEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &models); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Default config has no AIModels, so the handler returns the fallback.
	if len(models) != 1 {
		t.Fatalf("expected 1 default model, got %d", len(models))
	}
	if models[0].ID != "claude-sonnet-4-6" {
		t.Errorf("expected default model id 'claude-sonnet-4-6', got %q", models[0].ID)
	}
}

func TestHandler_ListModels_FromConfig(t *testing.T) {
	mock := newMockRunner()
	cfg := DefaultForgeConfig()
	cfg.AIModels = []AIModelEntry{
		{ID: "opus-5", Name: "Opus 5"},
		{ID: "haiku-4", Name: "Haiku 4"},
	}
	h := NewHandler(mock, cfg, nil)

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/models", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var models []AIModelEntry
	if err := json.Unmarshal(rec.Body.Bytes(), &models); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0].ID != "opus-5" {
		t.Errorf("expected first model 'opus-5', got %q", models[0].ID)
	}
}

func TestHandler_FeatureModules_All(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/features", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var modules []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &modules); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// No scope param → both session (7) and user (2) modules.
	if len(modules) != 9 {
		t.Errorf("expected 9 modules, got %d", len(modules))
	}
}

func TestHandler_FeatureModules_SessionScope(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/features?scope=session", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var modules []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &modules); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(modules) != 7 {
		t.Errorf("expected 7 session modules, got %d", len(modules))
	}
	for _, m := range modules {
		if m["scope"] != "session" {
			t.Errorf("expected scope 'session', got %v", m["scope"])
		}
	}
}

func TestHandler_FeatureModules_UserScope(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/features?scope=user", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var modules []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &modules); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(modules) != 2 {
		t.Errorf("expected 2 user modules, got %d", len(modules))
	}
	for _, m := range modules {
		if m["scope"] != "user" {
			t.Errorf("expected scope 'user', got %v", m["scope"])
		}
	}
}

func TestHandler_FeatureFlags(t *testing.T) {
	mock := newMockRunner()
	cfg := DefaultForgeConfig()
	cfg.LocalMounts = true
	h := NewHandler(mock, cfg, nil)

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/feature-flags", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var flags map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &flags); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if flags["local_mounts_enabled"] != true {
		t.Errorf("expected local_mounts_enabled true, got %v", flags["local_mounts_enabled"])
	}
	if flags["mini_mode"] != true {
		t.Errorf("expected mini_mode true, got %v", flags["mini_mode"])
	}
}

func TestHandler_ClusterResources(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/resources", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	rt, ok := res["resource_types"].([]any)
	if !ok || len(rt) != 0 {
		t.Errorf("expected empty resource_types array")
	}
}

func TestHandler_GetSessionLogs(t *testing.T) {
	h, mock := newTestHandler(t)
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions/s1/logs", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var arr []any
	if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(arr) != 0 {
		t.Errorf("expected empty array, got %d items", len(arr))
	}
}

func TestHandler_GetChronicleTimeline_NoSession(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/chronicles/nonexistent/timeline", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	events, ok := res["events"].([]any)
	if !ok || len(events) != 0 {
		t.Errorf("expected empty events array")
	}
}

func TestTruncate(t *testing.T) {
	short := "hello"
	if got := truncate(short, 10); got != "hello" {
		t.Errorf("expected %q, got %q", short, got)
	}

	long := "this is a long string that exceeds the limit"
	got := truncate(long, 10)
	expected := "this is a " + "..."
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}

	exact := "exactly10!"
	if got := truncate(exact, 10); got != exact {
		t.Errorf("expected %q, got %q", exact, got)
	}
}

func TestHandler_BrokerWebSocket_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/s/nonexistent/session", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_BrokerConversationHistory_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/s/nonexistent/api/conversation/history", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	turns, ok := res["turns"].([]any)
	if !ok || len(turns) != 0 {
		t.Errorf("expected empty turns array")
	}
	if res["is_active"] != false {
		t.Errorf("expected is_active false")
	}
}

func TestHandler_BrokerInjectMessage_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"content":"hello"}`)
	req := httptest.NewRequest(http.MethodPost, "/s/nonexistent/api/message", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_BrokerDiffFiles_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/s/nonexistent/api/diff/files", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	files, ok := res["files"].([]any)
	if !ok || len(files) != 0 {
		t.Errorf("expected empty files array")
	}
}

func TestHandler_BrokerDiff_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/s/nonexistent/api/diff", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	hunks, ok := res["hunks"].([]any)
	if !ok || len(hunks) != 0 {
		t.Errorf("expected empty hunks array")
	}
}

func TestHandler_BrokerHealth_NoBroker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/s/nonexistent/health", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestHandler_SearchIssues_NoTracker(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/issues/search?q=test", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var arr []any
	if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(arr) != 0 {
		t.Errorf("expected empty array, got %d items", len(arr))
	}
}

func TestHandler_SearchIssues_EmptyQuery(t *testing.T) {
	mt := &mockTracker{}
	h := NewHandler(newMockRunner(), DefaultForgeConfig(), mt)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/issues/search", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var arr []any
	if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(arr) != 0 {
		t.Errorf("expected empty array for empty query, got %d", len(arr))
	}
}

func TestHandler_SearchIssues_WithResults(t *testing.T) {
	mt := &mockTracker{
		projects: []tracker.Project{
			{ID: "proj-1", Name: "Test Project"},
		},
		issues: map[string][]tracker.Issue{
			"proj-1": {
				{ID: "iss-1", Identifier: "TEST-1", Title: "Fix login bug", Status: "In Progress", URL: "https://example.com/TEST-1"},
				{ID: "iss-2", Identifier: "TEST-2", Title: "Add dashboard", Status: "Todo", URL: "https://example.com/TEST-2"},
			},
		},
	}
	h := NewHandler(newMockRunner(), DefaultForgeConfig(), mt)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/issues/search?q=login", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var results []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0]["identifier"] != "TEST-1" {
		t.Errorf("expected TEST-1, got %v", results[0]["identifier"])
	}
}

func TestHandler_SearchIssues_ByIdentifier(t *testing.T) {
	mt := &mockTracker{
		projects: []tracker.Project{{ID: "p1"}},
		issues: map[string][]tracker.Issue{
			"p1": {{ID: "i1", Identifier: "ABC-42", Title: "Unrelated title", Status: "Todo"}},
		},
	}
	h := NewHandler(newMockRunner(), DefaultForgeConfig(), mt)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/issues/search?q=abc-42", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var results []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 1 {
		t.Errorf("expected 1 result matching identifier, got %d", len(results))
	}
}

func TestHandler_SearchIssues_NoMatch(t *testing.T) {
	mt := &mockTracker{
		projects: []tracker.Project{{ID: "p1"}},
		issues: map[string][]tracker.Issue{
			"p1": {{ID: "i1", Identifier: "X-1", Title: "Something else"}},
		},
	}
	h := NewHandler(newMockRunner(), DefaultForgeConfig(), mt)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/issues/search?q=nonexistent", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var results []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestHandler_ListRepos_NoGitHub(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/niuu/repos", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var repos map[string][]any
	if err := json.Unmarshal(rec.Body.Bytes(), &repos); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// No GitHub instances configured → empty map.
	if len(repos) != 0 {
		t.Errorf("expected empty repos map, got %d entries", len(repos))
	}
}

func TestHandler_GetChronicleTimeline_WithBroker(t *testing.T) {
	mock := &brokerMockRunner{
		mockRunner:    *newMockRunner(),
		brokerSession: "s1",
		brk:           broker.NewBroker("s1", nullTransport{}, ""),
	}
	mock.sessions["s1"] = &Session{ID: "s1", Status: StatusRunning}

	h := NewHandler(mock, DefaultForgeConfig(), nil)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/chronicles/s1/timeline", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Should have at least the "Session started" event.
	events, ok := res["events"].([]any)
	if !ok {
		t.Fatal("expected events array")
	}
	if len(events) < 1 {
		t.Errorf("expected at least 1 event (session start), got %d", len(events))
	}
	// Verify structural keys exist.
	if _, ok := res["files"]; !ok {
		t.Error("expected 'files' key in response")
	}
	if _, ok := res["commits"]; !ok {
		t.Error("expected 'commits' key in response")
	}
	if _, ok := res["token_burn"]; !ok {
		t.Error("expected 'token_burn' key in response")
	}
}

func TestHandler_StartSession_RestartFails(t *testing.T) {
	mock := &maxConcurrentRunner{mockRunner: *newMockRunner()}
	mock.sessions["s1"] = &Session{ID: "s1", Name: "test", Status: StatusStopped, Model: "m"}

	h := NewHandler(mock, DefaultForgeConfig(), nil)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/volundr/sessions/s1/start", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
}

func TestHandler_FeatureFlags_NoLocalMounts(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/feature-flags", http.NoBody)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var flags map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &flags); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if flags["local_mounts_enabled"] != false {
		t.Errorf("expected local_mounts_enabled false, got %v", flags["local_mounts_enabled"])
	}
}

func TestEmptyJSON_MultipleEndpoints(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	endpoints := []string{
		"/api/v1/volundr/features/preferences",
		"/api/v1/volundr/presets",
		"/api/v1/volundr/mcp-servers",
		"/api/v1/volundr/secrets",
		"/api/v1/volundr/workspaces",
		"/api/v1/volundr/credentials",
		"/api/v1/volundr/integrations",
	}

	for _, ep := range endpoints {
		req := httptest.NewRequest(http.MethodGet, ep, http.NoBody)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("%s: expected 200, got %d", ep, rec.Code)
			continue
		}
		var arr []any
		if err := json.Unmarshal(rec.Body.Bytes(), &arr); err != nil {
			t.Errorf("%s: decode error: %v", ep, err)
			continue
		}
		if len(arr) != 0 {
			t.Errorf("%s: expected empty array, got %d items", ep, len(arr))
		}
	}
}

func TestHandler_PutPreferences(t *testing.T) {
	h, _ := newTestHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	body := bytes.NewBufferString(`{"theme":"dark"}`)
	req := httptest.NewRequest(http.MethodPut, "/api/v1/volundr/features/preferences", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
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
		return
	}

	var sessions []SessionResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode: %v", err)
		return
	}
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}
