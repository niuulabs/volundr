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
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func setupHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	store := NewStore(db)
	dispatcher := NewDispatcher("http://localhost:8080")
	handler := NewHandler(store, dispatcher)
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

// ---------------------------------------------------------------------------
// Saga handler tests
// ---------------------------------------------------------------------------

func TestListSagas_Empty(t *testing.T) {
	h, mock := setupHandler(t)

	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"})
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(rows)

	w := doRequest(h.listSagas, "GET", "/api/v1/tyr/sagas", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []SagaListItem
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
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

	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("phase-1", "saga-1", "phase-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(phaseRows)

	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("raid-1", "phase-1", "raid-1", "Raid 1", "", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("phase-1").
		WillReturnRows(raidRows)

	w := doRequest(h.listSagas, "GET", "/api/v1/tyr/sagas", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []SagaListItem
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 saga, got %d", len(result))
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

	req := httptest.NewRequest("GET", "/api/v1/tyr/sagas/nonexistent", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
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
	}

	var result CommittedSagaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if result.Name != "Test Saga" {
		t.Errorf("expected name 'Test Saga', got %q", result.Name)
	}
	if result.Status != "ACTIVE" {
		t.Errorf("expected status ACTIVE, got %q", result.Status)
	}
	if len(result.Phases) != 1 {
		t.Fatalf("expected 1 phase, got %d", len(result.Phases))
	}
	if result.Phases[0].Status != "ACTIVE" {
		t.Errorf("first phase should be ACTIVE, got %q", result.Phases[0].Status)
	}
	if len(result.Phases[0].Raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(result.Phases[0].Raids))
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
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("nonexistent", "test-user").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	req := httptest.NewRequest("DELETE", "/api/v1/tyr/sagas/nonexistent", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Raid handler tests
// ---------------------------------------------------------------------------

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
	}

	var counts map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &counts); err != nil {
		t.Fatalf("unmarshal: %v", err)
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
	rows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("raid-1", "phase-1", "raid-1", "Active Raid", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, "session-1", "feature/raid-1", nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE status NOT IN").WillReturnRows(rows)

	w := doRequest(h.raidsActive, "GET", "/api/v1/tyr/raids/active", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var results []ActiveRaidResponse
	if err := json.Unmarshal(w.Body.Bytes(), &results); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 active raid, got %d", len(results))
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

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/nonexistent/approve", nil)
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRejectRaid_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/nonexistent/reject", bytes.NewReader([]byte(`{"reason":"bad"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "nonexistent")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestNotImplemented(t *testing.T) {
	h, _ := setupHandler(t)

	w := doRequest(h.notImplemented, "POST", "/api/v1/tyr/sagas/decompose", nil)

	if w.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501, got %d", w.Code)
	}

	var result map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
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
	}

	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result["default_model"] != "claude-sonnet-4-6" {
		t.Errorf("expected default_model 'claude-sonnet-4-6', got %v", result["default_model"])
	}
}

func TestDispatchQueue_Empty(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(sqlmock.NewRows(nil))

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected empty queue, got %d items", len(result))
	}
}

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

func TestExtractOwner(t *testing.T) {
	// With header.
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Auth-User-Id", "user-123")
	if got := extractOwner(req); got != "user-123" {
		t.Errorf("extractOwner with header = %q, want 'user-123'", got)
	}

	// Without header.
	req = httptest.NewRequest("GET", "/", nil)
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

// ---------------------------------------------------------------------------
// RegisterRoutes test
// ---------------------------------------------------------------------------

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
			req := httptest.NewRequest(rt.method, rt.path, nil)
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
	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "r-1", "Raid 1", "desc", pq.Array([]string{"it works"}), pq.Array([]string{"file.go"}), 2.0, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(raidRows)

	req := httptest.NewRequest("GET", "/api/v1/tyr/sagas/saga-1", nil)
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
	if result.Name != "Test" {
		t.Errorf("expected name 'Test', got %q", result.Name)
	}
	if len(result.Phases) != 1 {
		t.Fatalf("expected 1 phase, got %d", len(result.Phases))
	}
	if len(result.Phases[0].Raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(result.Phases[0].Raids))
	}
	if result.FeatureBranch != "feat/test" {
		t.Errorf("expected feature branch 'feat/test', got %q", result.FeatureBranch)
	}
}

func TestDeleteSaga_Success(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	req := httptest.NewRequest("DELETE", "/api/v1/tyr/sagas/saga-1", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestApproveRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "REVIEW", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	// UpdateRaidStatus: GetRaid + ValidateTransition + UPDATE
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "REVIEW", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
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
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "MERGED", 0.9, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/approve", nil)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRejectRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	// UpdateRaidStatus
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
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
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.6, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	body := bytes.NewReader([]byte(`{"reason":"tests failed"}`))
	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/reject", body)
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRetryRaid_NotFound(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("missing").
		WillReturnRows(sqlmock.NewRows(nil))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/missing/retry", nil)
	req.SetPathValue("id", "missing")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRetryRaid_Success(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// GetRaid (initial)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.5, nil, nil, nil, nil, nil, nil, 1, "", 0, now, now))

	// UpdateRaidStatus
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "FAILED", 0.5, nil, nil, nil, nil, nil, nil, 1, "", 0, now, now))
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
			AddRow("raid-1", "p-1", "raid-1", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "QUEUED", 0.4, nil, nil, nil, nil, nil, nil, 2, "", 0, now, now))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/retry", nil)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDispatchQueue_WithPendingRaids(t *testing.T) {
	h, mock := setupHandler(t)

	now := time.Now()
	// ListSagas
	sagaRows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test Saga", pq.Array([]string{"repo1"}), "ACTIVE", 0.75, "test-user", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(sagaRows)

	// ListPhases
	phaseRows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(phaseRows)

	// ListRaids (with a PENDING raid)
	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "NIU-100", "Pending Raid", "do stuff", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(raidRows)

	w := doRequest(h.dispatchQueue, "GET", "/api/v1/tyr/dispatch/queue", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 queued item, got %d", len(result))
	}
	if result[0]["title"] != "Pending Raid" {
		t.Errorf("expected title 'Pending Raid', got %v", result[0]["title"])
	}
}

func TestDispatchApprove_InvalidBody(t *testing.T) {
	h, _ := setupHandler(t)

	req := httptest.NewRequest("POST", "/api/v1/tyr/dispatch/approve", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "test-user")
	w := httptest.NewRecorder()
	h.dispatchApprove(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDispatchApprove_EmptyItems(t *testing.T) {
	h, _ := setupHandler(t)

	body := DispatchRequest{Items: []DispatchItem{}}
	w := doRequest(h.dispatchApprove, "POST", "/api/v1/tyr/dispatch/approve", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
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
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result))
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
	raidRows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "NIU-100", "Raid 1", "", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").
		WithArgs("p-1").
		WillReturnRows(raidRows)

	raid := h.findRaidByTrackerID(ctx, "saga-1", "NIU-100")
	if raid == nil {
		t.Fatal("expected to find raid")
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
	raidCols := []string{"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}

	// Mock Forge server
	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"session-1","name":"NIU-100"}`))
	}))
	defer forgeServer.Close()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	dispatcher := NewDispatcher(forgeServer.URL)
	h := NewHandler(store, dispatcher)

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
		AddRow("r-1", "p-1", "NIU-100", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids").WillReturnRows(raidRow)

	// UpdateRaidStatus PENDING → QUEUED
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").WillReturnRows(sqlmock.NewRows(raidCols).
		AddRow("r-1", "p-1", "NIU-100", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// UpdateRaidStatus QUEUED → RUNNING
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").WillReturnRows(sqlmock.NewRows(raidCols).
		AddRow("r-1", "p-1", "NIU-100", "Test Raid", "desc", pq.Array([]string{}), pq.Array([]string{}), nil, "QUEUED", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// UpdateRaidSession
	mock.ExpectExec("UPDATE raids SET session_id").WillReturnResult(sqlmock.NewResult(0, 1))

	body := DispatchRequest{
		Items: []DispatchItem{{SagaID: "saga-1", IssueID: "NIU-100"}},
	}
	w := doRequest(h.dispatchApprove, "POST", "/api/v1/tyr/dispatch/approve", body)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result []DispatchResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 result, got %d", len(result))
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

	req := httptest.NewRequest("POST", "/api/v1/tyr/sagas/commit", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-User-Id", "test-user")
	w := httptest.NewRecorder()
	h.commitSaga(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
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
	}
}

func TestGetSaga_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "test-user").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest("GET", "/api/v1/tyr/sagas/saga-1", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
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

	req := httptest.NewRequest("GET", "/api/v1/tyr/sagas/saga-1", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.getSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestApproveRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/approve", nil)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.approveRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestRejectRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/reject", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.rejectRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestRetryRaid_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest("POST", "/api/v1/tyr/raids/raid-1/retry", nil)
	req.SetPathValue("id", "raid-1")
	w := httptest.NewRecorder()
	h.retryRaid(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestDeleteSaga_StoreError(t *testing.T) {
	h, mock := setupHandler(t)

	mock.ExpectBegin().WillReturnError(fmt.Errorf("db error"))

	req := httptest.NewRequest("DELETE", "/api/v1/tyr/sagas/saga-1", nil)
	req.Header.Set("X-Auth-User-Id", "test-user")
	req.SetPathValue("id", "saga-1")
	w := httptest.NewRecorder()
	h.deleteSaga(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// Ensure context is properly used (compile-time check).
var _ = context.Background
