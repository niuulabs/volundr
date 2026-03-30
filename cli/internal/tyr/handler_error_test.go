package tyr

import (
	"bytes"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

// Tests for error paths in handlers that hit SQL errors (db.QueryContext returns error).

func TestHandler_ListSagas_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM sagas ORDER BY").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_CreateSaga_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("INSERT INTO sagas").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Test","slug":"test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_GetSaga_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_GetSaga_PhaseListError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnRows(sagaRows)
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_GetSaga_RaidListError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnRows(sagaRows)

	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "uuid-1", "t1", 1, "Phase 1", "ACTIVE", 0.5)
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WillReturnRows(phaseRows)
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdateSaga_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/uuid-1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdateSaga_UpdateError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "test", "Test", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnRows(sagaRows)
	mock.ExpectExec("UPDATE sagas SET").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/sagas/uuid-1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_DeleteSaga_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnError(sql.ErrConnDone)
	mock.ExpectRollback()

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/uuid-1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_ListPhases_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/sagas/saga-1/phases", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_CreatePhase_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("INSERT INTO phases").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Phase 1","number":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/sagas/saga-1/phases", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_GetPhase_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/p1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdatePhase_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/phases/p1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdatePhase_UpdateError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WillReturnRows(rows)
	mock.ExpectExec("UPDATE phases SET").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/phases/p1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_ListRaids_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/phases/p1/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_CreateRaid_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("INSERT INTO raids").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Raid 1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/phases/p1/raids", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_GetRaid_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdateRaid_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdateRaid_UpdateError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnRows(raidRows)
	mock.ExpectExec("UPDATE raids SET").WillReturnError(sql.ErrConnDone)

	body := `{"name":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_DispatchRaid_NotFound(t *testing.T) {
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

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnError(sql.ErrNoRows)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/nonexistent/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandler_ListConfidenceEvents_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM confidence_events").WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/raids/r1/confidence", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_UpdateRaidStatus_DBError(t *testing.T) {
	_, mock, mux := setupTestHandler(t)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnError(sql.ErrConnDone)

	body := `{"status":"QUEUED"}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/tyr/raids/r1/status", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestHandler_SagaPhases_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/sagas/saga-1/phases", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_PhaseRaids_MethodNotAllowed(t *testing.T) {
	_, _, mux := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tyr/phases/p1/raids", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestHandler_Health_Degraded(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	handler := NewHandler(store, nil)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	mock.ExpectPing().WillReturnError(sql.ErrConnDone)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestHandler_DispatchRaid_ForgeServerError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)

	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("server error"))
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
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WillReturnRows(raidRows)

	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "ACTIVE", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WillReturnRows(phaseRows)

	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("saga-1", "proj-1", "native", "my-saga", "My Saga", pq.Array([]string{"repo1"}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WillReturnRows(sagaRows)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/tyr/raids/r1/dispatch", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}
