package tyr

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func setupStore(t *testing.T) (*Store, sqlmock.Sqlmock) {
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
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if store.DB() != db {
		t.Error("DB() should return the underlying database")
	}
}

func TestStoreListSagas_Empty(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(sqlmock.NewRows(nil))

	sagas, err := store.ListSagas(ctx, "test-user")
	if err != nil {
		t.Fatalf("ListSagas error: %v", err)
	}
	if len(sagas) != 0 {
		t.Errorf("expected 0 sagas, got %d", len(sagas))
	}
}

func TestStoreListSagas_WithResults(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "my-project", "My Project", pq.Array([]string{"repo1", "repo2"}), "ACTIVE", 0.75, "test-user", "main", now).
		AddRow("saga-2", "t-2", "native", "other", "Other", pq.Array([]string{}), "COMPLETE", 1.0, "test-user", "develop", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("test-user").
		WillReturnRows(rows)

	sagas, err := store.ListSagas(ctx, "test-user")
	if err != nil {
		t.Fatalf("ListSagas error: %v", err)
	}
	if len(sagas) != 2 {
		t.Fatalf("expected 2 sagas, got %d", len(sagas))
	}
	if sagas[0].Name != "My Project" {
		t.Errorf("expected 'My Project', got %q", sagas[0].Name)
	}
	if len(sagas[0].Repos) != 2 {
		t.Errorf("expected 2 repos, got %d", len(sagas[0].Repos))
	}
	if sagas[1].Status != SagaStatusComplete {
		t.Errorf("expected COMPLETE status, got %q", sagas[1].Status)
	}
}

func TestGetSaga_Found(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test", pq.Array([]string{"repo1"}), "ACTIVE", 0.8, "owner-1", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("saga-1", "owner-1").
		WillReturnRows(rows)

	saga, err := store.GetSaga(ctx, "saga-1", "owner-1")
	if err != nil {
		t.Fatalf("GetSaga error: %v", err)
	}
	if saga == nil {
		t.Fatal("expected saga, got nil")
	}
	if saga.ID != "saga-1" {
		t.Errorf("expected ID 'saga-1', got %q", saga.ID)
	}
	if saga.FeatureBranch != "feat/test" {
		t.Errorf("expected feature branch 'feat/test', got %q", saga.FeatureBranch)
	}
}

func TestStoreGetSaga_NotFound(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .+ FROM sagas").
		WithArgs("nonexistent", "owner").
		WillReturnRows(sqlmock.NewRows(nil))

	saga, err := store.GetSaga(ctx, "nonexistent", "owner")
	if err != nil {
		t.Fatalf("GetSaga error: %v", err)
	}
	if saga != nil {
		t.Error("expected nil saga for missing ID")
	}
}

func TestGetSagaBySlug(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "my-slug", "My Saga", pq.Array([]string{}), "ACTIVE", 0.75, "owner", "main", now)
	mock.ExpectQuery("SELECT .+ FROM sagas WHERE slug").
		WithArgs("my-slug").
		WillReturnRows(rows)

	saga, err := store.GetSagaBySlug(ctx, "my-slug")
	if err != nil {
		t.Fatalf("GetSagaBySlug error: %v", err)
	}
	if saga == nil {
		t.Fatal("expected saga")
	}
	if saga.Slug != "my-slug" {
		t.Errorf("expected slug 'my-slug', got %q", saga.Slug)
	}
}

func TestStoreDeleteSaga_Success(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("saga-1", "owner-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	deleted, err := store.DeleteSaga(ctx, "saga-1", "owner-1")
	if err != nil {
		t.Fatalf("DeleteSaga error: %v", err)
	}
	if !deleted {
		t.Error("expected deleted=true")
	}
}

func TestStoreDeleteSaga_NotFound(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectBegin()
	mock.ExpectExec("DELETE FROM confidence_events").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM raids").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM phases").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("DELETE FROM sagas").
		WithArgs("missing", "owner-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	deleted, err := store.DeleteSaga(ctx, "missing", "owner-1")
	if err != nil {
		t.Fatalf("DeleteSaga error: %v", err)
	}
	if deleted {
		t.Error("expected deleted=false for missing saga")
	}
}

func TestListPhases(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{"id", "saga_id", "tracker_id", "number", "name", "status", "confidence"}).
		AddRow("p-1", "saga-1", "p-1", 1, "Phase 1", "ACTIVE", 0.75).
		AddRow("p-2", "saga-1", "p-2", 2, "Phase 2", "GATED", 0.5)
	mock.ExpectQuery("SELECT .+ FROM phases").
		WithArgs("saga-1").
		WillReturnRows(rows)

	phases, err := store.ListPhases(ctx, "saga-1")
	if err != nil {
		t.Fatalf("ListPhases error: %v", err)
	}
	if len(phases) != 2 {
		t.Fatalf("expected 2 phases, got %d", len(phases))
	}
	if phases[0].Number != 1 {
		t.Errorf("expected phase 1 number=1, got %d", phases[0].Number)
	}
	if phases[1].Status != PhaseStatusGated {
		t.Errorf("expected phase 2 status GATED, got %q", phases[1].Status)
	}
}

func TestGetRaid_Found(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("raid-1", "phase-1", "raid-1", "", "", "Test Raid", "Do things", pq.Array([]string{"it works"}), pq.Array([]string{"file.go"}), 2.0, "RUNNING", 0.8, "sess-1", "feat/raid-1", nil, nil, nil, nil, 1, "rev-1", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(rows)

	raid, err := store.GetRaid(ctx, "raid-1")
	if err != nil {
		t.Fatalf("GetRaid error: %v", err)
	}
	if raid == nil {
		t.Fatal("expected raid")
	}
	if raid.Name != "Test Raid" {
		t.Errorf("expected name 'Test Raid', got %q", raid.Name)
	}
	if raid.Description != "Do things" {
		t.Errorf("expected description 'Do things', got %q", raid.Description)
	}
	if len(raid.AcceptanceCriteria) != 1 {
		t.Errorf("expected 1 acceptance criterion, got %d", len(raid.AcceptanceCriteria))
	}
	if raid.ReviewerSessionID == nil || *raid.ReviewerSessionID != "rev-1" {
		t.Error("expected reviewer_session_id 'rev-1'")
	}
}

func TestGetRaid_NotFound(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("missing").
		WillReturnRows(sqlmock.NewRows(nil))

	raid, err := store.GetRaid(ctx, "missing")
	if err != nil {
		t.Fatalf("GetRaid error: %v", err)
	}
	if raid != nil {
		t.Error("expected nil raid for missing ID")
	}
}

func TestCountByStatus(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	rows := sqlmock.NewRows([]string{"status", "count"}).
		AddRow("PENDING", 5).
		AddRow("RUNNING", 2).
		AddRow("MERGED", 10)
	mock.ExpectQuery("SELECT status, COUNT").WillReturnRows(rows)

	counts, err := store.CountByStatus(ctx)
	if err != nil {
		t.Fatalf("CountByStatus error: %v", err)
	}
	if counts["PENDING"] != 5 {
		t.Errorf("PENDING: expected 5, got %d", counts["PENDING"])
	}
	if counts["RUNNING"] != 2 {
		t.Errorf("RUNNING: expected 2, got %d", counts["RUNNING"])
	}
	if counts["MERGED"] != 10 {
		t.Errorf("MERGED: expected 10, got %d", counts["MERGED"])
	}
}

func TestCreateSaga_Transaction(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	saga := &Saga{
		ID: "saga-1", TrackerID: "t-1", TrackerType: "native",
		Slug: "test", Name: "Test", Repos: []string{"r1"},
		Status: SagaStatusActive, Confidence: 0.75, OwnerID: "owner",
		BaseBranch: "main", CreatedAt: now,
	}
	phases := []Phase{
		{ID: "p-1", SagaID: "saga-1", TrackerID: "p-1", Number: 1, Name: "P1", Status: PhaseStatusActive, Confidence: 0.75},
	}
	raids := []Raid{
		{ID: "r-1", PhaseID: "p-1", TrackerID: "r-1", Name: "R1", Status: RaidStatusPending, Confidence: 0.75, CreatedAt: now, UpdatedAt: now},
	}

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO sagas").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO phases").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO raids").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := store.CreateSaga(ctx, saga, phases, raids)
	if err != nil {
		t.Fatalf("CreateSaga error: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestUpdateRaidSession(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectExec("UPDATE raids SET session_id").
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := store.UpdateRaidSession(ctx, "raid-1", "session-1", "feat/branch")
	if err != nil {
		t.Fatalf("UpdateRaidSession error: %v", err)
	}
}

func TestListActiveRaids(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("raid-1", "p-1", "raid-1", "", "", "Active", "", pq.Array([]string{}), pq.Array([]string{}), nil, "RUNNING", 0.8, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE status NOT IN").WillReturnRows(rows)

	raids, err := store.ListActiveRaids(ctx)
	if err != nil {
		t.Fatalf("ListActiveRaids error: %v", err)
	}
	if len(raids) != 1 {
		t.Fatalf("expected 1 active raid, got %d", len(raids))
	}
}

func TestUpdateRaidStatus_Success(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	// GetRaid (for validation)
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	err := store.UpdateRaidStatus(ctx, "raid-1", RaidStatusQueued, nil)
	if err != nil {
		t.Fatalf("UpdateRaidStatus error: %v", err)
	}
}

func TestUpdateRaidStatus_InvalidTransition(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	raidCols := []string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidCols).
			AddRow("raid-1", "p-1", "raid-1", "", "", "Test", "", pq.Array([]string{}), pq.Array([]string{}), nil, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now))

	err := store.UpdateRaidStatus(ctx, "raid-1", RaidStatusMerged, nil)
	if err == nil {
		t.Fatal("expected error for invalid transition PENDING → MERGED")
	}
}

func TestUpdateRaidStatus_NotFound(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("missing").
		WillReturnRows(sqlmock.NewRows(nil))

	err := store.UpdateRaidStatus(ctx, "missing", RaidStatusQueued, nil)
	if err == nil {
		t.Fatal("expected error for missing raid")
	}
}

func TestAddConfidenceEvent_Success(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err := store.AddConfidenceEvent(ctx, "raid-1", "human_approved", 0.1)
	if err != nil {
		t.Fatalf("AddConfidenceEvent error: %v", err)
	}
}

func TestListRaids(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "phase_id", "tracker_id", "identifier", "url", "name", "description", "acceptance_criteria", "declared_files", "estimate_hours", "status", "confidence", "session_id", "branch", "chronicle_summary", "pr_url", "pr_id", "reason", "retry_count", "reviewer_session_id", "review_round", "created_at", "updated_at"}).
		AddRow("r-1", "p-1", "r-1", "", "", "Raid 1", "desc", pq.Array([]string{"it works"}), pq.Array([]string{"file.go"}), 2.0, "PENDING", 0.75, nil, nil, nil, nil, nil, nil, 0, "", 0, now, now)
	mock.ExpectQuery("SELECT .+ FROM raids WHERE phase_id").
		WithArgs("p-1").
		WillReturnRows(rows)

	raids, err := store.ListRaids(ctx, "p-1")
	if err != nil {
		t.Fatalf("ListRaids error: %v", err)
	}
	if len(raids) != 1 {
		t.Fatalf("expected 1 raid, got %d", len(raids))
	}
	if raids[0].Name != "Raid 1" {
		t.Errorf("expected name 'Raid 1', got %q", raids[0].Name)
	}
}

func TestGetSagaForRaid(t *testing.T) {
	store, mock := setupStore(t)
	ctx := context.Background()

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "tracker_id", "tracker_type", "slug", "name", "repos", "status", "confidence", "owner_id", "base_branch", "created_at"}).
		AddRow("saga-1", "t-1", "native", "test", "Test", pq.Array([]string{"r1"}), "ACTIVE", 0.75, "owner", "main", now)
	mock.ExpectQuery("SELECT s\\..+ FROM sagas s").
		WithArgs("raid-1").
		WillReturnRows(rows)

	saga, err := store.GetSagaForRaid(ctx, "raid-1")
	if err != nil {
		t.Fatalf("GetSagaForRaid error: %v", err)
	}
	if saga == nil {
		t.Fatal("expected saga")
	}
	if saga.ID != "saga-1" {
		t.Errorf("expected saga ID 'saga-1', got %q", saga.ID)
	}
	if saga.FeatureBranch != "feat/test" {
		t.Errorf("expected feature branch 'feat/test', got %q", saga.FeatureBranch)
	}
}
