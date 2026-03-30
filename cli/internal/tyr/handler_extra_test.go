package tyr

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func TestHandler_GetPhase_Direct(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_GetPhase_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM phases WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdatePhase_Direct(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Old Name", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(rows)
	mock.ExpectExec("UPDATE phases SET").WillReturnResult(sqlmock.NewResult(0, 1))

	body := `{"name":"New Phase","status":"ACTIVE"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/phases/p1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_UpdatePhase_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM phases WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/phases/nonexistent", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdatePhase_InvalidJSON(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/phases/p1", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_PhaseByID_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/phases/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_GetRaid_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdateRaid_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/nonexistent", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdateRaid_InvalidJSON(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_UpdateSaga_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/nonexistent", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdateSaga_InvalidJSON(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("uuid-1").WillReturnRows(sagaRows)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/uuid-1", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_DeleteSaga_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/nonexistent", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus_NotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	body := `{"status":"QUEUED"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/nonexistent/status", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus_InvalidJSON(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1/status", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1/status", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Should match handleRaidByID, then match subpath "status", then check method.
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_CreateConfidenceEvent_InvalidJSON(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/confidence", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreateConfidenceEvent_RaidNotFound(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	body := `{"event_type":"ci_pass","delta":0.1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/nonexistent/confidence", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestHandler_Confidence_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/raids/r1/confidence", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_DispatchRaid_WithDispatcher(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)

	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(sessionCreateResponse{ID: "s-1", Name: "test", Status: "pending"})
	}))
	defer forgeServer.Close()

	dispatcher := NewDispatcher(DispatcherConfig{ForgeBaseURL: forgeServer.URL}, store)
	handler := NewHandler(store, dispatcher)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "ACTIVE", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(phaseRows)

	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("saga-1", "proj-1", "native", "my-saga", "My Saga", pq.Array([]string{"repo1"}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("saga-1").WillReturnRows(sagaRows)

	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_DispatchRaid_Conflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	dispatcher := NewDispatcher(DispatcherConfig{ForgeBaseURL: "http://localhost:8081"}, store)
	handler := NewHandler(store, dispatcher)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	now := time.Now()
	// Raid in RUNNING state — cannot dispatch
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_SagaSubPhase_Get(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(rows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1/phases/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_SagaSubPhase_Raids(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WithArgs("p1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1/phases/p1/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_GetSaga_WithPhaseAndRaids(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("uuid-1").WillReturnRows(sagaRows)

	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "uuid-1", "t1", 1, "Phase 1", "ACTIVE", 0.5)
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WithArgs("uuid-1").WillReturnRows(phaseRows)

	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WithArgs("p1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	phases, ok := resp["phases"].([]any)
	if !ok || len(phases) != 1 {
		t.Fatalf("expected 1 phase in response")
	}
}

func TestHandler_PhaseByID_Raids(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	})
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WithArgs("p1").WillReturnRows(raidRows)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/p1/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_RaidByID_MissingID(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_PhaseByID_MissingID(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreatePhase_InvalidJSON(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/saga-1/phases", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_CreateRaid_InvalidJSON(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/phases/p1/raids", bytes.NewBufferString("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_SagaSubPhase_Update(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(rows)
	mock.ExpectExec("UPDATE phases SET").WillReturnResult(sqlmock.NewResult(0, 1))

	body := `{"name":"Updated Phase"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/saga-1/phases/p1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
