package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// Store provides PostgreSQL-backed CRUD for sagas, phases, and raids.
type Store struct {
	db *sql.DB
}

// NewStore creates a new Store from the given database connection.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// Ping checks that the database is reachable.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

// DB returns the underlying database connection for use in migrations.
func (s *Store) DB() *sql.DB {
	return s.db
}

// Saga operations.

// CreateSaga persists a new saga with its phases and raids in a single transaction.
func (s *Store) CreateSaga(ctx context.Context, saga *Saga, phases []Phase, raids []Raid) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(ctx, `
		INSERT INTO sagas (id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id, base_branch, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		saga.ID, saga.TrackerID, saga.TrackerType, saga.Slug, saga.Name,
		pq.Array(saga.Repos), string(saga.Status), saga.Confidence,
		saga.OwnerID, saga.BaseBranch, saga.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert saga: %w", err)
	}

	for i := range phases {
		p := &phases[i]
		_, err = tx.ExecContext(ctx, `
			INSERT INTO phases (id, saga_id, tracker_id, number, name, status, confidence)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			p.ID, p.SagaID, p.TrackerID, p.Number, p.Name, string(p.Status), p.Confidence,
		)
		if err != nil {
			return fmt.Errorf("insert phase %s: %w", p.Name, err)
		}
	}

	for i := range raids {
		r := &raids[i]
		_, err = tx.ExecContext(ctx, `
			INSERT INTO raids (id, phase_id, tracker_id, name, description, acceptance_criteria, declared_files,
				estimate_hours, status, confidence, retry_count, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			r.ID, r.PhaseID, r.TrackerID, r.Name, r.Description,
			pq.Array(r.AcceptanceCriteria), pq.Array(r.DeclaredFiles),
			r.EstimateHours, string(r.Status), r.Confidence,
			r.RetryCount, r.CreatedAt, r.UpdatedAt,
		)
		if err != nil {
			return fmt.Errorf("insert raid %s: %w", r.Name, err)
		}
	}

	return tx.Commit()
}

// ListSagas returns all sagas for the given owner.
func (s *Store) ListSagas(ctx context.Context, ownerID string) ([]Saga, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id,
			COALESCE(base_branch, 'main'), created_at
		FROM sagas
		WHERE owner_id = $1
		ORDER BY created_at DESC`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("query sagas: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var sagas []Saga
	for rows.Next() {
		var s Saga
		if err := rows.Scan(&s.ID, &s.TrackerID, &s.TrackerType, &s.Slug, &s.Name,
			pq.Array(&s.Repos), &s.Status, &s.Confidence, &s.OwnerID,
			&s.BaseBranch, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan saga: %w", err)
		}
		sagas = append(sagas, s)
	}
	return sagas, rows.Err()
}

// GetSaga returns a single saga by ID, scoped to the owner.
func (s *Store) GetSaga(ctx context.Context, sagaID, ownerID string) (*Saga, error) {
	var saga Saga
	err := s.db.QueryRowContext(ctx, `
		SELECT id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id,
			COALESCE(base_branch, 'main'), created_at
		FROM sagas
		WHERE id = $1 AND owner_id = $2`, sagaID, ownerID).
		Scan(&saga.ID, &saga.TrackerID, &saga.TrackerType, &saga.Slug, &saga.Name,
			pq.Array(&saga.Repos), &saga.Status, &saga.Confidence, &saga.OwnerID,
			&saga.BaseBranch, &saga.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query saga %s: %w", sagaID, err)
	}

	saga.FeatureBranch = "feat/" + saga.Slug
	return &saga, nil
}

// GetSagaBySlug returns a saga by slug (any owner).
func (s *Store) GetSagaBySlug(ctx context.Context, slug string) (*Saga, error) {
	var saga Saga
	err := s.db.QueryRowContext(ctx, `
		SELECT id, tracker_id, tracker_type, slug, name, repos, status, confidence, owner_id,
			COALESCE(base_branch, 'main'), created_at
		FROM sagas WHERE slug = $1`, slug).
		Scan(&saga.ID, &saga.TrackerID, &saga.TrackerType, &saga.Slug, &saga.Name,
			pq.Array(&saga.Repos), &saga.Status, &saga.Confidence, &saga.OwnerID,
			&saga.BaseBranch, &saga.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query saga by slug %s: %w", slug, err)
	}
	return &saga, nil
}

// DeleteSaga removes a saga and all its phases/raids (cascading via FK).
func (s *Store) DeleteSaga(ctx context.Context, sagaID, ownerID string) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Delete confidence events first (references raids which reference phases).
	_, err = tx.ExecContext(ctx, `
		DELETE FROM confidence_events WHERE raid_id IN (
			SELECT r.id FROM raids r JOIN phases p ON r.phase_id = p.id WHERE p.saga_id = $1
		)`, sagaID)
	if err != nil {
		return false, fmt.Errorf("delete confidence events: %w", err)
	}

	// Delete raids for all phases of this saga.
	_, err = tx.ExecContext(ctx, `
		DELETE FROM raids WHERE phase_id IN (SELECT id FROM phases WHERE saga_id = $1)`, sagaID)
	if err != nil {
		return false, fmt.Errorf("delete raids: %w", err)
	}

	// Delete phases.
	_, err = tx.ExecContext(ctx, `DELETE FROM phases WHERE saga_id = $1`, sagaID)
	if err != nil {
		return false, fmt.Errorf("delete phases: %w", err)
	}

	result, err := tx.ExecContext(ctx, `DELETE FROM sagas WHERE id = $1 AND owner_id = $2`, sagaID, ownerID)
	if err != nil {
		return false, fmt.Errorf("delete saga: %w", err)
	}

	rows, _ := result.RowsAffected()
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit: %w", err)
	}
	return rows > 0, nil
}

// Phase operations.

// ListPhases returns all phases for a saga, ordered by number.
func (s *Store) ListPhases(ctx context.Context, sagaID string) ([]Phase, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, saga_id, tracker_id, number, name, status, confidence
		FROM phases WHERE saga_id = $1 ORDER BY number`, sagaID)
	if err != nil {
		return nil, fmt.Errorf("query phases: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var phases []Phase
	for rows.Next() {
		var p Phase
		if err := rows.Scan(&p.ID, &p.SagaID, &p.TrackerID, &p.Number, &p.Name, &p.Status, &p.Confidence); err != nil {
			return nil, fmt.Errorf("scan phase: %w", err)
		}
		phases = append(phases, p)
	}
	return phases, rows.Err()
}

// Raid operations.

// ListRaids returns all raids for a phase.
func (s *Store) ListRaids(ctx context.Context, phaseID string) ([]Raid, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, phase_id, tracker_id, name, COALESCE(description, ''),
			COALESCE(acceptance_criteria, '{}'), COALESCE(declared_files, '{}'),
			estimate_hours, status, confidence, session_id, branch,
			chronicle_summary, pr_url, pr_id, reason, retry_count,
			COALESCE(reviewer_session_id, ''), COALESCE(review_round, 0),
			created_at, updated_at
		FROM raids WHERE phase_id = $1 ORDER BY created_at`, phaseID)
	if err != nil {
		return nil, fmt.Errorf("query raids: %w", err)
	}
	defer func() { _ = rows.Close() }()

	return scanRaids(rows)
}

// GetRaid returns a single raid by ID.
func (s *Store) GetRaid(ctx context.Context, raidID string) (*Raid, error) {
	var r Raid
	var reviewerSID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, phase_id, tracker_id, name, COALESCE(description, ''),
			COALESCE(acceptance_criteria, '{}'), COALESCE(declared_files, '{}'),
			estimate_hours, status, confidence, session_id, branch,
			chronicle_summary, pr_url, pr_id, reason, retry_count,
			COALESCE(reviewer_session_id, ''), COALESCE(review_round, 0),
			created_at, updated_at
		FROM raids WHERE id = $1`, raidID).
		Scan(&r.ID, &r.PhaseID, &r.TrackerID, &r.Name, &r.Description,
			pq.Array(&r.AcceptanceCriteria), pq.Array(&r.DeclaredFiles),
			&r.EstimateHours, &r.Status, &r.Confidence, &r.SessionID, &r.Branch,
			&r.ChronicleSummary, &r.PRUrl, &r.PRID, &r.Reason, &r.RetryCount,
			&reviewerSID, &r.ReviewRound,
			&r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query raid %s: %w", raidID, err)
	}
	if reviewerSID != "" {
		r.ReviewerSessionID = &reviewerSID
	}
	return &r, nil
}

// UpdateRaidStatus transitions a raid to a new status, enforcing the state machine.
func (s *Store) UpdateRaidStatus(ctx context.Context, raidID string, status RaidStatus, reason *string) error {
	raid, err := s.GetRaid(ctx, raidID)
	if err != nil {
		return err
	}
	if raid == nil {
		return fmt.Errorf("raid %s not found", raidID)
	}

	if err := ValidateTransition(raid.Status, status); err != nil {
		return err
	}

	now := time.Now().UTC()
	retryIncrement := 0
	if status == RaidStatusQueued && (raid.Status == RaidStatusFailed || raid.Status == RaidStatusReview) {
		retryIncrement = 1
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE raids SET status = $1, reason = $2, retry_count = retry_count + $3, updated_at = $4
		WHERE id = $5`,
		string(status), reason, retryIncrement, now, raidID)
	if err != nil {
		return fmt.Errorf("update raid status: %w", err)
	}
	return nil
}

// UpdateRaidSession sets the session_id and branch for a raid.
func (s *Store) UpdateRaidSession(ctx context.Context, raidID, sessionID, branch string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE raids SET session_id = $1, branch = $2, updated_at = $3
		WHERE id = $4`,
		sessionID, branch, time.Now().UTC(), raidID)
	if err != nil {
		return fmt.Errorf("update raid session: %w", err)
	}
	return nil
}

// CountByStatus returns a count of raids grouped by status.
func (s *Store) CountByStatus(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM raids GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("count by status: %w", err)
	}
	defer func() { _ = rows.Close() }()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, fmt.Errorf("scan count: %w", err)
		}
		counts[status] = count
	}
	return counts, rows.Err()
}

// ListActiveRaids returns all raids that are not in a terminal state.
func (s *Store) ListActiveRaids(ctx context.Context) ([]Raid, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, phase_id, tracker_id, name, COALESCE(description, ''),
			COALESCE(acceptance_criteria, '{}'), COALESCE(declared_files, '{}'),
			estimate_hours, status, confidence, session_id, branch,
			chronicle_summary, pr_url, pr_id, reason, retry_count,
			COALESCE(reviewer_session_id, ''), COALESCE(review_round, 0),
			created_at, updated_at
		FROM raids WHERE status NOT IN ('MERGED', 'FAILED')
		ORDER BY updated_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("query active raids: %w", err)
	}
	defer func() { _ = rows.Close() }()

	return scanRaids(rows)
}

// GetSagaForRaid returns the saga that contains the given raid.
func (s *Store) GetSagaForRaid(ctx context.Context, raidID string) (*Saga, error) {
	var saga Saga
	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.tracker_id, s.tracker_type, s.slug, s.name, s.repos, s.status,
			s.confidence, s.owner_id, COALESCE(s.base_branch, 'main'), s.created_at
		FROM sagas s
		JOIN phases p ON p.saga_id = s.id
		JOIN raids r ON r.phase_id = p.id
		WHERE r.id = $1`, raidID).
		Scan(&saga.ID, &saga.TrackerID, &saga.TrackerType, &saga.Slug, &saga.Name,
			pq.Array(&saga.Repos), &saga.Status, &saga.Confidence, &saga.OwnerID,
			&saga.BaseBranch, &saga.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query saga for raid: %w", err)
	}
	saga.FeatureBranch = "feat/" + saga.Slug
	return &saga, nil
}

// Confidence events.

// AddConfidenceEvent records a confidence change and updates the raid score.
func (s *Store) AddConfidenceEvent(ctx context.Context, raidID, eventType string, delta float64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Get current confidence.
	var current float64
	if err := tx.QueryRowContext(ctx, `SELECT confidence FROM raids WHERE id = $1`, raidID).Scan(&current); err != nil {
		return fmt.Errorf("get raid confidence: %w", err)
	}

	newScore := current + delta
	if newScore < 0 {
		newScore = 0
	}
	if newScore > 1 {
		newScore = 1
	}

	eventID := uuid.New().String()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO confidence_events (id, raid_id, event_type, delta, score_after)
		VALUES ($1, $2, $3, $4, $5)`,
		eventID, raidID, eventType, delta, newScore)
	if err != nil {
		return fmt.Errorf("insert confidence event: %w", err)
	}

	_, err = tx.ExecContext(ctx, `UPDATE raids SET confidence = $1, updated_at = $2 WHERE id = $3`,
		newScore, time.Now().UTC(), raidID)
	if err != nil {
		return fmt.Errorf("update raid confidence: %w", err)
	}

	return tx.Commit()
}

// SagaCounts holds phase and raid counts for a saga.
type SagaCounts struct {
	SagaID     string
	PhaseCount int
	RaidCount  int
}

// CountPhasesAndRaidsBySaga returns phase/raid counts for all sagas owned by ownerID in a single query.
func (s *Store) CountPhasesAndRaidsBySaga(ctx context.Context, ownerID string) (map[string]SagaCounts, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, COUNT(DISTINCT p.id) AS phase_count, COUNT(DISTINCT r.id) AS raid_count
		FROM sagas s
		LEFT JOIN phases p ON p.saga_id = s.id
		LEFT JOIN raids r ON r.phase_id = p.id
		WHERE s.owner_id = $1
		GROUP BY s.id`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("count phases and raids: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]SagaCounts)
	for rows.Next() {
		var c SagaCounts
		if err := rows.Scan(&c.SagaID, &c.PhaseCount, &c.RaidCount); err != nil {
			return nil, fmt.Errorf("scan counts: %w", err)
		}
		result[c.SagaID] = c
	}
	return result, rows.Err()
}

// DispatchQueueItem holds the joined data for the dispatch queue.
type DispatchQueueItem struct {
	SagaID        string
	SagaName      string
	SagaSlug      string
	Repos         []string
	FeatureBranch string
	PhaseName     string
	RaidTrackerID string
	RaidName      string
	RaidDesc      string
	RaidStatus    string
}

// ListDispatchQueue returns all PENDING raids joined with their saga/phase in a single query.
func (s *Store) ListDispatchQueue(ctx context.Context, ownerID string) ([]DispatchQueueItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.id, s.name, s.slug, s.repos, 'feat/' || LOWER(s.slug),
			p.name, r.tracker_id, r.name, COALESCE(r.description, ''), r.status
		FROM raids r
		JOIN phases p ON r.phase_id = p.id
		JOIN sagas s ON p.saga_id = s.id
		WHERE s.owner_id = $1 AND r.status = $2
		ORDER BY s.created_at, p.number, r.created_at`,
		ownerID, string(RaidStatusPending))
	if err != nil {
		return nil, fmt.Errorf("query dispatch queue: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var items []DispatchQueueItem
	for rows.Next() {
		var item DispatchQueueItem
		if err := rows.Scan(&item.SagaID, &item.SagaName, &item.SagaSlug,
			pq.Array(&item.Repos), &item.FeatureBranch,
			&item.PhaseName, &item.RaidTrackerID, &item.RaidName,
			&item.RaidDesc, &item.RaidStatus); err != nil {
			return nil, fmt.Errorf("scan dispatch queue item: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Helpers.

func scanRaids(rows *sql.Rows) ([]Raid, error) {
	var raids []Raid
	for rows.Next() {
		var r Raid
		var reviewerSID string
		if err := rows.Scan(&r.ID, &r.PhaseID, &r.TrackerID, &r.Name, &r.Description,
			pq.Array(&r.AcceptanceCriteria), pq.Array(&r.DeclaredFiles),
			&r.EstimateHours, &r.Status, &r.Confidence, &r.SessionID, &r.Branch,
			&r.ChronicleSummary, &r.PRUrl, &r.PRID, &r.Reason, &r.RetryCount,
			&reviewerSID, &r.ReviewRound,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan raid: %w", err)
		}
		if reviewerSID != "" {
			r.ReviewerSessionID = &reviewerSID
		}
		raids = append(raids, r)
	}
	return raids, rows.Err()
}

// GenerateID returns a new UUID string.
func GenerateID() string {
	return uuid.New().String()
}

// slugToFeatureBranch converts a saga slug to its feature branch name.
func slugToFeatureBranch(slug string) string {
	return "feat/" + strings.ToLower(slug)
}
