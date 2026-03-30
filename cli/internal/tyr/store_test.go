package tyr

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func newMockStore(t *testing.T) (*Store, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(db), mock
}

func TestNewStore(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	store := NewStore(db)
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if store.db != db {
		t.Error("store.db should be the passed db")
	}
}

func TestStore_CreateSaga(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	saga := &Saga{
		TrackerID:   "proj-1",
		TrackerType: "native",
		Slug:        "test-saga",
		Name:        "Test Saga",
		Repos:       []string{"repo1"},
		Status:      SagaStatusActive,
		Confidence:  0,
		OwnerID:     "default",
		BaseBranch:  "main",
	}

	rows := sqlmock.NewRows([]string{"id", "created_at"}).
		AddRow("uuid-1", time.Now())
	mock.ExpectQuery("INSERT INTO sagas").
		WithArgs(saga.TrackerID, saga.TrackerType, saga.Slug, saga.Name,
			pq.Array(saga.Repos), saga.Status, saga.Confidence,
			saga.OwnerID, saga.BaseBranch).
		WillReturnRows(rows)

	result, err := store.CreateSaga(ctx, saga)
	if err != nil {
		t.Fatalf("CreateSaga: %v", err)
	}
	if result.ID != "uuid-1" {
		t.Errorf("expected ID uuid-1, got %s", result.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_CreateSaga_Error(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("INSERT INTO sagas").WillReturnError(sql.ErrConnDone)

	_, err := store.CreateSaga(ctx, &Saga{})
	if err == nil {
		t.Fatal("expected error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_GetSaga(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "proj-1", "native", "test", "Test", pq.Array([]string{"repo1"}),
		"ACTIVE", 0.5, "default", "main", now)

	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").
		WithArgs("uuid-1").
		WillReturnRows(rows)

	saga, err := store.GetSaga(ctx, "uuid-1")
	if err != nil {
		t.Fatalf("GetSaga: %v", err)
	}
	if saga == nil {
		t.Fatal("expected non-nil saga")
	}
	if saga.Name != "Test" {
		t.Errorf("expected name 'Test', got %q", saga.Name)
	}
}

func TestStore_GetSaga_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM sagas WHERE id").
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	saga, err := store.GetSaga(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
	if saga != nil {
		t.Error("expected nil saga for not found")
	}
}

func TestStore_ListSagas(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "tracker_id", "tracker_type", "slug", "name", "repos",
		"status", "confidence", "owner_id", "base_branch", "created_at",
	}).AddRow("uuid-1", "p1", "native", "s1", "Saga 1", pq.Array([]string{}),
		"ACTIVE", 0.0, "default", "main", now).
		AddRow("uuid-2", "p2", "native", "s2", "Saga 2", pq.Array([]string{"r1"}),
			"COMPLETE", 1.0, "default", "main", now)

	mock.ExpectQuery("SELECT .* FROM sagas ORDER BY").WillReturnRows(rows)

	sagas, err := store.ListSagas(ctx)
	if err != nil {
		t.Fatalf("ListSagas: %v", err)
	}
	if len(sagas) != 2 {
		t.Fatalf("expected 2 sagas, got %d", len(sagas))
	}
	if sagas[0].Name != "Saga 1" {
		t.Errorf("expected 'Saga 1', got %q", sagas[0].Name)
	}
}

func TestStore_ListSagas_Error(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM sagas ORDER BY").WillReturnError(sql.ErrConnDone)

	_, err := store.ListSagas(ctx)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_UpdateSaga(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	saga := &Saga{ID: "uuid-1", Name: "Updated", Status: SagaStatusComplete,
		Confidence: 0.9, Repos: []string{"r1"}, BaseBranch: "dev"}

	mock.ExpectExec("UPDATE sagas SET").
		WithArgs(saga.Name, saga.Status, saga.Confidence, pq.Array(saga.Repos), saga.BaseBranch, saga.ID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := store.UpdateSaga(ctx, saga); err != nil {
		t.Fatalf("UpdateSaga: %v", err)
	}
}

func TestStore_UpdateSaga_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectExec("UPDATE sagas SET").
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := store.UpdateSaga(ctx, &Saga{ID: "nonexistent"})
	if err == nil {
		t.Fatal("expected error for not found")
	}
}

func TestStore_DeleteSaga(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WithArgs("uuid-1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WithArgs("uuid-1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WithArgs("uuid-1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").WithArgs("uuid-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := store.DeleteSaga(ctx, "uuid-1"); err != nil {
		t.Fatalf("DeleteSaga: %v", err)
	}
}

func TestStore_DeleteSaga_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").WithArgs("nonexistent").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err := store.DeleteSaga(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_CreatePhase(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	phase := &Phase{
		SagaID:    "saga-1",
		TrackerID: "phase-1",
		Number:    1,
		Name:      "Phase 1",
		Status:    PhaseStatusGated,
	}

	rows := sqlmock.NewRows([]string{"id"}).AddRow("phase-uuid-1")
	mock.ExpectQuery("INSERT INTO phases").
		WithArgs(phase.SagaID, phase.TrackerID, phase.Number, phase.Name, phase.Status, phase.Confidence).
		WillReturnRows(rows)

	result, err := store.CreatePhase(ctx, phase)
	if err != nil {
		t.Fatalf("CreatePhase: %v", err)
	}
	if result.ID != "phase-uuid-1" {
		t.Errorf("expected ID phase-uuid-1, got %s", result.ID)
	}
}

func TestStore_ListPhases(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0).
		AddRow("p2", "saga-1", "t2", 2, "Phase 2", "ACTIVE", 0.5)

	mock.ExpectQuery("SELECT .* FROM phases WHERE saga_id").
		WithArgs("saga-1").
		WillReturnRows(rows)

	phases, err := store.ListPhases(ctx, "saga-1")
	if err != nil {
		t.Fatalf("ListPhases: %v", err)
	}
	if len(phases) != 2 {
		t.Fatalf("expected 2 phases, got %d", len(phases))
	}
}

func TestStore_GetPhase(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{
		"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
	}).AddRow("p1", "saga-1", "t1", 1, "Phase 1", "GATED", 0.0)

	mock.ExpectQuery("SELECT .* FROM phases WHERE id").
		WithArgs("p1").
		WillReturnRows(rows)

	phase, err := store.GetPhase(ctx, "p1")
	if err != nil {
		t.Fatalf("GetPhase: %v", err)
	}
	if phase == nil {
		t.Fatal("expected non-nil phase")
	}
	if phase.Name != "Phase 1" {
		t.Errorf("expected 'Phase 1', got %q", phase.Name)
	}
}

func TestStore_GetPhase_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM phases WHERE id").
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	phase, err := store.GetPhase(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
	if phase != nil {
		t.Error("expected nil phase")
	}
}

func TestStore_UpdatePhase(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	phase := &Phase{ID: "p1", Name: "Updated", Status: PhaseStatusActive, Confidence: 0.7}

	mock.ExpectExec("UPDATE phases SET").
		WithArgs(phase.Name, phase.Status, phase.Confidence, phase.ID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := store.UpdatePhase(ctx, phase); err != nil {
		t.Fatalf("UpdatePhase: %v", err)
	}
}

func TestStore_UpdatePhase_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectExec("UPDATE phases SET").
		WillReturnResult(sqlmock.NewResult(0, 0))

	err := store.UpdatePhase(ctx, &Phase{ID: "nonexistent"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_CreateRaid(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	raid := &Raid{
		PhaseID:            "phase-1",
		TrackerID:          "raid-1",
		Name:               "Implement feature",
		Description:        "Do the thing",
		AcceptanceCriteria: []string{"test passes"},
		DeclaredFiles:      []string{"file.go"},
		Status:             RaidStatusPending,
	}

	rows := sqlmock.NewRows([]string{"id"}).AddRow("raid-uuid-1")
	mock.ExpectQuery("INSERT INTO raids").WillReturnRows(rows)

	result, err := store.CreateRaid(ctx, raid)
	if err != nil {
		t.Fatalf("CreateRaid: %v", err)
	}
	if result.ID != "raid-uuid-1" {
		t.Errorf("expected ID raid-uuid-1, got %s", result.ID)
	}
	if result.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}
}

func TestStore_GetRaid(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "desc", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("r1").
		WillReturnRows(rows)

	raid, err := store.GetRaid(ctx, "r1")
	if err != nil {
		t.Fatalf("GetRaid: %v", err)
	}
	if raid == nil {
		t.Fatal("expected non-nil raid")
	}
	if raid.Name != "Raid 1" {
		t.Errorf("expected 'Raid 1', got %q", raid.Name)
	}
}

func TestStore_GetRaid_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	raid, err := store.GetRaid(ctx, "nonexistent")
	if err != nil {
		t.Fatalf("expected nil error, got: %v", err)
	}
	if raid != nil {
		t.Error("expected nil raid")
	}
}

func TestStore_ListRaids(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)

	mock.ExpectQuery("SELECT .* FROM raids WHERE phase_id").
		WithArgs("p1").
		WillReturnRows(rows)

	raids, err := store.ListRaids(ctx, "p1")
	if err != nil {
		t.Fatalf("ListRaids: %v", err)
	}
	if len(raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(raids))
	}
}

func TestStore_UpdateRaid(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	raid := &Raid{
		ID: "r1", Name: "Updated", Status: RaidStatusRunning,
		Description: "new desc", AcceptanceCriteria: []string{},
	}

	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	if err := store.UpdateRaid(ctx, raid); err != nil {
		t.Fatalf("UpdateRaid: %v", err)
	}
	if raid.UpdatedAt.IsZero() {
		t.Error("expected non-zero UpdatedAt")
	}
}

func TestStore_UpdateRaid_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 0))

	err := store.UpdateRaid(ctx, &Raid{ID: "nonexistent"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_UpdateRaidStatus(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	// GetRaid
	rows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(rows)

	// UpdateRaid
	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	if err := store.UpdateRaidStatus(ctx, "r1", RaidStatusQueued, nil); err != nil {
		t.Fatalf("UpdateRaidStatus: %v", err)
	}
}

func TestStore_UpdateRaidStatus_InvalidTransition(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "PENDING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(rows)

	err := store.UpdateRaidStatus(ctx, "r1", RaidStatusMerged, nil)
	if err == nil {
		t.Fatal("expected error for invalid transition")
	}
}

func TestStore_UpdateRaidStatus_NotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	err := store.UpdateRaidStatus(ctx, "nonexistent", RaidStatusQueued, nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_UpdateRaidStatus_Failed_IncrementsRetry(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.0, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(rows)

	mock.ExpectExec("UPDATE raids SET").WillReturnResult(sqlmock.NewResult(0, 1))

	reason := "tests failed"
	if err := store.UpdateRaidStatus(ctx, "r1", RaidStatusFailed, &reason); err != nil {
		t.Fatalf("UpdateRaidStatus: %v", err)
	}
}

func TestStore_CreateConfidenceEvent(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	// GetRaid
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid 1", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.5, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	// Insert confidence event
	evRows := sqlmock.NewRows([]string{"id", "created_at"}).AddRow("ev-1", now)
	mock.ExpectQuery("INSERT INTO confidence_events").WillReturnRows(evRows)

	// Update raid confidence
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))

	event, err := store.CreateConfidenceEvent(ctx, "r1", ConfidenceEventCIPass, 0.1)
	if err != nil {
		t.Fatalf("CreateConfidenceEvent: %v", err)
	}
	if event.ScoreAfter != 0.6 {
		t.Errorf("expected score 0.6, got %f", event.ScoreAfter)
	}
}

func TestStore_CreateConfidenceEvent_Clamped(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	// Raid with confidence 0.9 — adding 0.2 should clamp to 1.0
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.9, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	evRows := sqlmock.NewRows([]string{"id", "created_at"}).AddRow("ev-1", now)
	mock.ExpectQuery("INSERT INTO confidence_events").WillReturnRows(evRows)
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))

	event, err := store.CreateConfidenceEvent(ctx, "r1", ConfidenceEventCIPass, 0.2)
	if err != nil {
		t.Fatalf("CreateConfidenceEvent: %v", err)
	}
	if event.ScoreAfter != 1.0 {
		t.Errorf("expected clamped score 1.0, got %f", event.ScoreAfter)
	}
}

func TestStore_CreateConfidenceEvent_ClampedToZero(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	raidRows := sqlmock.NewRows([]string{
		"id", "phase_id", "tracker_id", "name", "description", "acceptance_criteria",
		"declared_files", "estimate_hours", "status", "confidence", "session_id", "branch",
		"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "created_at", "updated_at",
	}).AddRow("r1", "p1", "t1", "Raid", "", pq.Array([]string{}),
		pq.Array([]string{}), nil, "RUNNING", 0.1, nil, nil,
		nil, nil, nil, nil, 0, now, now)
	mock.ExpectQuery("SELECT .* FROM raids WHERE id").WithArgs("r1").WillReturnRows(raidRows)

	evRows := sqlmock.NewRows([]string{"id", "created_at"}).AddRow("ev-1", now)
	mock.ExpectQuery("INSERT INTO confidence_events").WillReturnRows(evRows)
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))

	event, err := store.CreateConfidenceEvent(ctx, "r1", ConfidenceEventCIFail, -0.5)
	if err != nil {
		t.Fatalf("CreateConfidenceEvent: %v", err)
	}
	if event.ScoreAfter != 0 {
		t.Errorf("expected clamped score 0, got %f", event.ScoreAfter)
	}
}

func TestStore_CreateConfidenceEvent_RaidNotFound(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .* FROM raids WHERE id").
		WithArgs("nonexistent").
		WillReturnError(sql.ErrNoRows)

	_, err := store.CreateConfidenceEvent(ctx, "nonexistent", ConfidenceEventCIPass, 0.1)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestStore_ListConfidenceEvents(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "raid_id", "event_type", "delta", "score_after", "created_at",
	}).AddRow("ev-1", "r1", "ci_pass", 0.1, 0.6, now)

	mock.ExpectQuery("SELECT .* FROM confidence_events WHERE raid_id").
		WithArgs("r1").
		WillReturnRows(rows)

	events, err := store.ListConfidenceEvents(ctx, "r1")
	if err != nil {
		t.Fatalf("ListConfidenceEvents: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
}

func TestStore_Ping(t *testing.T) {
	store, mock := newMockStore(t)
	ctx := context.Background()

	mock.ExpectPing()

	if err := store.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
