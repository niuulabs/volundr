package tyr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// Test helpers.

func setupHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
		return nil, nil
	}
	t.Cleanup(func() { _ = db.Close() })

	store := NewStore(db)
	dispatcher := NewDispatcher("http://localhost:8080")
	handler := NewHandler(store, dispatcher, nil, nil, "")
	return handler, mock
}

func doRequest(handler http.HandlerFunc, method, path string, body any) *httptest.ResponseRecorder {
	var bodyReader *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	} else {
		bodyReader = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "test-user")

	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

// Saga handler tests.

func TestListSagas_Empty(t *testing.T) {
	h, mock := setupHandler(t)

	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"})
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(rows)

	// CountPhasesAndRaidsBySaga — no results for empty saga list.
	mock.ExpectQuery("SELECT s.id, COUNT").
		WithArgs("test-user").
		WillReturnRows(sqlmock.NewRows([]string{"id", "phase_count", "raid_count"}))

	w := doRequest(h.listSagas, "GET", "/api/v1/tyr/sagas", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []SagaListItem
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
		return
	}
	if len(result) != 0 {
		t.Errorf("expected 0 sagas, got %d", len(result))
	}
}

func TestListSagas_WithResults(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "tracker-1", "native", "my-project", "My Project", pq.Array([]string{"repo1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(sagaRows)

	// CountPhasesAndRaidsBySaga — single JOIN query replacing N+1.
	countRows := sqlmock.NewRows([]string{"id", "phase_count", "raid_count"}).
		AddRow("saga-1", 1, 1)
	mock.ExpectQuery("SELECT s.id, COUNT").
		WithArgs("test-user").
		WillReturnRows(countRows)

	w := doRequest(h.listSagas, "GET", "/api/v1/tyr/sagas", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []SagaListItem
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
		return
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 saga, got %d", len(result))
		return
	}
	if result[0].Name != "My Project" {
		t.Errorf("expected name 'My Project', got %q", result[0].Name)
	}
	if result[0].IssueCount != 1 {
		t.Errorf("expected 1 raid, got %d", result[0].IssueCount)
	}
	if result[0].MilestoneCount != 1 {
		t.Errorf("expected 1 phase, got %d", result[0].MilestoneCount)
	}
}

func TestGetSaga_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("nonexistent", "test-user").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/nonexistent", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestCommitSaga_Success(t *testing.T) {
	h, mock := setupHandler(t)

	// Check slug uniqueness.
	mock.ExpectQuery("SELECT .+ FROM sagas WHERE slug").
		WithArgs("test-saga").
		WillReturnRows(sqlmock.NewRows(nil))

	// Transaction for CreateSaga.
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO sagas").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO phases").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO raids").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body := CommitRequest{
		Name:       "Test Saga",
		Slug:       "test-saga",
		Repos:      []string{"repo1"},
		BaseBranch: "main",
		Phases: []PhaseSpecRequest{
			{
				Name: "Phase 1",
				Raids: []RaidSpecRequest{
					{
						Name:               "Raid 1",
						Description:        "Do something",
						AcceptanceCriteria: []string{"it works"},
						DeclaredFiles:      []string{"file.go"},
						EstimateHours:      2.0,
					},
				},
			},
		},
	}

	w := doRequest(h.commitSaga, "POST", "/api/v1/tyr/sagas/commit", body)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result CommittedSagaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
		return
	}
	if result.Name != "Test Saga" {
		t.Errorf("expected name 'Test Saga', got %q", result.Name)
	}
	if result.Status != "ACTIVE" {
		t.Errorf("expected status ACTIVE, got %q", result.Status)
	}
	if len(result.Phases) != 1 {
		t.Fatalf("expected 1 phase, got %d", len(result.Phases))
		return
	}
	if result.Phases[0].Status != "ACTIVE" {
		t.Errorf("first phase should be ACTIVE, got %q", result.Phases[0].Status)
	}
	if len(result.Phases[0].Raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(result.Phases[0].Raids))
		return
	}
	if result.FeatureBranch != "feat/test-saga" {
		t.Errorf("expected feature branch 'feat/test-saga', got %q", result.FeatureBranch)
	}
}

func TestCommitSaga_DuplicateSlug(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	mock.ExpectQuery("SELECT .+ FROM sagas WHERE slug").
		WithArgs("existing").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
			AddRow("saga-1", "t-1", "native", "existing", "Existing", pq.Array([]string{}), "ACTIVE", 0.75, "test-user", "main", now))

	body := CommitRequest{
		Name:  "Duplicate",
		Slug:  "existing",
		Repos: []string{"repo1"},
		Phases: []PhaseSpecRequest{
			{Name: "P1", Raids: []RaidSpecRequest{{Name: "R1"}}},
		},
	}

	w := doRequest(h.commitSaga, "POST", "/api/v1/tyr/sagas/commit", body)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestCommitSaga_MissingFields(t *testing.T) {
	h, _ := setupHandler(t)

	// Missing name.
	w := doRequest(h.commitSaga, "POST", "/api/v1/tyr/sagas/commit",
		CommitRequest{Slug: "test", Phases: []PhaseSpecRequest{{Name: "P1", Raids: []RaidSpecRequest{{Name: "R1"}}}}})
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing name, got %d", w.Code)
	}

	// Missing phases.
	w = doRequest(h.commitSaga, "POST", "/api/v1/tyr/sagas/commit",
		CommitRequest{Name: "Test", Slug: "test"})
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for missing phases, got %d", w.Code)
	}
}

func TestDeleteSaga_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("nonexistent", "test-user").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/nonexistent", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		return
	}
}

// Raid handler tests.

func TestRaidsSummary(t *testing.T) {
	h, mock := setupHandler(t)

	rows := sqlmock.NewRows([]string{"status", "count"}).
		AddRow("PENDING", 3).
		AddRow("RUNNING", 1).
		AddRow("MERGED", 5)
	mock.ExpectQuery("SELECT status, COUNT").WillReturnRows(rows)

	w := doRequest(h.raidsSummary, "GET", "/api/v1/tyr/raids/summary", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var counts map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &counts); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if counts["PENDING"] != 3 {
		t.Errorf("expected PENDING=3, got %d", counts["PENDING"])
	}
	if counts["RUNNING"] != 1 {
		t.Errorf("expected RUNNING=1, got %d", counts["RUNNING"])
	}
	if counts["MERGED"] != 5 {
		t.Errorf("expected MERGED=5, got %d", counts["MERGED"])
	}
}

func TestRaidsActive(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("raid-1", "phase-1", "raid-1", "", "", "Active Raid", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, "session-1", "feature/raid-1", nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids ORDER BY").WillReturnRows(rows)

	w := doRequest(h.raidsActive, "GET", "/api/v1/tyr/raids/active", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var results []ActiveRaidResponse
	if err := json.Unmarshal(w.Body.Bytes(), &results); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 active raid, got %d", len(results))
		return
	}
	if results[0].Title != "Active Raid" {
		t.Errorf("expected title 'Active Raid', got %q", results[0].Title)
	}
	if results[0].Status != "RUNNING" {
		t.Errorf("expected status RUNNING, got %q", results[0].Status)
	}
}

func TestApproveRaid_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/nonexistent/approve", http.NoBody)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestRejectRaid_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/nonexistent/reject", bytes.NewReader([]byte(`{"reason":"bad"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestNotImplemented(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.notImplemented, "POST", "/api/v1/tyr/sagas/decompose", nil)

	if w.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501, got %d", w.Code)
		return
	}

	var result map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if result["detail"] == "" {
		t.Error("expected non-empty detail message")
	}
}

func TestDispatchConfig(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.dispatchConfig, "GET", "/api/v1/tyr/dispatch/config", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
		return
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if result["default_model"] != "claude-sonnet-4-6" {
		t.Errorf("expected default_model 'claude-sonnet-4-6', got %v", result["default_model"])
	}
}

func TestDispatchQueue_Empty(t *testing.T) {
	h, mock := setupHandler(t)

	// ListDispatchQueue — single JOIN query.
	mock.ExpectQuery("SELECT s.id, s.name, s.slug").
		WithArgs("test-user", string(RaidStatusPending)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "slug", "repos", "feature_branch", "phase_name", "tracker_id", "raid_name", "description", "status"}))

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(result) != 0 {
		t.Errorf("expected empty queue, got %d items", len(result))
	}
}

// Helper function tests.

func TestExtractOwner(t *testing.T) {
	// With header.
	req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "user-123")
	if got := extractOwner(req); got != "user-123" {
		t.Errorf("extractOwner with header = %q, want 'user-123'", got)
	}

	// Without header.
	req = httptest.NewRequest(http.MethodGet, "/", http.NoBody)
	if got := extractOwner(req); got != "local" {
		t.Errorf("extractOwner without header = %q, want 'local'", got)
	}
}

func TestNilIfEmpty(t *testing.T) {
	if nilIfEmpty("") != nil {
		t.Error("nilIfEmpty('') should return nil")
	}
	if got := nilIfEmpty("hello"); got == nil || *got != "hello" {
		t.Error("nilIfEmpty('hello') should return pointer to 'hello'")
	}
}

func TestRaidToResponse(t *testing.T) {
	branch := "feat/test"
	raid := &Raid{
		ID:         "raid-1",
		Name:       "Test Raid",
		Status:     RaidStatusRunning,
		Confidence: 0.85,
		RetryCount: 2,
		Branch:     &branch,
	}

	resp := raidToResponse(raid)
	if resp.ID != "raid-1" {
		t.Errorf("expected ID 'raid-1', got %q", resp.ID)
	}
	if resp.Status != "RUNNING" {
		t.Errorf("expected status RUNNING, got %q", resp.Status)
	}
	if resp.Confidence != 0.85 {
		t.Errorf("expected confidence 0.85, got %f", resp.Confidence)
	}
	if resp.RetryCount != 2 {
		t.Errorf("expected retry_count 2, got %d", resp.RetryCount)
	}
	if resp.Branch == nil || *resp.Branch != "feat/test" {
		t.Error("expected branch 'feat/test'")
	}
}

// RegisterRoutes test.

func TestRegisterRoutes(t *testing.T) {
	h, _ := setupHandler(t)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// Verify routes are registered by making a request to each.
	routes := []struct {
		method string
		path   string
	}{
		{"GET", "/api/v1/tyr/raids/summary"},
		{"GET", "/api/v1/tyr/raids/active"},
		{"GET", "/api/v1/tyr/dispatch/config"},
		{"POST", "/api/v1/tyr/sagas/decompose"},
	}

	for _, rt := range routes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			req := httptest.NewRequest(rt.method, rt.path, http.NoBody)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			// Should not be 404 (means the route wasn't registered).
			if w.Code == http.StatusNotFound {
				t.Errorf("route %s %s returned 404 (not registered)", rt.method, rt.path)
			}
		})
	}
}

func TestGetSaga_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	// GetSaga query
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test", pq.Array([]string{"repo1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnRows(sagaRows)

	// ListPhases
	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(phaseRows)

	// ListRaids for the phase
	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "r-1", "", "", "Raid 1", "desc", pq.Array([]string{"it works"}), pq.Array([]string{"file.go"}), 2.0, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result SagaDetailResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if result.Name != "Test" {
		t.Errorf("expected name 'Test', got %q", result.Name)
	}
	if len(result.Phases) != 1 {
		t.Fatalf("expected 1 phase, got %d", len(result.Phases))
		return
	}
	if len(result.Phases[0].Raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(result.Phases[0].Raids))
		return
	}
	if result.FeatureBranch != "feat/test" {
		t.Errorf("expected feature branch 'feat/test', got %q", result.FeatureBranch)
	}
}

func TestDeleteSaga_Success(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestApproveRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "REVIEW", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	// UpdateRaidStatus: GetRaid + ValidateTransition + UPDATE
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "REVIEW", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// AddConfidenceEvent
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.8))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// GetRaid (final)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "MERGED", 0.9, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/approve", http.NoBody)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestRejectRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	// UpdateRaidStatus
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// AddConfidenceEvent
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.8))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// GetRaid (final)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.6, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	body := bytes.NewReader([]byte(`{"reason":"tests failed"}`))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/reject", body)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestRetryRaid_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("missing").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/missing/retry", http.NoBody)
	req.SetPathValue("id", "missing")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestRetryRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.5, nil, nil, nil, nil, nil, nil, 1, "", 0, now, now))

	// UpdateRaidStatus
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.5, nil, nil, nil, nil, nil, nil, 1, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// AddConfidenceEvent
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.5))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// GetRaid (final)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "QUEUED", 0.4, nil, nil, nil, nil, nil, nil, 2, "", 0, now, now))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/retry", http.NoBody)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestDispatchQueue_WithPendingRaids(t *testing.T) {
	h, mock := setupHandler(t)

	// ListDispatchQueue — single JOIN query returning pending raids.
	queueRows := sqlmock.NewRows([]string{"id", "name", "slug", "repos", "feature_branch", "phase_name", "tracker_id", "raid_name", "description", "status"}).
		AddRow("saga-1", "Test Saga", "test", pq.Array([]string{"repo1"}), "feat/test", "Phase 1", "NIU-100", "Pending Raid", "do stuff", "PENDING")
	mock.ExpectQuery("SELECT s.id, s.name, s.slug").
		WithArgs("test-user", string(RaidStatusPending)).
		WillReturnRows(queueRows)

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 queued item, got %d", len(result))
		return
	}
	if result[0]["title"] != "Pending Raid" {
		t.Errorf("expected title 'Pending Raid', got %v", result[0]["title"])
	}
}

func TestDispatchApprove_InvalidBody(t *testing.T) {
	h, _ := setupHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/dispatch/approve", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "test-user")
	w := httptest.NewRecorder()
	h.dispatchApprove(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestDispatchApprove_EmptyItems(t *testing.T) {
	h, _ := setupHandler(t)

	body := DispatchRequest{Items: []DispatchItem{}}
	w := doRequest(h.dispatchApprove, "POST", "/api/v1/tyr/dispatch/approve", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(result) != 0 {
		t.Errorf("expected empty results, got %d", len(result))
	}
}

func TestDispatchApprove_SagaNotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("nonexistent", "test-user").
		WillReturnRows(sqlmock.NewRows(nil))

	body := DispatchRequest{
		Items: []DispatchItem{{SagaID: "nonexistent", IssueID: "NIU-100"}},
	}
	w := doRequest(h.dispatchApprove, "POST", "/api/v1/tyr/dispatch/approve", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result))
		return
	}
	if result[0].Status != "failed" {
		t.Errorf("expected status 'failed', got %q", result[0].Status)
	}
}

func TestFindRaidByTrackerID(t *testing.T) {
	h, mock := setupHandler(t)
	ctx := context.Background()

	now := time.Now()
	// ListPhases
	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(phaseRows)

	// ListRaids
	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "NIU-100", "NIU-100", "", "Raid 1", "", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(raidRows)

	raid := h.findRaidByTrackerID(ctx, "saga-1", "NIU-100")
	if raid == nil {
		t.Fatal("expected to find raid")
		return
	}
	if raid.TrackerID != "NIU-100" {
		t.Errorf("expected tracker ID 'NIU-100', got %q", raid.TrackerID)
	}
}

func TestFindRaidByTrackerID_NotFound(t *testing.T) {
	h, mock := setupHandler(t)
	ctx := context.Background()

	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(phaseRows)

	// Empty raids
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(sqlmock.NewRows(nil))

	raid := h.findRaidByTrackerID(ctx, "saga-1", "NIU-999")
	if raid != nil {
		t.Error("expected nil for missing tracker ID")
	}
}

func TestDispatchApprove_Success(t *testing.T) {
	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// Mock Forge server
	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"session-1","name":"NIU-100"}`))
	}))
	defer forgeServer.Close()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	dispatcher := NewDispatcher(forgeServer.URL)
	h := NewHandler(store, dispatcher, nil, nil, "")

	// GetSaga
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test", pq.Array([]string{"repo1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnRows(sagaRows)

	// findRaidByTrackerID: ListPhases + ListRaids
	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").WillReturnRows(phaseRows)

	raidRow := sqlmock.NewRows(raidCols).
		AddRow("r-1", "p-1", "NIU-100", "NIU-100", "", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").WillReturnRows(raidRow)

	// UpdateRaidStatus PENDING → QUEUED
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").WillReturnRows(sqlmock.NewRows(raidCols).
		AddRow("r-1", "p-1", "NIU-100", "NIU-100", "", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// UpdateRaidStatus QUEUED → RUNNING
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").WillReturnRows(sqlmock.NewRows(raidCols).
		AddRow("r-1", "p-1", "NIU-100", "NIU-100", "", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "QUEUED", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// UpdateRaidSession
	mock.ExpectExec("UPDATE raids SET session_id").WillReturnResult(sqlmock.NewResult(0, 1))

	body := DispatchRequest{
		Items: []DispatchItem{{SagaID: "saga-1", IssueID: "NIU-100"}},
	}
	w := doRequest(h.dispatchApprove, "POST", "/api/v1/tyr/dispatch/approve", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		return
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result))
		return
	}
	if result[0].Status != "spawned" {
		t.Errorf("expected status 'spawned', got %q", result[0].Status)
	}
	if result[0].SessionID != "session-1" {
		t.Errorf("expected session ID 'session-1', got %q", result[0].SessionID)
	}
}

func TestCommitSaga_InvalidBody(t *testing.T) {
	h, _ := setupHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/commit", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "test-user")
	w := httptest.NewRecorder()
	h.commitSaga(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
		return
	}
}

func TestListSagas_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnError(fmt.Errorf("db error"))

	w := doRequest(h.listSagas, "GET", "/api/v1/tyr/sagas", nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestGetSaga_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestGetSaga_PhaseListError(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test", pq.Array([]string{}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnRows(sagaRows)

	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestApproveRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/approve", http.NoBody)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestRejectRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/reject", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestRetryRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/raid-1/retry", http.NoBody)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

func TestDeleteSaga_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectBegin().WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
		return
	}
}

// --- Simple handler endpoint tests ---

func TestRaidReview(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.raidReview, "GET", "/api/v1/tyr/raids/raid-1/review", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result["status"] != "pending" {
		t.Errorf("expected status 'pending', got %v", result["status"])
	}
}

func TestRaidMessages(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.raidMessages, "GET", "/api/v1/tyr/raids/raid-1/messages", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result []any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty array, got %d items", len(result))
	}
}

func TestPlanConfig(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.planConfig, "GET", "/api/v1/tyr/config/plan", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := result["planner_system_prompt"]; !ok {
		t.Error("expected planner_system_prompt in response")
	}
}

func TestSlugify(t *testing.T) {
	tests := []struct {
		input, expected string
	}{
		{"Hello World", "hello-world"},
		{"  spaces  ", "spaces"},
		{"My-Project_123", "my-project-123"},
		{"ABC", "abc"},
		{"123", "123"},
	}
	for _, tc := range tests {
		got := slugify(tc.input)
		if got != tc.expected {
			t.Errorf("slugify(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestRaidStatusToType(t *testing.T) {
	tests := []struct {
		status   RaidStatus
		expected string
	}{
		{RaidStatusMerged, "completed"},
		{RaidStatusFailed, "canceled"},
		{RaidStatusRunning, "started"},
		{RaidStatusReview, "started"},
		{RaidStatusEscalated, "started"},
		{RaidStatusPending, "unstarted"},
		{RaidStatusQueued, "unstarted"},
	}
	for _, tc := range tests {
		got := raidStatusToType(tc.status)
		if got != tc.expected {
			t.Errorf("raidStatusToType(%q) = %q, want %q", tc.status, got, tc.expected)
		}
	}
}

func TestTrackerProject_NoTracker(t *testing.T) {
	h, _ := setupHandler(t) // h.tracker is nil

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerProject(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestTrackerMilestones_NoTracker(t *testing.T) {
	h, _ := setupHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1/milestones", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerMilestones(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestTrackerIssues_NoTracker(t *testing.T) {
	h, _ := setupHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1/issues", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerIssues(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestTrackerImport_NoTracker(t *testing.T) {
	h, _ := setupHandler(t)

	body := map[string]any{"project_id": "proj-1", "repos": []string{"repo1"}, "base_branch": "main"}
	w := doRequest(h.trackerImport, "POST", "/api/v1/tyr/tracker/import", body)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestTrackerProjects_NoTracker(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.trackerProjects, "GET", "/api/v1/tyr/tracker/projects", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestDispatchClusters(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.dispatchClusters, "GET", "/api/v1/tyr/dispatch/clusters", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 1 {
		t.Errorf("expected 1 cluster, got %d", len(result))
	}
}

func TestDispatcherLog_NoEventLog(t *testing.T) {
	h, _ := setupHandler(t)
	h.eventLog = nil

	w := doRequest(h.dispatcherLog, "GET", "/api/v1/tyr/dispatch/log", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestDispatcherLog_WithEventLog(t *testing.T) {
	h, _ := setupHandler(t)
	h.eventLog = NewEventLog(100)
	h.eventLog.Emit("test.event", nil, "")

	w := doRequest(h.dispatcherLog, "GET", "/api/v1/tyr/dispatch/log", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	total := result["total"].(float64)
	if total != 1 {
		t.Errorf("expected total=1, got %v", total)
	}
}

func TestHealthDetailed(t *testing.T) {
	h, _ := setupHandler(t)

	// sqlmock Ping is not monitored by default, so Ping will fail,
	// resulting in degraded status. This still exercises the full code path.
	w := doRequest(h.healthDetailed, "GET", "/api/v1/tyr/health", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// Verify all expected fields are present.
	for _, field := range []string{"status", "database", "tracker_connected", "activity_subscriber_running", "review_engine_running"} {
		if _, ok := result[field]; !ok {
			t.Errorf("expected field %q in health response", field)
		}
	}
}

func TestHealthDetailed_WithSubscriberAndReviewer(t *testing.T) {
	h, _ := setupHandler(t)

	// Set subscriber and reviewer.
	db, _, _ := sqlmock.New()
	defer func() { _ = db.Close() }()
	store := NewStore(db)
	events := newMockEventSource()
	h.subscriber = NewActivitySubscriber(store, events, &mockPRChecker{}, nil, SubscriberConfig{})
	h.reviewer = NewReviewEngine(store, &mockPRChecker{}, nil, nil, ReviewEngineConfig{}, "")

	w := doRequest(h.healthDetailed, "GET", "/api/v1/tyr/health", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestDispatchQueue_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids r").
		WithArgs("test-user", "PENDING").
		WillReturnError(fmt.Errorf("db error"))

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

// --- Handler tests with tracker ---

type testTracker struct {
	projects   []tracker.Project
	milestones []tracker.Milestone
	issues     []tracker.Issue
	projectErr error
}

func (t *testTracker) ListProjects() ([]tracker.Project, error) { return t.projects, nil }
func (t *testTracker) GetProject(id string) (*tracker.Project, error) {
	if t.projectErr != nil {
		return nil, t.projectErr
	}
	for i := range t.projects {
		if t.projects[i].ID == id {
			return &t.projects[i], nil
		}
	}
	return nil, fmt.Errorf("not found")
}
func (t *testTracker) GetProjectFull(_ string) (*tracker.Project, []tracker.Milestone, []tracker.Issue, error) {
	if t.projectErr != nil {
		return nil, nil, nil, t.projectErr
	}
	return &t.projects[0], t.milestones, t.issues, nil
}
func (t *testTracker) ListMilestones(_ string) ([]tracker.Milestone, error) {
	return t.milestones, nil
}
func (t *testTracker) ListIssues(_ string, _ *string) ([]tracker.Issue, error) {
	return t.issues, nil
}
func (t *testTracker) CreateProject(_, _ string) (string, error)            { return "", nil }
func (t *testTracker) CreateMilestone(_, _ string, _ float64) (string, error) { return "", nil }
func (t *testTracker) CreateIssue(_, _, _ string, _ *string, _ *int) (string, error) {
	return "", nil
}
func (t *testTracker) UpdateIssueState(_, _ string) error { return nil }
func (t *testTracker) AddComment(_, _ string) error       { return nil }
func (t *testTracker) Close() error                       { return nil }

func setupHandlerWithTracker(t *testing.T) (*Handler, sqlmock.Sqlmock, *testTracker) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	store := NewStore(db)
	dispatcher := NewDispatcher("http://localhost:8080")

	msID := "ms-1"
	trk := &testTracker{
		projects: []tracker.Project{
			{ID: "proj-1", Name: "Test Project", Description: "desc", Status: "active", URL: "http://example.com", Slug: "test-proj", Progress: 0.5, MilestoneCount: 1, IssueCount: 2},
		},
		milestones: []tracker.Milestone{
			{ID: "ms-1", ProjectID: "proj-1", Name: "Phase 1", SortOrder: 1, Progress: 0.5},
		},
		issues: []tracker.Issue{
			{ID: "iss-1", Identifier: "TYR-1", Title: "Task 1", Status: "Todo", StatusType: "unstarted", Priority: 1, PriorityLabel: "Urgent", URL: "http://example.com/1", MilestoneID: &msID, Labels: []string{"bug"}},
			{ID: "iss-2", Identifier: "TYR-2", Title: "Task 2", Status: "Done", StatusType: "completed", Priority: 2, PriorityLabel: "Medium", URL: "http://example.com/2"},
		},
	}

	handler := NewHandler(store, dispatcher, trk, nil, "")
	return handler, mock, trk
}

func TestGetSaga_WithTracker(t *testing.T) {
	h, mock, _ := setupHandlerWithTracker(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "proj-1", "linear", "test-proj", "Test", pq.Array([]string{"r1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnRows(sagaRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result SagaDetailResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.Name != "Test Project" {
		t.Errorf("expected name from tracker, got %q", result.Name)
	}
	if len(result.Phases) < 1 {
		t.Error("expected at least 1 phase from tracker")
	}
}

func TestGetSaga_TrackerError_FallsBackToDB(t *testing.T) {
	h, mock, trk := setupHandlerWithTracker(t)
	trk.projectErr = fmt.Errorf("tracker down")

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "proj-1", "linear", "test-proj", "Test", pq.Array([]string{"r1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnRows(sagaRows)

	// Fallback to DB: ListPhases.
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1", http.NoBody)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTrackerProject_WithTracker(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerProject(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTrackerProject_NotFound(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/nonexistent", http.NoBody)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.trackerProject(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestTrackerMilestones_WithTracker(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1/milestones", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerMilestones(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestTrackerIssues_WithTracker(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1/issues", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerIssues(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestTrackerIssues_WithMilestoneFilter(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/tracker/projects/proj-1/issues?milestone_id=ms-1", http.NoBody)
	req.SetPathValue("id", "proj-1")
	w := httptest.NewRecorder()
	h.trackerIssues(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestTrackerProjects_WithTracker(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	w := doRequest(h.trackerProjects, "GET", "/api/v1/tyr/tracker/projects", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestDispatchQueue_WithTracker(t *testing.T) {
	h, mock, _ := setupHandlerWithTracker(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "proj-1", "linear", "test-proj", "Test", pq.Array([]string{"r1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(sagaRows)

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTrackerImport_WithTracker(t *testing.T) {
	h, mock, _ := setupHandlerWithTracker(t)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO sagas").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body := map[string]any{"project_id": "proj-1", "repos": []string{"repo1"}, "base_branch": "main"}
	w := doRequest(h.trackerImport, "POST", "/api/v1/tyr/tracker/import", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result["name"] != "Test Project" {
		t.Errorf("expected name 'Test Project', got %v", result["name"])
	}
}

func TestTrackerImport_InvalidBody(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/tracker/import", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.trackerImport(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestTrackerImport_ProjectNotFound(t *testing.T) {
	h, _, _ := setupHandlerWithTracker(t)

	body := map[string]any{"project_id": "nonexistent", "repos": []string{"repo1"}, "base_branch": "main"}
	w := doRequest(h.trackerImport, "POST", "/api/v1/tyr/tracker/import", body)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEvents_NoFlusher(t *testing.T) {
	h, _ := setupHandler(t)

	// httptest.ResponseRecorder implements http.Flusher, so this path won't
	// be hit. Instead, test that the endpoint works when eventLog is nil.
	h.eventLog = nil

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/events", http.NoBody)
	ctx, cancel := context.WithTimeout(req.Context(), 50*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	h.events(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestEvents_WithEventLog(t *testing.T) {
	h, _ := setupHandler(t)
	h.eventLog = NewEventLog(100)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/events", http.NoBody)
	ctx, cancel := context.WithTimeout(req.Context(), 50*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	h.events(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Header().Get("Content-Type") != "text/event-stream" {
		t.Errorf("expected Content-Type text/event-stream, got %q", w.Header().Get("Content-Type"))
	}
}

func TestDispatchQueue_DBFallback(t *testing.T) {
	h, mock := setupHandler(t)

	dqCols := []string{"saga_id", "saga_name", "saga_slug", "repos", "feature_branch", "phase_name", "tracker_id", "raid_name", "description", "status"}
	mock.ExpectQuery("SELECT .+ FROM raids r").
		WithArgs("test-user", "PENDING").
		WillReturnRows(sqlmock.NewRows(dqCols).
			AddRow("saga-1", "Saga", "saga", pq.Array([]string{"r1"}), "feat/saga", "Phase 1", "t-1", "Raid 1", "desc", "PENDING"))

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// Ensure context is properly used (compile-time check).
var _ = context.Background
