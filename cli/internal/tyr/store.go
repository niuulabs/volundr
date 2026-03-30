package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/lib/pq"
)

// Store provides CRUD operations for sagas, phases, and raids against PostgreSQL.
type Store struct {
	db *sql.DB
}

// NewStore creates a store backed by the given database connection.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// --- Sagas ---

// CreateSaga inserts a new saga and returns the created record.
func (s *Store) CreateSaga(ctx context.Context, saga *Saga) (*Saga, error) {
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO sagas (tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id, base_branch)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, created_at
	`,
		saga.TrackerID, saga.TrackerType, saga.Slug, saga.Name,
		pq.Array(saga.Repos), saga.Status, saga.Confidence,
		saga.OwnerID, saga.BaseBranch,
	)

	if err := row.Scan(&saga.ID, &saga.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert saga: %w", err)
	}
	return saga, nil
}

// GetSaga retrieves a saga by ID.
func (s *Store) GetSaga(ctx context.Context, id string) (*Saga, error) {
	saga := &Saga{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id, base_branch, created_at
		FROM sagas WHERE id = $1
	`, id).Scan(
		&saga.ID, &saga.TrackerID, &saga.TrackerType, &saga.Slug, &saga.Name,
		pq.Array(&saga.Repos), &saga.Status, &saga.Confidence,
		&saga.OwnerID, &saga.BaseBranch, &saga.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get saga %s: %w", id, err)
	}
	return saga, nil
}

// ListSagas returns all sagas, ordered by creation time descending.
func (s *Store) ListSagas(ctx context.Context) ([]*Saga, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id, base_branch, created_at
		FROM sagas ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list sagas: %w", err)
	}
	defer rows.Close()

	var sagas []*Saga
	for rows.Next() {
		saga := &Saga{}
		if err := rows.Scan(
			&saga.ID, &saga.TrackerID, &saga.TrackerType, &saga.Slug, &saga.Name,
			pq.Array(&saga.Repos), &saga.Status, &saga.Confidence,
			&saga.OwnerID, &saga.BaseBranch, &saga.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan saga: %w", err)
		}
		sagas = append(sagas, saga)
	}
	return sagas, rows.Err()
}

// UpdateSaga updates mutable fields on a saga.
func (s *Store) UpdateSaga(ctx context.Context, saga *Saga) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE sagas SET name = $1, status = $2, confidence = $3, repos = $4, base_branch = $5
		WHERE id = $6
	`, saga.Name, saga.Status, saga.Confidence, pq.Array(saga.Repos), saga.BaseBranch, saga.ID)
	if err != nil {
		return fmt.Errorf("update saga %s: %w", saga.ID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("saga %s not found", saga.ID)
	}
	return nil
}

// DeleteSaga removes a saga and cascading phases/raids.
func (s *Store) DeleteSaga(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}

	// Delete confidence events for raids in this saga.
	_, err = tx.ExecContext(ctx, `
		DELETE FROM confidence_events WHERE raid_id IN (
			SELECT r.id FROM raids r
			JOIN phases p ON r.phase_id = p.id
			WHERE p.saga_id = $1
		)
	`, id)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete confidence events: %w", err)
	}

	// Delete raids for phases in this saga.
	_, err = tx.ExecContext(ctx, `
		DELETE FROM raids WHERE phase_id IN (
			SELECT id FROM phases WHERE saga_id = $1
		)
	`, id)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete raids: %w", err)
	}

	// Delete phases.
	if _, err = tx.ExecContext(ctx, `DELETE FROM phases WHERE saga_id = $1`, id); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete phases: %w", err)
	}

	// Delete saga.
	result, err := tx.ExecContext(ctx, `DELETE FROM sagas WHERE id = $1`, id)
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete saga: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		_ = tx.Rollback()
		return fmt.Errorf("saga %s not found", id)
	}
	return tx.Commit()
}

// --- Phases ---

// CreatePhase inserts a new phase.
func (s *Store) CreatePhase(ctx context.Context, phase *Phase) (*Phase, error) {
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO phases (saga_id, tracker_id, number, name, status, confidence)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`,
		phase.SagaID, phase.TrackerID, phase.Number, phase.Name,
		phase.Status, phase.Confidence,
	).Scan(&phase.ID)
	if err != nil {
		return nil, fmt.Errorf("insert phase: %w", err)
	}
	return phase, nil
}

// ListPhases returns phases for a saga, ordered by number.
func (s *Store) ListPhases(ctx context.Context, sagaID string) ([]*Phase, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, saga_id, tracker_id, number, name, status, confidence
		FROM phases WHERE saga_id = $1 ORDER BY number
	`, sagaID)
	if err != nil {
		return nil, fmt.Errorf("list phases: %w", err)
	}
	defer rows.Close()

	var phases []*Phase
	for rows.Next() {
		p := &Phase{}
		if err := rows.Scan(&p.ID, &p.SagaID, &p.TrackerID, &p.Number, &p.Name, &p.Status, &p.Confidence); err != nil {
			return nil, fmt.Errorf("scan phase: %w", err)
		}
		phases = append(phases, p)
	}
	return phases, rows.Err()
}

// GetPhase retrieves a single phase by ID.
func (s *Store) GetPhase(ctx context.Context, id string) (*Phase, error) {
	p := &Phase{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, saga_id, tracker_id, number, name, status, confidence
		FROM phases WHERE id = $1
	`, id).Scan(&p.ID, &p.SagaID, &p.TrackerID, &p.Number, &p.Name, &p.Status, &p.Confidence)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get phase %s: %w", id, err)
	}
	return p, nil
}

// UpdatePhase updates mutable fields on a phase.
func (s *Store) UpdatePhase(ctx context.Context, phase *Phase) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE phases SET name = $1, status = $2, confidence = $3 WHERE id = $4
	`, phase.Name, phase.Status, phase.Confidence, phase.ID)
	if err != nil {
		return fmt.Errorf("update phase %s: %w", phase.ID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("phase %s not found", phase.ID)
	}
	return nil
}

// --- Raids ---

// CreateRaid inserts a new raid.
func (s *Store) CreateRaid(ctx context.Context, raid *Raid) (*Raid, error) {
	now := time.Now().UTC()
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO raids (phase_id, tracker_id, name, description, acceptance_criteria,
			declared_files, estimate_hours, status, confidence, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id
	`,
		raid.PhaseID, raid.TrackerID, raid.Name, raid.Description,
		pq.Array(raid.AcceptanceCriteria), pq.Array(raid.DeclaredFiles),
		raid.EstimateHours, raid.Status, raid.Confidence, now, now,
	).Scan(&raid.ID)
	if err != nil {
		return nil, fmt.Errorf("insert raid: %w", err)
	}
	raid.CreatedAt = now
	raid.UpdatedAt = now
	return raid, nil
}

// GetRaid retrieves a single raid by ID.
func (s *Store) GetRaid(ctx context.Context, id string) (*Raid, error) {
	r := &Raid{}
	err := s.db.QueryRowContext(ctx, `
		SELECT id, phase_id, tracker_id, name, description, acceptance_criteria,
			declared_files, estimate_hours, status, confidence, session_id, branch,
			chronicle_summary, pr_url, pr_id, reason, retry_count, created_at, updated_at
		FROM raids WHERE id = $1
	`, id).Scan(
		&r.ID, &r.PhaseID, &r.TrackerID, &r.Name, &r.Description,
		pq.Array(&r.AcceptanceCriteria), pq.Array(&r.DeclaredFiles),
		&r.EstimateHours, &r.Status, &r.Confidence, &r.SessionID, &r.Branch,
		&r.ChronicleSummary, &r.PRUrl, &r.PRID, &r.Reason,
		&r.RetryCount, &r.CreatedAt, &r.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get raid %s: %w", id, err)
	}
	return r, nil
}

// ListRaids returns raids for a phase, ordered by creation time.
func (s *Store) ListRaids(ctx context.Context, phaseID string) ([]*Raid, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, phase_id, tracker_id, name, description, acceptance_criteria,
			declared_files, estimate_hours, status, confidence, session_id, branch,
			chronicle_summary, pr_url, pr_id, reason, retry_count, created_at, updated_at
		FROM raids WHERE phase_id = $1 ORDER BY created_at
	`, phaseID)
	if err != nil {
		return nil, fmt.Errorf("list raids: %w", err)
	}
	defer rows.Close()

	var raids []*Raid
	for rows.Next() {
		r := &Raid{}
		if err := rows.Scan(
			&r.ID, &r.PhaseID, &r.TrackerID, &r.Name, &r.Description,
			pq.Array(&r.AcceptanceCriteria), pq.Array(&r.DeclaredFiles),
			&r.EstimateHours, &r.Status, &r.Confidence, &r.SessionID, &r.Branch,
			&r.ChronicleSummary, &r.PRUrl, &r.PRID, &r.Reason,
			&r.RetryCount, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan raid: %w", err)
		}
		raids = append(raids, r)
	}
	return raids, rows.Err()
}

// UpdateRaid updates mutable fields on a raid.
func (s *Store) UpdateRaid(ctx context.Context, raid *Raid) error {
	raid.UpdatedAt = time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE raids SET name = $1, status = $2, confidence = $3, session_id = $4,
			branch = $5, chronicle_summary = $6, pr_url = $7, pr_id = $8,
			reason = $9, retry_count = $10, description = $11, acceptance_criteria = $12,
			updated_at = $13
		WHERE id = $14
	`,
		raid.Name, raid.Status, raid.Confidence, raid.SessionID,
		raid.Branch, raid.ChronicleSummary, raid.PRUrl, raid.PRID,
		raid.Reason, raid.RetryCount, raid.Description, pq.Array(raid.AcceptanceCriteria),
		raid.UpdatedAt, raid.ID,
	)
	if err != nil {
		return fmt.Errorf("update raid %s: %w", raid.ID, err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("raid %s not found", raid.ID)
	}
	return nil
}

// UpdateRaidStatus transitions a raid to a new status, enforcing the state machine.
func (s *Store) UpdateRaidStatus(ctx context.Context, id string, newStatus RaidStatus, reason *string) error {
	raid, err := s.GetRaid(ctx, id)
	if err != nil {
		return err
	}
	if raid == nil {
		return fmt.Errorf("raid %s not found", id)
	}

	if !ValidTransition(raid.Status, newStatus) {
		return fmt.Errorf("invalid transition from %s to %s", raid.Status, newStatus)
	}

	raid.Status = newStatus
	raid.Reason = reason
	if newStatus == RaidStatusFailed {
		raid.RetryCount++
	}
	return s.UpdateRaid(ctx, raid)
}

// --- Confidence Events ---

// CreateConfidenceEvent records a confidence change and updates the raid score.
func (s *Store) CreateConfidenceEvent(ctx context.Context, raidID string, eventType ConfidenceEventType, delta float64) (*ConfidenceEvent, error) {
	raid, err := s.GetRaid(ctx, raidID)
	if err != nil {
		return nil, err
	}
	if raid == nil {
		return nil, fmt.Errorf("raid %s not found", raidID)
	}

	scoreAfter := raid.Confidence + delta
	if scoreAfter < 0 {
		scoreAfter = 0
	}
	if scoreAfter > 1 {
		scoreAfter = 1
	}

	ev := &ConfidenceEvent{}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO confidence_events (raid_id, event_type, delta, score_after)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at
	`, raidID, eventType, delta, scoreAfter).Scan(&ev.ID, &ev.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert confidence event: %w", err)
	}

	// Update raid confidence.
	_, err = s.db.ExecContext(ctx, `UPDATE raids SET confidence = $1, updated_at = NOW() WHERE id = $2`, scoreAfter, raidID)
	if err != nil {
		return nil, fmt.Errorf("update raid confidence: %w", err)
	}

	ev.RaidID = raidID
	ev.EventType = eventType
	ev.Delta = delta
	ev.ScoreAfter = scoreAfter
	return ev, nil
}

// ListConfidenceEvents returns events for a raid, ordered by creation time.
func (s *Store) ListConfidenceEvents(ctx context.Context, raidID string) ([]*ConfidenceEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, raid_id, event_type, delta, score_after, created_at
		FROM confidence_events WHERE raid_id = $1 ORDER BY created_at
	`, raidID)
	if err != nil {
		return nil, fmt.Errorf("list confidence events: %w", err)
	}
	defer rows.Close()

	var events []*ConfidenceEvent
	for rows.Next() {
		ev := &ConfidenceEvent{}
		if err := rows.Scan(&ev.ID, &ev.RaidID, &ev.EventType, &ev.Delta, &ev.ScoreAfter, &ev.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan confidence event: %w", err)
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// Ping verifies the database connection is alive.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

