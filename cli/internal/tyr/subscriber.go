package tyr

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// SubscriberConfig holds configuration for the activity subscriber.
type SubscriberConfig struct {
	IdleDebounceDelay time.Duration // default 5s
}

// ActivitySubscriber monitors Forge session events and transitions raids
// through their lifecycle (RUNNING → REVIEW → MERGED/FAILED).
type ActivitySubscriber struct {
	store   *Store
	events  EventSource
	pr      PRChecker
	tracker tracker.Tracker
	cfg     SubscriberConfig

	mu           sync.Mutex
	pendingEvals map[string]*time.Timer // sessionID → debounce timer
	onReview     []func(raidID string)
	running      bool
	eventLog     *EventLog
}

// NewActivitySubscriber creates a new subscriber.
func NewActivitySubscriber(store *Store, events EventSource, pr PRChecker, t tracker.Tracker, cfg SubscriberConfig) *ActivitySubscriber {
	if cfg.IdleDebounceDelay == 0 {
		cfg.IdleDebounceDelay = 5 * time.Second
	}
	return &ActivitySubscriber{
		store:        store,
		events:       events,
		pr:           pr,
		tracker:      t,
		cfg:          cfg,
		pendingEvals: make(map[string]*time.Timer),
	}
}

// OnReview registers a callback invoked when a raid enters REVIEW.
func (s *ActivitySubscriber) OnReview(fn func(raidID string)) {
	s.onReview = append(s.onReview, fn)
}

// Start begins listening for session events. Blocks until ctx is cancelled.
func (s *ActivitySubscriber) Start(ctx context.Context) {
	s.running = true
	subID, ch := s.events.Subscribe()
	log.Println("tyr: activity subscriber started")

	go func() {
		defer func() {
			s.events.Unsubscribe(subID)
			s.cancelAll()
			s.running = false
			log.Println("tyr: activity subscriber stopped")
		}()

		for {
			select {
			case <-ctx.Done():
				return
			case evt, ok := <-ch:
				if !ok {
					return
				}
				s.handleEvent(evt)
			}
		}
	}()
}

// IsRunning returns whether the subscriber is active.
func (s *ActivitySubscriber) IsRunning() bool {
	return s.running
}

func (s *ActivitySubscriber) handleEvent(evt SessionEvent) {
	sessionID := evt.SessionID
	if sessionID == "" {
		return
	}

	log.Printf("tyr: subscriber: event session=%s state=%s status=%s",
		sessionID[:min(len(sessionID), 8)], evt.State, evt.SessionStatus)

	// Session stopped or failed — transition raid to FAILED.
	if evt.SessionStatus == "stopped" || evt.SessionStatus == "failed" {
		s.cancelDebounce(sessionID)
		s.handleSessionEnd(sessionID, evt.SessionStatus)
		return
	}

	switch evt.State {
	case "idle":
		s.scheduleEvaluation(sessionID)
	case "active", "tool_executing", "starting", "git":
		s.cancelDebounce(sessionID)
	}
}

func (s *ActivitySubscriber) scheduleEvaluation(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Don't re-schedule if already pending.
	if _, exists := s.pendingEvals[sessionID]; exists {
		return
	}

	timer := time.AfterFunc(s.cfg.IdleDebounceDelay, func() {
		s.mu.Lock()
		delete(s.pendingEvals, sessionID)
		s.mu.Unlock()

		s.evaluateCompletion(sessionID)
	})
	s.pendingEvals[sessionID] = timer
}

func (s *ActivitySubscriber) cancelDebounce(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if timer, exists := s.pendingEvals[sessionID]; exists {
		timer.Stop()
		delete(s.pendingEvals, sessionID)
	}
}

func (s *ActivitySubscriber) cancelAll() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for id, timer := range s.pendingEvals {
		timer.Stop()
		delete(s.pendingEvals, id)
	}
}

func (s *ActivitySubscriber) evaluateCompletion(sessionID string) {
	ctx := context.Background()

	// Check if this is a reviewer session.
	reviewRaid, _ := s.store.GetRaidByReviewerSessionID(ctx, sessionID)
	if reviewRaid != nil {
		// This is a reviewer session idle — let the review engine handle it.
		for _, fn := range s.onReview {
			fn(reviewRaid.ID)
		}
		return
	}

	// Check working session.
	raid, err := s.store.GetRaidBySessionID(ctx, sessionID)
	if err != nil {
		log.Printf("tyr: subscriber: lookup raid for session %s: %v", sessionID[:8], err)
		return
	}
	if raid == nil {
		return // Not a tracked session.
	}
	if raid.Status != RaidStatusRunning {
		return // Only evaluate running raids.
	}

	// Check for PR.
	pr, err := s.pr.GetPRStatus(sessionID)
	if err != nil {
		log.Printf("tyr: subscriber: check PR for session %s: %v", sessionID[:8], err)
	}

	if pr.URL != "" {
		_ = s.store.UpdateRaidPR(ctx, raid.ID, pr.URL, pr.PRID)
	}

	// Transition to REVIEW.
	log.Printf("tyr: subscriber: session %s idle, transitioning raid %s to REVIEW (pr=%v)",
		sessionID[:8], raid.Identifier, pr.URL != "")

	if err := s.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusReview, nil); err != nil {
		log.Printf("tyr: subscriber: update raid status: %v", err)
		return
	}

	if s.eventLog != nil {
		s.eventLog.Emit("raid.state_changed", map[string]any{
			"raid_id":    raid.ID,
			"identifier": raid.Identifier,
			"status":     "REVIEW",
			"session_id": sessionID,
		}, "")
	}

	// Update Linear issue status.
	if s.tracker != nil && raid.TrackerID != "" {
		if err := s.tracker.UpdateIssueState(raid.TrackerID, "In Review"); err != nil {
			log.Printf("tyr: subscriber: update tracker status: %v", err)
		}
	}

	// Notify review engine.
	for _, fn := range s.onReview {
		fn(raid.ID)
	}
}

func (s *ActivitySubscriber) handleSessionEnd(sessionID, status string) {
	ctx := context.Background()

	// Check if this is a reviewer session that stopped/completed.
	reviewRaid, _ := s.store.GetRaidByReviewerSessionID(ctx, sessionID)
	if reviewRaid != nil {
		log.Printf("tyr: subscriber: reviewer session %s %s for raid %s, triggering review",
			sessionID[:min(len(sessionID), 8)], status, reviewRaid.Identifier)
		for _, fn := range s.onReview {
			fn(reviewRaid.ID)
		}
		return
	}

	// Check if this is a working session.
	raid, err := s.store.GetRaidBySessionID(ctx, sessionID)
	if err != nil || raid == nil {
		return
	}
	if raid.Status != RaidStatusRunning {
		return
	}

	reason := "session " + status
	log.Printf("tyr: subscriber: session %s %s, marking raid %s as FAILED",
		sessionID[:min(len(sessionID), 8)], status, raid.Identifier)

	if err := s.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusFailed, &reason); err != nil {
		log.Printf("tyr: subscriber: update raid status: %v", err)
	}

	if s.eventLog != nil {
		s.eventLog.Emit("raid.state_changed", map[string]any{
			"raid_id":    raid.ID,
			"identifier": raid.Identifier,
			"status":     "FAILED",
			"reason":     reason,
		}, "")
	}

	if s.tracker != nil && raid.TrackerID != "" {
		_ = s.tracker.UpdateIssueState(raid.TrackerID, "Canceled")
	}
}
