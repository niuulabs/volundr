package tyr

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func setupTestHandler(t *testing.T) (*Handler, sqlmock.Sqlmock, *http.ServeMux) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	store := NewStore(db)
	handler := NewHandler(store, nil)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	return handler, mock, mux
}

func TestHandler_Health(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectPing()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["service"] != "tyr-mini" {
		t.Errorf("expected service tyr-mini, got %q", body["service"])
	}
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %q", body["status"])
	}
}

func TestHandler_Health_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_ListSagas(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test Saga", pq.Array([]string{}),
		"ACTIVE", 0.5, "default", "main", now)

	mock.ExpectQuery("SELECT .* FROM sagas ORDER BY").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var sagas []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &sagas); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(sagas) != 1 {
		t.Fatalf("expected 1 saga, got %d", len(sagas))
	}
	if sagas[0]["feature_branch"] != "feat/test" {
		t.Errorf("expected feature_branch feat/test, got %v", sagas[0]["feature_branch"])
	}
}

func TestHandler_ListSagas_Empty(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	})
	mock.ExpectQuery("SELECT .* FROM sagas ORDER BY").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var sagas []map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &sagas)
	if len(sagas) != 0 {
		t.Errorf("expected empty array, got %d items", len(sagas))
	}
}

func TestHandler_CreateSaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{"id", "created_at"}).AddRow("uuid-1", time.Now())
	mock.ExpectQuery("INSERT INTO sagas").WillReturnRows(rows)

	body := `{"name":"Test","slug":"test","repos":["repo1"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_CreateSaga_MissingName(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{"slug":"test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreateSaga_MissingSlug(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{"name":"Test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreateSaga_InvalidJSON(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_GetSaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("uuid-1").WillReturnRows(sagaRows)

	// ListPhases returns empty
	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	})
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WithArgs("uuid-1").WillReturnRows(phaseRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_GetSaga_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "tracker_id", "tracker_type", "slug", "name", "repos",
			"status", "confidence", "owner_id", "base_branch", "created_at",
		}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_DeleteSaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_UpdateSaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Old Name", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("uuid-1").WillReturnRows(sagaRows)
	mock.ExpectExec("UPDATE sagas SET").WillReturnResult(sqlmock.NewResult(0, 1))

	body := `{"name":"New Name"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/uuid-1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_SagasMethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_SagaByID_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_CreatePhaseForSaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{"id"}).AddRow("phase-uuid-1")
	mock.ExpectQuery("INSERT INTO phases").WillReturnRows(rows)

	body := `{"name":"Phase 1","number":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/saga-1/phases", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_ListPhasesBySaga(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WithArgs("saga-1").WillReturnRows(phaseRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1/phases", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_CreateRaidForPhase(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{"id"}).AddRow("raid-uuid-1")
	mock.ExpectQuery("INSERT INTO raids").WillReturnRows(rows)

	body := `{"name":"Implement feature"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/phases/phase-1/raids", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_ListRaidsByPhase(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WithArgs("phase-1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/phase-1/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_GetRaid(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	// GetRaid for UpdateRaidStatus
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	// UpdateRaid
	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	// GetRaid for response
	raidRows2 := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "QUEUED", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows2)

	body := `{"status":"QUEUED"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1/status", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_UpdateRaidStatus_InvalidTransition(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	body := `{"status":"MERGED"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1/status", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus_MissingStatus(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1/status", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_DispatchRaid_NoDispatcher(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", w.Code)
	}
}

func TestHandler_DispatchRaid_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_CreateConfidenceEvent(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.5, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	mock.ExpectBegin()
	evRows := sqlmock.NewRows([]string{"id", "created_at"}).AddRow("ev-1", now)
	mock.ExpectQuery("INSERT INTO confidence_events").WillReturnRows(evRows)
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	body := `{"event_type":"ci_pass","delta":0.1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/confidence", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_ListConfidenceEvents(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "raid_id", "event_type", "delta", "score_after", "created_at",
	})
	mock.ExpectQuery("SELECT .* FROM confidence_events WHERE raid_id").
		WithArgs("r1").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1/confidence", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_CreateConfidenceEvent_MissingEventType(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{"delta":0.1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/confidence", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_Phases_MissingSagaID(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_Raids_MissingPhaseID(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_UpdateRaid(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Old Name", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)
	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	body := `{"name":"New Name"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_SagaByID_MissingID(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_RaidByID_UnknownSubpath(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1/unknown", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_SagaByID_UnknownSubpath(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1/unknown", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_Phases_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/phases?saga_id=s1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_Raids_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/raids?phase_id=p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_RaidsByID_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/raids/r1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_CreatePhase_MissingName(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{"number":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/saga-1/phases", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreateRaid_MissingName(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/phases/phase-1/raids", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}
