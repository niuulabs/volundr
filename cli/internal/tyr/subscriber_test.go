package tyr

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// --- Mock implementations ---

type mockEventSource struct {
	mu   sync.Mutex
	ch   chan SessionEvent
	subs map[string]bool
}

func newMockEventSource() *mockEventSource {
	return &mockEventSource{
		ch:   make(chan SessionEvent, 64),
		subs: make(map[string]bool),
	}
}

func (m *mockEventSource) Subscribe() (string, <-chan SessionEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := "sub-1"
	m.subs[id] = true
	return id, m.ch
}

func (m *mockEventSource) Unsubscribe(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.subs, id)
}

func (m *mockEventSource) Send(evt SessionEvent) {
	m.ch <- evt
}

type mockPRChecker struct {
	result PRCheckResult
	err    error
}

func (m *mockPRChecker) GetPRStatus(_ string) (PRCheckResult, error) {
	return m.result, m.err
}

type mockTracker struct {
	updateStateCalls []trackerCall
	addCommentCalls  []trackerCall
	mu               sync.Mutex
}

type trackerCall struct {
	issueID string
	arg     string
}

func newMockTracker() *mockTracker {
	return &mockTracker{}
}

func (m *mockTracker) UpdateIssueState(issueID, stateName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updateStateCalls = append(m.updateStateCalls, trackerCall{issueID, stateName})
	return nil
}

func (m *mockTracker) AddComment(issueID, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.addCommentCalls = append(m.addCommentCalls, trackerCall{issueID, body})
	return nil
}

// Stub methods to satisfy the tracker.Tracker interface.
func (m *mockTracker) ListProjects() ([]tracker.Project, error) { return nil, nil }
func (m *mockTracker) GetProject(string) (*tracker.Project, error) {
	return nil, nil
}
func (m *mockTracker) GetProjectFull(string) (*tracker.Project, []tracker.Milestone, []tracker.Issue, error) {
	return nil, nil, nil, nil
}
func (m *mockTracker) ListMilestones(string) ([]tracker.Milestone, error) { return nil, nil }
func (m *mockTracker) ListIssues(string, *string) ([]tracker.Issue, error) {
	return nil, nil
}
func (m *mockTracker) CreateProject(string, string) (string, error) { return "", nil }
func (m *mockTracker) CreateMilestone(string, string, float64) (string, error) {
	return "", nil
}
func (m *mockTracker) CreateIssue(string, string, string, *string, *int) (string, error) {
	return "", nil
}
func (m *mockTracker) Close() error { return nil }

// --- Helpers ---

var raidColumns = []string{
	"id", "phase_id", "tracker_id", "identifier", "url",
	"name", "description", "acceptance_criteria", "declared_files",
	"estimate_hours", "status", "confidence", "session_id", "branch",
	"chronicle_summary", "pr_url", "pr_id", "reason", "retry_count",
	"reviewer_session_id", "review_round", "created_at", "updated_at",
}

func newRaidRow(id, status, sessionID, reviewerSID string) []driver.Value {
	now := time.Now()
	var sessPtr, branchPtr interface{} = nil, nil
	if sessionID != "" {
		sessPtr = sessionID
		branchPtr = "feat/test"
	}
	return []driver.Value{
		id, "phase-1", "tracker-1", "TYR-1", "https://example.com",
		"Test Raid", "description",
		pq.Array([]string{"it works"}), pq.Array([]string{"file.go"}),
		nil, status, 0.75, sessPtr, branchPtr,
		nil, nil, nil, nil, 0,
		reviewerSID, 0, now, now,
	}
}

func setupSubscriber(t *testing.T, prChecker PRChecker, trk tracker.Tracker) (*ActivitySubscriber, *Store, sqlmock.Sqlmock, *mockEventSource) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	store := NewStore(db)
	events := newMockEventSource()
	if prChecker == nil {
		prChecker = &mockPRChecker{}
	}

	sub := NewActivitySubscriber(store, events, prChecker, trk, SubscriberConfig{
		IdleDebounceDelay: 10 * time.Millisecond,
	})
	sub.eventLog = NewEventLog(100)

	return sub, store, mock, events
}

// expectRaidByReviewerSessionID sets up the mock expectation for GetRaidByReviewerSessionID.
// If raid is nil, returns empty rows.
func expectRaidByReviewerSessionID(mock sqlmock.Sqlmock, sessionID string, row []driver.Value) {
	q := mock.ExpectQuery("SELECT .+ FROM raids WHERE reviewer_session_id")
	if row == nil {
		q.WithArgs(sessionID).WillReturnRows(sqlmock.NewRows(nil))
	} else {
		q.WithArgs(sessionID).WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	}
}

// expectRaidBySessionID sets up the mock expectation for GetRaidBySessionID.
func expectRaidBySessionID(mock sqlmock.Sqlmock, sessionID string, row []driver.Value) {
	q := mock.ExpectQuery("SELECT .+ FROM raids WHERE session_id")
	if row == nil {
		q.WithArgs(sessionID).WillReturnRows(sqlmock.NewRows(nil))
	} else {
		q.WithArgs(sessionID).WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	}
}

// --- Tests ---

func TestNewActivitySubscriber_DefaultDebounce(t *testing.T) {
	db, _, _ := sqlmock.New()
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	events := newMockEventSource()
	sub := NewActivitySubscriber(store, events, &mockPRChecker{}, nil, SubscriberConfig{})

	if sub.cfg.IdleDebounceDelay != 5*time.Second {
		t.Errorf("expected default debounce 5s, got %v", sub.cfg.IdleDebounceDelay)
	}
}

func TestHandleEvent_EmptySessionID_Ignored(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	// Should not panic or do anything.
	sub.handleEvent(SessionEvent{SessionID: ""})
}

func TestHandleEvent_Idle_SchedulesEvaluation(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	// evaluateCompletion will be called after debounce.
	// First, GetRaidByReviewerSessionID returns nil (not a reviewer).
	expectRaidByReviewerSessionID(mock, sessionID, nil)
	// Then, GetRaidBySessionID returns nil (not tracked).
	expectRaidBySessionID(mock, sessionID, nil)

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "idle", SessionStatus: "running"})

	// Verify timer was scheduled.
	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if !exists {
		t.Error("expected pending evaluation to be scheduled")
	}

	// Wait for debounce to fire.
	time.Sleep(50 * time.Millisecond)

	sub.mu.Lock()
	_, exists = sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected pending evaluation to be cleared after firing")
	}
}

func TestHandleEvent_Active_CancelsDebounce(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	// Manually schedule a timer.
	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(1*time.Hour, func() {
		t.Error("timer should have been cancelled")
	})
	sub.mu.Unlock()

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "active", SessionStatus: "running"})

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected pending evaluation to be cancelled on active event")
	}
}

func TestHandleEvent_TurnComplete_ReviewerSession(t *testing.T) {
	var reviewCalled bool
	sub, _, mock, _ := setupSubscriber(t, nil, nil)
	sub.OnReview(func(raidID string) {
		reviewCalled = true
		if raidID != "raid-1" {
			t.Errorf("expected raidID 'raid-1', got %q", raidID)
		}
	})

	sessionID := "reviewer-1234abcd"
	expectRaidByReviewerSessionID(mock, sessionID, newRaidRow("raid-1", "REVIEW", "work-sess", sessionID))

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "turn_complete", SessionStatus: "running"})

	if !reviewCalled {
		t.Error("expected onReview to be called for reviewer turn_complete")
	}
}

func TestHandleEvent_TurnComplete_WorkingSession_SchedulesEval(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "working-1234abcd"

	// Not a reviewer session.
	expectRaidByReviewerSessionID(mock, sessionID, nil)

	// evaluateCompletion will fire after debounce, needing more mocks.
	// For now just check the timer is scheduled.
	// The debounce callback itself will need mocks, but it runs async.
	// We set up enough mocks for the callback too.
	expectRaidByReviewerSessionID(mock, sessionID, nil)
	expectRaidBySessionID(mock, sessionID, nil)

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "turn_complete", SessionStatus: "running"})

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if !exists {
		t.Error("expected working session turn_complete to schedule evaluation")
	}

	time.Sleep(50 * time.Millisecond)
}

func TestHandleEvent_Stopped_TransitionsToFailed(t *testing.T) {
	trk := newMockTracker()
	sub, _, mock, _ := setupSubscriber(t, nil, trk)

	sessionID := "session-1234abcd"

	// Not a reviewer session.
	expectRaidByReviewerSessionID(mock, sessionID, nil)

	// Working session with RUNNING status.
	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	// Override tracker_id so we can verify tracker call.
	row[2] = "TRACKER-1"
	expectRaidBySessionID(mock, sessionID, row)

	// UpdateRaidStatus does GetRaid + UPDATE.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "", SessionStatus: "stopped"})

	// Give async operations a moment.
	time.Sleep(20 * time.Millisecond)

	trk.mu.Lock()
	calls := len(trk.updateStateCalls)
	trk.mu.Unlock()
	if calls != 1 {
		t.Errorf("expected 1 tracker UpdateIssueState call, got %d", calls)
	}
}

func TestHandleEvent_Failed_TransitionsToFailed(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	// Not a reviewer session.
	expectRaidByReviewerSessionID(mock, sessionID, nil)
	// Not a tracked working session.
	expectRaidBySessionID(mock, sessionID, nil)

	// Should not panic — gracefully ignores untracked sessions.
	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "", SessionStatus: "failed"})
}

func TestEvaluateCompletion_SkipsReviewerSessions(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "reviewer-1234abcd"
	expectRaidByReviewerSessionID(mock, sessionID, newRaidRow("raid-1", "REVIEW", "", sessionID))

	sub.evaluateCompletion(sessionID)

	// No further DB calls means it was skipped. If expectations are met, we're good.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB calls: %v", err)
	}
}

func TestEvaluateCompletion_RunningRaid_TransitionsToReview(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", PRID: "1"},
	}
	trk := newMockTracker()
	sub, _, mock, _ := setupSubscriber(t, prChecker, trk)

	sessionID := "session-1234abcd"

	// Not a reviewer session.
	expectRaidByReviewerSessionID(mock, sessionID, nil)

	// Working session with RUNNING raid.
	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	row[2] = "TRACKER-1"
	expectRaidBySessionID(mock, sessionID, row)

	// UpdateRaidPR.
	mock.ExpectExec("UPDATE raids SET pr_url").WillReturnResult(sqlmock.NewResult(0, 1))

	// UpdateRaidStatus: GetRaid + UPDATE.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	var reviewRaidID string
	sub.OnReview(func(raidID string) {
		reviewRaidID = raidID
	})

	sub.evaluateCompletion(sessionID)

	if reviewRaidID != "raid-1" {
		t.Errorf("expected onReview with 'raid-1', got %q", reviewRaidID)
	}

	trk.mu.Lock()
	if len(trk.updateStateCalls) != 1 {
		t.Errorf("expected 1 tracker call, got %d", len(trk.updateStateCalls))
	} else if trk.updateStateCalls[0].arg != "In Review" {
		t.Errorf("expected 'In Review', got %q", trk.updateStateCalls[0].arg)
	}
	trk.mu.Unlock()
}

func TestEvaluateCompletion_NotRunningRaid_Skipped(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)
	// Raid exists but is already in REVIEW status.
	expectRaidBySessionID(mock, sessionID, newRaidRow("raid-1", "REVIEW", sessionID, ""))

	sub.evaluateCompletion(sessionID)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB calls: %v", err)
	}
}

func TestEvaluateCompletion_NoRaid_Skipped(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)
	expectRaidBySessionID(mock, sessionID, nil)

	sub.evaluateCompletion(sessionID)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB calls: %v", err)
	}
}

func TestHandleSessionEnd_ReviewerSession_TriggersOnReview(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "reviewer-1234abcd"
	expectRaidByReviewerSessionID(mock, sessionID, newRaidRow("raid-1", "REVIEW", "work-sess", sessionID))

	var reviewCalled bool
	sub.OnReview(func(raidID string) {
		reviewCalled = true
		if raidID != "raid-1" {
			t.Errorf("expected 'raid-1', got %q", raidID)
		}
	})

	sub.handleSessionEnd(sessionID, "stopped")

	if !reviewCalled {
		t.Error("expected onReview for reviewer session end")
	}
}

func TestHandleSessionEnd_WorkingSession_FailsRaid(t *testing.T) {
	trk := newMockTracker()
	sub, _, mock, _ := setupSubscriber(t, nil, trk)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	row[2] = "TRACKER-1"
	expectRaidBySessionID(mock, sessionID, row)

	// UpdateRaidStatus.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	sub.handleSessionEnd(sessionID, "stopped")

	trk.mu.Lock()
	if len(trk.updateStateCalls) != 1 {
		t.Errorf("expected 1 tracker call, got %d", len(trk.updateStateCalls))
	} else if trk.updateStateCalls[0].arg != "Canceled" {
		t.Errorf("expected 'Canceled', got %q", trk.updateStateCalls[0].arg)
	}
	trk.mu.Unlock()
}

func TestScheduleEvaluation_DebouncePreventsDuplicate(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	// Schedule first.
	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(1*time.Hour, func() {})
	sub.mu.Unlock()

	// scheduleEvaluation should not replace the existing timer.
	sub.scheduleEvaluation(sessionID)

	sub.mu.Lock()
	timer := sub.pendingEvals[sessionID]
	sub.mu.Unlock()

	if timer == nil {
		t.Error("expected timer to still exist")
	}
}

func TestCancelDebounce_StopsPendingTimer(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	fired := false
	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(10*time.Millisecond, func() {
		fired = true
	})
	sub.mu.Unlock()

	sub.cancelDebounce(sessionID)

	time.Sleep(50 * time.Millisecond)

	if fired {
		t.Error("expected timer to be cancelled, but it fired")
	}

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected timer to be removed from pendingEvals")
	}
}

func TestCancelDebounce_NoOp_WhenNoPending(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	// Should not panic.
	sub.cancelDebounce("nonexistent")
}

func TestCancelAll(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sub.mu.Lock()
	sub.pendingEvals["s1"] = time.AfterFunc(1*time.Hour, func() {})
	sub.pendingEvals["s2"] = time.AfterFunc(1*time.Hour, func() {})
	sub.mu.Unlock()

	sub.cancelAll()

	sub.mu.Lock()
	count := len(sub.pendingEvals)
	sub.mu.Unlock()
	if count != 0 {
		t.Errorf("expected 0 pending evals after cancelAll, got %d", count)
	}
}

func TestOnReview_RegistersCallback(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	called := 0
	sub.OnReview(func(_ string) { called++ })
	sub.OnReview(func(_ string) { called++ })

	// Simulate calling onReview callbacks.
	for _, fn := range sub.onReview {
		fn("test")
	}

	if called != 2 {
		t.Errorf("expected 2 callbacks, got %d", called)
	}
}

func TestEvaluateCompletion_PRError_StillTransitions(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{},
		err:    sql.ErrConnDone,
	}
	trk := newMockTracker()
	sub, _, mock, _ := setupSubscriber(t, prChecker, trk)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	expectRaidBySessionID(mock, sessionID, row)

	// UpdateRaidStatus.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	sub.evaluateCompletion(sessionID)

	// Should still transition despite PR error.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestActivitySubscriber_Start_And_IsRunning(t *testing.T) {
	sub, _, _, events := setupSubscriber(t, nil, nil)

	if sub.IsRunning() {
		t.Error("expected IsRunning=false before Start")
	}

	ctx, cancel := context.WithCancel(context.Background())
	sub.Start(ctx)

	// Give the goroutine time to start.
	time.Sleep(20 * time.Millisecond)

	if !sub.IsRunning() {
		t.Error("expected IsRunning=true after Start")
	}

	cancel()
	time.Sleep(50 * time.Millisecond)

	// After cancellation, the subscriber should stop.
	if sub.IsRunning() {
		t.Error("expected IsRunning=false after context cancellation")
	}

	_ = events // keep events referenced
}

func TestActivitySubscriber_Start_HandlesEvents(t *testing.T) {
	sub, _, mock, events := setupSubscriber(t, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub.Start(ctx)

	sessionID := "session-1234abcd"

	// Set up mocks for the idle event processing.
	expectRaidByReviewerSessionID(mock, sessionID, nil)
	expectRaidBySessionID(mock, sessionID, nil)

	// Send an idle event through the event source.
	events.Send(SessionEvent{SessionID: sessionID, State: "idle", SessionStatus: "running"})

	// Wait for debounce + processing.
	time.Sleep(100 * time.Millisecond)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestActivitySubscriber_Start_ChannelClosed(t *testing.T) {
	sub, _, _, events := setupSubscriber(t, nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub.Start(ctx)
	time.Sleep(20 * time.Millisecond)

	// Close the channel to trigger the !ok path.
	close(events.ch)
	time.Sleep(50 * time.Millisecond)

	if sub.IsRunning() {
		t.Error("expected subscriber to stop when channel is closed")
	}
}

func TestHandleEvent_GitState_CancelsDebounce(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(1*time.Hour, func() {})
	sub.mu.Unlock()

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "git", SessionStatus: "running"})

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected pending evaluation to be cancelled on git event")
	}
}

func TestHandleEvent_StartingState_CancelsDebounce(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(1*time.Hour, func() {})
	sub.mu.Unlock()

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "starting", SessionStatus: "running"})

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected pending evaluation to be cancelled on starting event")
	}
}

func TestHandleEvent_ToolExecuting_CancelsDebounce(t *testing.T) {
	sub, _, _, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	sub.mu.Lock()
	sub.pendingEvals[sessionID] = time.AfterFunc(1*time.Hour, func() {})
	sub.mu.Unlock()

	sub.handleEvent(SessionEvent{SessionID: sessionID, State: "tool_executing", SessionStatus: "running"})

	sub.mu.Lock()
	_, exists := sub.pendingEvals[sessionID]
	sub.mu.Unlock()
	if exists {
		t.Error("expected pending evaluation to be cancelled on tool_executing event")
	}
}

func TestEvaluateCompletion_TrackerNil_NoTrackerUpdate(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{URL: "https://github.com/pr/1", PRID: "1"},
	}
	sub, _, mock, _ := setupSubscriber(t, prChecker, nil) // nil tracker

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	row[2] = "TRACKER-1" // has tracker ID but no tracker adapter
	expectRaidBySessionID(mock, sessionID, row)

	mock.ExpectExec("UPDATE raids SET pr_url").WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	sub.evaluateCompletion(sessionID)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestEvaluateCompletion_NoEventLog(t *testing.T) {
	prChecker := &mockPRChecker{
		result: PRCheckResult{},
	}
	sub, _, mock, _ := setupSubscriber(t, prChecker, nil)
	sub.eventLog = nil // explicitly nil event log

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	expectRaidBySessionID(mock, sessionID, row)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	// Should not panic with nil eventLog.
	sub.evaluateCompletion(sessionID)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestHandleSessionEnd_RaidNotRunning_Skipped(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	// Raid is already MERGED.
	row := newRaidRow("raid-1", "MERGED", sessionID, "")
	expectRaidBySessionID(mock, sessionID, row)

	// Should not try to update status.
	sub.handleSessionEnd(sessionID, "stopped")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestHandleSessionEnd_NilEventLog(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)
	sub.eventLog = nil

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	row := newRaidRow("raid-1", "RUNNING", sessionID, "")
	expectRaidBySessionID(mock, sessionID, row)

	mock.ExpectQuery("SELECT .+ FROM raids WHERE id").
		WithArgs("raid-1").
		WillReturnRows(sqlmock.NewRows(raidColumns).AddRow(row...))
	mock.ExpectExec("UPDATE raids SET status").WillReturnResult(sqlmock.NewResult(0, 1))

	sub.handleSessionEnd(sessionID, "stopped")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestEvaluateCompletion_LookupError(t *testing.T) {
	sub, _, mock, _ := setupSubscriber(t, nil, nil)

	sessionID := "session-1234abcd"

	expectRaidByReviewerSessionID(mock, sessionID, nil)

	// Simulate a DB error for GetRaidBySessionID.
	mock.ExpectQuery("SELECT .+ FROM raids WHERE session_id").
		WithArgs(sessionID).
		WillReturnError(sql.ErrConnDone)

	// Should not panic, just log.
	sub.evaluateCompletion(sessionID)
}
