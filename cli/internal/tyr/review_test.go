package tyr

import (
	"database/sql"
	"database/sql/driver"
	"strings"
	"sync"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

// --- Mock SessionSpawner ---

type mockSpawner struct {
	mu                     sync.Mutex
	spawnCalls             int
	sendMessageCalls       []sendMessageCall
	lastAssistantMessage   string
	lastAssistantMessageErr error
	stopCalls              []string
	spawnedSessionID       string
	spawnErr               error
}

type sendMessageCall struct {
	sessionID string
	content   string
}

func newMockSpawner() *mockSpawner {
	return &mockSpawner{spawnedSessionID: "reviewer-sess-1"}
}

func (m *mockSpawner) SpawnReviewerSession(_ *Raid, _ *Saga, _, _, _ string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spawnCalls++
	return m.spawnedSessionID, m.spawnErr
}

func (m *mockSpawner) SendMessage(sessionID, content string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sendMessageCalls = append(m.sendMessageCalls, sendMessageCall{sessionID, content})
	return nil
}

func (m *mockSpawner) GetLastAssistantMessage(_ string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastAssistantMessage, m.lastAssistantMessageErr
}

func (m *mockSpawner) StopSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopCalls = append(m.stopCalls, sessionID)
	return nil
}

// --- Helpers ---

var sagaColumns = []string{
	"id", "tracker_id", "tracker_type", "slug", "name", "repos",
	"status", "confidence", "owner_id", "base_branch", "created_at",
}

var phaseColumns = []string{
	"id", "saga_id", "tracker_id", "number", "name", "status", "confidence",
}

func setupReviewEngine(t *testing.T, prChecker PRChecker, spawner SessionSpawner) (*ReviewEngine, *Store, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	store := NewStore(db)
	trk := newMockTracker()
	if prChecker == nil {
		prChecker = &mockPRChecker{}
	}

	re := NewReviewEngine(store, prChecker, trk, spawner, ReviewEngineConfig{
		AutoApproveThreshold: 0.80,
		MaxReviewRounds:      3,
		ReviewerModel:        "test-model",
	}, "http://localhost:3000")
	re.eventLog = NewEventLog(100)

	return re, store, mock
}

func expectGetRaid(mock sqlmock.Sqlmock, raidID string, row []driver.Value) {
	q := mock.ExpectQuery("SELECT .+ FROM raids WHERE id")
	if row == nil {
		q.WithArgs(raidID).WillReturnRows(sqlmock.NewRows(nil))
	} else {
		q.WithArgs(raidID).WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	}
}

func expectSagaForRaid(mock sqlmock.Sqlmock, raidID string, row []driver.Value) {
	q := mock.ExpectQuery("SELECT s\\..+ FROM sagas s")
	if row == nil {
		q.WithArgs(raidID).WillReturnRows(sqlmock.NewRows(nil))
	} else {
		q.WithArgs(raidID).WillReturnRows(sqlmock.NewRows(sagaColumns).AddRow(row...))
	}
}

func newSagaRow() []driver.Value {
	return []driver.Value{
		"saga-1", "t-1", "native", "test-project", "Test Project",
		pq.Array([]string{"repo1"}), "ACTIVE", 0.75, "owner-1", "main", time.Now(),
	}
}

// --- Tests: evaluate ---

func TestReviewEngine_Evaluate_NoReviewerSession_SpawnsReviewer(t *testing.T) {
	spawner := newMockSpawner()
	re, _, mock := setupReviewEngine(t, nil, spawner)

	// GetRaid returns raid without reviewer session.
	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	// GetSagaForRaid.
	expectSagaForRaid(mock, "raid-1", newSagaRow())

	// UpdateRaidReviewer.
	mock.ExpectExec("UPDATE raids SET reviewer_session_id").WillReturnResult(sqlmock.NewResult(0, 1))

	re.evaluate("raid-1")

	spawner.mu.Lock()
	if spawner.spawnCalls != 1 {
		t.Errorf("expected 1 spawn call, got %d", spawner.spawnCalls)
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_Evaluate_HasReviewerSession_HandlesCompletion(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 1.0, "approved": true, "summary": "LGTM", "findings": []}`
	re, _, mock := setupReviewEngine(t, nil, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	expectGetRaid(mock, "raid-1", row)

	// autoApprove path: AddConfidenceEvent + UpdateRaidStatus.
	// AddConfidenceEvent: begin + SELECT + INSERT + UPDATE + commit.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// autoApprove: second confidence event.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.85))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// UpdateRaidStatus for MERGED.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate: GetPhaseForRaid.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(nil))

	re.evaluate("raid-1")

	spawner.mu.Lock()
	if len(spawner.stopCalls) != 1 {
		t.Errorf("expected reviewer session stopped, got %d stop calls", len(spawner.stopCalls))
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_HandleReviewerCompletion_MaxRounds_Escalate(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 0.5, "approved": false, "summary": "issues", "findings": ["bug"]}`
	re, _, mock := setupReviewEngine(t, nil, spawner)
	re.cfg.MaxReviewRounds = 3 // Set max rounds to match the test data.

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	// review_round at index 20.
	row[20] = 3 // review_round = max

	expectGetRaid(mock, "raid-1", row)

	// AddConfidenceEvent.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// UpdateRaidStatus for ESCALATED.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	re.evaluate("raid-1")

	spawner.mu.Lock()
	if len(spawner.stopCalls) != 1 {
		t.Errorf("expected reviewer session stopped on escalation, got %d", len(spawner.stopCalls))
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_HandleReviewerCompletion_Findings_SendFeedback(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 0.7, "approved": false, "summary": "needs fixes", "findings": ["file.go:10 — [bug] missing nil check"]}`
	re, _, mock := setupReviewEngine(t, nil, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	row[20] = 1 // review_round = 1 (below max)
	expectGetRaid(mock, "raid-1", row)

	// AddConfidenceEvent.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	re.evaluate("raid-1")

	spawner.mu.Lock()
	if len(spawner.sendMessageCalls) != 1 {
		t.Errorf("expected 1 send message call, got %d", len(spawner.sendMessageCalls))
	} else {
		msg := spawner.sendMessageCalls[0]
		if msg.sessionID != "session-1" {
			t.Errorf("expected message to working session 'session-1', got %q", msg.sessionID)
		}
		if !strings.Contains(msg.content, "missing nil check") {
			t.Error("expected feedback to contain the finding")
		}
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_HandleReviewerCompletion_NoOutput_AutoDecide(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = ""
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	expectGetRaid(mock, "raid-1", row)

	// autoDecide → autoApprove path.
	// AddConfidenceEvent.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// UpdateRaidStatus MERGED.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(nil))

	re.evaluate("raid-1")
}

func TestReviewEngine_AutoDecide_PRExistsAndCIPasses_Merged(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil) // no spawner

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	// autoApprove: AddConfidenceEvent.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// UpdateRaidStatus MERGED.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(nil))

	re.evaluate("raid-1")
}

func TestReviewEngine_AutoDecide_NoPR_StaysInReview(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{}, // No URL.
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil) // no spawner

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	re.evaluate("raid-1")

	// No UpdateRaidStatus call — stays in REVIEW.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_AutoDecide_NoSessionID_Returns(t *testing.T) {
	re, _, mock := setupReviewEngine(t, nil, nil)

	// Raid with no session_id.
	row := newRaidRow("raid-1", "REVIEW", "", "")
	expectGetRaid(mock, "raid-1", row)

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_CheckPhaseGate_AllMerged_UnlocksNext(t *testing.T) {
	re, _, mock := setupReviewEngine(t, nil, nil)

	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re.pr = prChecker

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	// autoApprove path.
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate: GetPhaseForRaid returns phase.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-1", "saga-1", "p-t-1", 1, "Phase 1", "ACTIVE", 0.75))

	// AllRaidsMerged returns true.
	mock.ExpectQuery("SELECT COUNT").
		WithArgs("phase-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	// GetSagaForRaid.
	expectSagaForRaid(mock, "raid-1", newSagaRow())

	// GetNextPhase returns gated phase.
	mock.ExpectQuery("SELECT .+ FROM phases WHERE saga_id").
		WithArgs("saga-1", 2).
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-2", "saga-1", "p-t-2", 2, "Phase 2", "GATED", 0.5))

	// UpdatePhaseStatus.
	mock.ExpectExec("UPDATE phases SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_Evaluate_RaidNotFound(t *testing.T) {
	re, _, mock := setupReviewEngine(t, nil, nil)

	expectGetRaid(mock, "missing", nil)

	// Should not panic.
	re.evaluate("missing")
}

// --- Tests: parseReviewerResponse ---

func TestParseReviewerResponse_ValidJSON(t *testing.T) {
	input := `{"confidence": 0.95, "approved": true, "summary": "Looks good", "findings": []}`
	result := parseReviewerResponse(input)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Confidence != 0.95 {
		t.Errorf("expected confidence 0.95, got %f", result.Confidence)
	}
	if !result.Approved {
		t.Error("expected approved=true")
	}
	if result.Summary != "Looks good" {
		t.Errorf("expected summary 'Looks good', got %q", result.Summary)
	}
	if len(result.Findings) != 0 {
		t.Errorf("expected 0 findings, got %d", len(result.Findings))
	}
}

func TestParseReviewerResponse_JSONInCodeFence(t *testing.T) {
	input := "Here is my review:\n\n```json\n{\"confidence\": 0.8, \"approved\": false, \"summary\": \"Needs work\", \"findings\": [\"file.go:1 — [bug] issue\"]}\n```\n\nThanks!"
	result := parseReviewerResponse(input)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Confidence != 0.8 {
		t.Errorf("expected confidence 0.8, got %f", result.Confidence)
	}
	if len(result.Findings) != 1 {
		t.Errorf("expected 1 finding, got %d", len(result.Findings))
	}
}

func TestParseReviewerResponse_PlainCodeFence(t *testing.T) {
	input := "```\n{\"confidence\": 0.9, \"approved\": true, \"summary\": \"OK\", \"findings\": []}\n```"
	result := parseReviewerResponse(input)
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Confidence != 0.9 {
		t.Errorf("expected confidence 0.9, got %f", result.Confidence)
	}
}

func TestParseReviewerResponse_InvalidJSON_ReturnsNil(t *testing.T) {
	result := parseReviewerResponse("this is not json at all")
	if result != nil {
		t.Error("expected nil for invalid JSON")
	}
}

func TestParseReviewerResponse_EmptyStructuredResponse_ReturnsNil(t *testing.T) {
	// JSON parses but has no meaningful content.
	result := parseReviewerResponse(`{"confidence": 0, "summary": ""}`)
	if result != nil {
		t.Error("expected nil for empty structured response")
	}
}

// --- Tests: buildReviewerPrompt ---

func TestBuildReviewerPrompt_WithWorkingSession(t *testing.T) {
	raid := &Raid{
		Identifier:  "TYR-42",
		Name:        "Test raid",
		Description: "A test description",
	}
	prURL := "https://github.com/pr/1"
	raid.PRUrl = &prURL

	prompt := buildReviewerPrompt(raid, "working-sess-1", 6, "http://localhost:3000")

	if !strings.Contains(prompt, "TYR-42") {
		t.Error("expected prompt to contain ticket identifier")
	}
	if !strings.Contains(prompt, "Test raid") {
		t.Error("expected prompt to contain raid name")
	}
	if !strings.Contains(prompt, "A test description") {
		t.Error("expected prompt to contain description")
	}
	if !strings.Contains(prompt, "https://github.com/pr/1") {
		t.Error("expected prompt to contain PR URL")
	}
	if !strings.Contains(prompt, "working-sess-1") {
		t.Error("expected prompt to contain working session ID")
	}
	if !strings.Contains(prompt, "Review Loop") {
		t.Error("expected prompt to contain Review Loop section")
	}
	if !strings.Contains(prompt, "localhost:3000") {
		t.Error("expected prompt to contain forge URL")
	}
}

func TestBuildReviewerPrompt_WithoutWorkingSession(t *testing.T) {
	raid := &Raid{
		Identifier: "TYR-43",
		Name:       "Solo raid",
	}

	prompt := buildReviewerPrompt(raid, "", 3, "http://localhost:3000")

	if !strings.Contains(prompt, "TYR-43") {
		t.Error("expected prompt to contain ticket identifier")
	}
	if strings.Contains(prompt, "Review Loop") {
		t.Error("expected prompt to NOT contain Review Loop section without working session")
	}
}

func TestBuildReviewerPrompt_LongDescription_Truncated(t *testing.T) {
	raid := &Raid{
		Identifier:  "TYR-44",
		Name:        "Long desc",
		Description: strings.Repeat("a", 600),
	}

	prompt := buildReviewerPrompt(raid, "", 3, "")

	if !strings.Contains(prompt, "...") {
		t.Error("expected long description to be truncated with ...")
	}
}

// --- Tests: buildReviewFeedback ---

func TestBuildReviewFeedback(t *testing.T) {
	result := &ReviewerResult{
		Findings: []string{
			"file.go:10 — [bug] missing error check",
			"main.go:5 — [quality] unused import",
		},
	}

	feedback := buildReviewFeedback(result)

	if !strings.Contains(feedback, "Review Feedback") {
		t.Error("expected feedback header")
	}
	if !strings.Contains(feedback, "missing error check") {
		t.Error("expected first finding in feedback")
	}
	if !strings.Contains(feedback, "unused import") {
		t.Error("expected second finding in feedback")
	}
	if !strings.Contains(feedback, "git push") {
		t.Error("expected push instruction in feedback")
	}
}

// --- Tests: NewReviewEngine defaults ---

func TestNewReviewEngine_Defaults(t *testing.T) {
	db, _, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	re := NewReviewEngine(store, &mockPRChecker{}, nil, nil, ReviewEngineConfig{}, "")

	if re.cfg.AutoApproveThreshold != 0.80 {
		t.Errorf("expected default threshold 0.80, got %f", re.cfg.AutoApproveThreshold)
	}
	if re.cfg.MaxReviewRounds != 6 {
		t.Errorf("expected default max rounds 6, got %d", re.cfg.MaxReviewRounds)
	}
	if re.cfg.ReviewerModel != "claude-sonnet-4-6" {
		t.Errorf("expected default model claude-sonnet-4-6, got %q", re.cfg.ReviewerModel)
	}
	if re.cfg.ReviewerSystemPrompt == "" {
		t.Error("expected default system prompt to be set")
	}
}

func TestReviewEngine_Start_RegistersCallback(t *testing.T) {
	db, _, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	events := newMockEventSource()
	sub := NewActivitySubscriber(store, events, &mockPRChecker{}, nil, SubscriberConfig{})
	re := NewReviewEngine(store, &mockPRChecker{}, nil, nil, ReviewEngineConfig{}, "")

	re.Start(sub)

	if !re.IsRunning() {
		t.Error("expected review engine to be running after Start()")
	}
	if len(sub.onReview) != 1 {
		t.Errorf("expected 1 onReview callback, got %d", len(sub.onReview))
	}
}

func TestReviewEngine_SpawnReviewer_SagaNotFound_FallsBackToAutoDecide(t *testing.T) {
	spawner := newMockSpawner()
	prChecker := &mockPRChecker{
		result: PRCheckResult{}, // No PR.
	}
	re, _, mock := setupReviewEngine(t, prChecker, spawner)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	// GetSagaForRaid returns nil.
	expectSagaForRaid(mock, "raid-1", nil)

	// autoDecide: no PR, no action.
	re.evaluate("raid-1")

	spawner.mu.Lock()
	if spawner.spawnCalls != 0 {
		t.Errorf("expected 0 spawn calls when saga not found, got %d", spawner.spawnCalls)
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_SpawnReviewer_SpawnError_FallsBackToAutoDecide(t *testing.T) {
	spawner := newMockSpawner()
	spawner.spawnErr = sql.ErrConnDone
	prChecker := &mockPRChecker{
		result: PRCheckResult{}, // No PR.
	}
	re, _, mock := setupReviewEngine(t, prChecker, spawner)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	expectSagaForRaid(mock, "raid-1", newSagaRow())

	// autoDecide fallback: no PR, stays in REVIEW.
	re.evaluate("raid-1")

	spawner.mu.Lock()
	if spawner.spawnCalls != 1 {
		t.Errorf("expected 1 spawn call (failed), got %d", spawner.spawnCalls)
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_HandleReviewerCompletion_ParseError_AutoDecide(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = "not valid json output"
	prChecker := &mockPRChecker{
		result: PRCheckResult{}, // No PR.
	}
	re, _, mock := setupReviewEngine(t, prChecker, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	expectGetRaid(mock, "raid-1", row)

	// autoDecide: no PR, no merge.
	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_HandleReviewerCompletion_FetchError(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessageErr = sql.ErrConnDone
	re, _, mock := setupReviewEngine(t, nil, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	expectGetRaid(mock, "raid-1", row)

	// Should log and return without doing anything.
	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_AutoApprove_NilEventLog(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)
	re.eventLog = nil // explicitly nil

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(nil))

	// Should not panic with nil eventLog.
	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_AutoApprove_WithTracker(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 1.0, "approved": true, "summary": "LGTM", "findings": []}`
	re, _, mock := setupReviewEngine(t, nil, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	row[2] = "TRACKER-1" // tracker_id
	expectGetRaid(mock, "raid-1", row)

	// AddConfidenceEvent (reviewer_score).
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// AddConfidenceEvent (auto_approved).
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.85))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// UpdateRaidStatus MERGED.
	modifiedRow := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	modifiedRow[2] = "TRACKER-1"
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(modifiedRow...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(nil))

	re.evaluate("raid-1")

	// Verify tracker was called with "Done".
	trk := re.tracker.(*mockTracker)
	trk.mu.Lock()
	if len(trk.updateStateCalls) != 1 {
		t.Errorf("expected 1 tracker UpdateIssueState call, got %d", len(trk.updateStateCalls))
	} else if trk.updateStateCalls[0].arg != "Done" {
		t.Errorf("expected 'Done', got %q", trk.updateStateCalls[0].arg)
	}
	trk.mu.Unlock()
}

func TestReviewEngine_Escalate_WithTracker(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 0.3, "approved": false, "summary": "bad", "findings": ["bug"]}`
	re, _, mock := setupReviewEngine(t, nil, spawner)

	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "session-1", reviewerSID)
	row[2] = "TRACKER-1"
	row[20] = 3 // review_round >= maxReviewRounds
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	re.evaluate("raid-1")

	trk := re.tracker.(*mockTracker)
	trk.mu.Lock()
	if len(trk.addCommentCalls) != 1 {
		t.Errorf("expected 1 AddComment call, got %d", len(trk.addCommentCalls))
	}
	trk.mu.Unlock()
}

func TestReviewEngine_CheckPhaseGate_NotAllMerged(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// checkPhaseGate: phase found but not all merged.
	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-1", "saga-1", "p-t-1", 1, "Phase 1", "ACTIVE", 0.75))

	// AllRaidsMerged returns false (1 remaining).
	mock.ExpectQuery("SELECT COUNT").
		WithArgs("phase-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_CheckPhaseGate_NextPhaseNotGated(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-1", "saga-1", "p-t-1", 1, "Phase 1", "ACTIVE", 0.75))

	mock.ExpectQuery("SELECT COUNT").
		WithArgs("phase-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	expectSagaForRaid(mock, "raid-1", newSagaRow())

	// Next phase is ACTIVE, not GATED.
	mock.ExpectQuery("SELECT .+ FROM phases WHERE saga_id").
		WithArgs("saga-1", 2).
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-2", "saga-1", "p-t-2", 2, "Phase 2", "ACTIVE", 0.5))

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_CheckPhaseGate_NoNextPhase(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(newRaidRow("raid-1", "REVIEW", "session-1", "")...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("SELECT p\\..+ FROM phases p").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(phaseColumns).AddRow("phase-1", "saga-1", "p-t-1", 1, "Phase 1", "ACTIVE", 0.75))

	mock.ExpectQuery("SELECT COUNT").
		WithArgs("phase-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	expectSagaForRaid(mock, "raid-1", newSagaRow())

	// No next phase.
	mock.ExpectQuery("SELECT .+ FROM phases WHERE saga_id").
		WithArgs("saga-1", 2).
		WillReturnRows(sqlmock.NewRows(nil))

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_HandleReviewerCompletion_Findings_NoWorkingSession(t *testing.T) {
	spawner := newMockSpawner()
	spawner.lastAssistantMessage = `{"confidence": 0.7, "approved": false, "summary": "issues", "findings": ["file.go:1 — [bug] err"]}`
	re, _, mock := setupReviewEngine(t, nil, spawner)

	// Raid with reviewer session but NO working session.
	reviewerSID := "reviewer-1234abcd"
	row := newRaidRow("raid-1", "REVIEW", "", reviewerSID)
	row[20] = 1
	expectGetRaid(mock, "raid-1", row)

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT confidence FROM raids").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows([]string{"confidence"}).AddRow(0.75))
	mock.ExpectExec("INSERT INTO confidence_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE raids SET confidence").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	re.evaluate("raid-1")

	// No SendMessage should be called (no working session).
	spawner.mu.Lock()
	if len(spawner.sendMessageCalls) != 0 {
		t.Errorf("expected 0 send message calls without working session, got %d", len(spawner.sendMessageCalls))
	}
	spawner.mu.Unlock()
}

func TestReviewEngine_AutoDecide_CINotPassed(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: false, Mergeable: true},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	re.evaluate("raid-1")

	// Should stay in REVIEW, not merge.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_AutoDecide_NotMergeable(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", CIPassed: true, Mergeable: false},
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestReviewEngine_AutoDecide_PRCheckError(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{},
		err:    sql.ErrConnDone,
	}
	re, _, mock := setupReviewEngine(t, prChecker, nil)

	row := newRaidRow("raid-1", "REVIEW", "session-1", "")
	expectGetRaid(mock, "raid-1", row)

	// Should not panic, just log.
	re.evaluate("raid-1")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
