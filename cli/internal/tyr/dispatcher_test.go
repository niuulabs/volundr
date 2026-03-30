package tyr

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func TestNewDispatcher(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	cfg := DispatcherConfig{ForgeBaseURL: "http://localhost:8081"}
	d := NewDispatcher(cfg, store)

	if d == nil {
		t.Fatal("expected non-nil dispatcher")
	}
	if d.client.Timeout != DefaultDispatcherTimeout {
		t.Errorf("expected default timeout, got %v", d.client.Timeout)
	}
}

func TestNewDispatcher_CustomTimeout(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	cfg := DispatcherConfig{ForgeBaseURL: "http://localhost:8081", HTTPTimeout: 5 * time.Second}
	d := NewDispatcher(cfg, store)

	if d.client.Timeout != 5*time.Second {
		t.Errorf("expected 5s timeout, got %v", d.client.Timeout)
	}
}

func TestDispatcher_DispatchRaid(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)

	// Mock Forge server
	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}

		var req sessionCreateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode request: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(sessionCreateResponse{
			ID:     "session-123",
			Name:   req.Name,
			Status: "pending",
		})
	}))
	defer forgeServer.Close()

	cfg := DispatcherConfig{ForgeBaseURL: forgeServer.URL}
	d := NewDispatcher(cfg, store)

	now := time.Now()
	ctx := context.Background()

	// GetRaid
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	// GetPhase
	phaseRows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "ACTIVE", 0.0)
	mock.ExpectQuery("SELECT .* FROM phases WHERE id").WithArgs("p1").WillReturnRows(phaseRows)

	// GetSaga
	sagaRows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("saga-1", "proj-1", "native", "my-saga", "My Saga", pq.Array([]string{"niuulabs/volundr"}),
		"ACTIVE", 0.0, "default", "main", now)
	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").WithArgs("saga-1").WillReturnRows(sagaRows)

	// UpdateRaid
	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	raid, err := d.DispatchRaid(ctx, "r1")
	if err != nil {
		t.Fatalf("DispatchRaid: %v", err)
	}
	if raid.Status != RaidStatusDispatched {
		t.Errorf("expected DISPATCHED, got %s", raid.Status)
	}
	if raid.SessionID == nil || *raid.SessionID != "session-123" {
		t.Errorf("expected session ID session-123, got %v", raid.SessionID)
	}
}

func TestDispatcher_DispatchRaid_NotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	d := NewDispatcher(DispatcherConfig{ForgeBaseURL: "http://localhost:8081"}, store)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").WillReturnError(sql.ErrNoRows)

	_, err = d.DispatchRaid(context.Background(), "nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestDispatcher_DispatchRaid_InvalidStatus(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	d := NewDispatcher(DispatcherConfig{ForgeBaseURL: "http://localhost:8081"}, store)

	now := time.Now()
	// Raid in RUNNING state — cannot dispatch.
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	_, err = d.DispatchRaid(context.Background(), "r1")
	if err == nil {
		t.Fatal("expected error for invalid status")
	}
}

func TestDispatcher_DispatchRaid_ForgeError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)

	// Forge returns 500
	forgeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error"))
	}))
	defer forgeServer.Close()

	d := NewDispatcher(DispatcherConfig{ForgeBaseURL: forgeServer.URL}, store)

	now := time.Now()
	ctx := context.Background()

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

	_, err = d.DispatchRaid(ctx, "r1")
	if err == nil {
		t.Fatal("expected error from forge")
	}
}
