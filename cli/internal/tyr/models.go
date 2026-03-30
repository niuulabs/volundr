// Package tyr implements a lightweight Go-native subset of Tyr for mini mode.
// It provides saga/phase/raid CRUD, session dispatch, and a REST API that
// mirrors the full Tyr API shape so the web UI works without changes.
package tyr

import (
	"fmt"
	"time"
)

// SagaStatus represents the lifecycle state of a saga.
type SagaStatus string

const (
	SagaStatusActive   SagaStatus = "ACTIVE"
	SagaStatusComplete SagaStatus = "COMPLETE"
	SagaStatusFailed   SagaStatus = "FAILED"
)

// PhaseStatus represents the lifecycle state of a phase.
type PhaseStatus string

const (
	PhaseStatusPending  PhaseStatus = "PENDING"
	PhaseStatusActive   PhaseStatus = "ACTIVE"
	PhaseStatusGated    PhaseStatus = "GATED"
	PhaseStatusComplete PhaseStatus = "COMPLETE"
)

// RaidStatus represents the lifecycle state of a raid.
type RaidStatus string

const (
	RaidStatusPending    RaidStatus = "PENDING"
	RaidStatusQueued     RaidStatus = "QUEUED"
	RaidStatusRunning    RaidStatus = "RUNNING"
	RaidStatusReview     RaidStatus = "REVIEW"
	RaidStatusMerged     RaidStatus = "MERGED"
	RaidStatusFailed     RaidStatus = "FAILED"
	RaidStatusDispatched RaidStatus = "DISPATCHED"
)

// raidTransitions defines valid status transitions for raids.
var raidTransitions = map[RaidStatus][]RaidStatus{
	RaidStatusPending:    {RaidStatusQueued, RaidStatusDispatched},
	RaidStatusQueued:     {RaidStatusDispatched, RaidStatusRunning},
	RaidStatusDispatched: {RaidStatusRunning, RaidStatusFailed},
	RaidStatusRunning:    {RaidStatusReview, RaidStatusFailed},
	RaidStatusReview:     {RaidStatusMerged, RaidStatusFailed, RaidStatusRunning},
	RaidStatusFailed:     {RaidStatusQueued, RaidStatusPending},
}

// ValidTransition checks whether a raid status transition is allowed.
func ValidTransition(from, to RaidStatus) bool {
	targets, ok := raidTransitions[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}

// ConfidenceEventType categorises confidence score changes.
type ConfidenceEventType string

const (
	ConfidenceEventCIPass      ConfidenceEventType = "ci_pass"
	ConfidenceEventCIFail      ConfidenceEventType = "ci_fail"
	ConfidenceEventScopeBreach ConfidenceEventType = "scope_breach"
	ConfidenceEventRetry       ConfidenceEventType = "retry"
	ConfidenceEventHumanReject ConfidenceEventType = "human_reject"
	ConfidenceEventManual      ConfidenceEventType = "manual"
)

// Saga represents a top-level work unit (maps to a tracker project/epic).
type Saga struct {
	ID          string     `json:"id"`
	TrackerID   string     `json:"tracker_id"`
	TrackerType string     `json:"tracker_type"`
	Slug        string     `json:"slug"`
	Name        string     `json:"name"`
	Repos       []string   `json:"repos"`
	Status      SagaStatus `json:"status"`
	Confidence  float64    `json:"confidence"`
	OwnerID     string     `json:"owner_id"`
	BaseBranch  string     `json:"base_branch"`
	CreatedAt   time.Time  `json:"created_at"`
}

// FeatureBranch returns the auto-generated feature branch name.
func (s *Saga) FeatureBranch() string {
	return fmt.Sprintf("feat/%s", s.Slug)
}

// Phase represents a milestone within a saga.
type Phase struct {
	ID         string      `json:"id"`
	SagaID     string      `json:"saga_id"`
	TrackerID  string      `json:"tracker_id"`
	Number     int         `json:"number"`
	Name       string      `json:"name"`
	Status     PhaseStatus `json:"status"`
	Confidence float64     `json:"confidence"`
}

// Raid represents a single coding task within a phase.
type Raid struct {
	ID                 string     `json:"id"`
	PhaseID            string     `json:"phase_id"`
	TrackerID          string     `json:"tracker_id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	AcceptanceCriteria []string   `json:"acceptance_criteria"`
	DeclaredFiles      []string   `json:"declared_files"`
	EstimateHours      *float64   `json:"estimate_hours,omitempty"`
	Status             RaidStatus `json:"status"`
	Confidence         float64    `json:"confidence"`
	SessionID          *string    `json:"session_id,omitempty"`
	Branch             *string    `json:"branch,omitempty"`
	ChronicleSummary   *string    `json:"chronicle_summary,omitempty"`
	PRUrl              *string    `json:"pr_url,omitempty"`
	PRID               *string    `json:"pr_id,omitempty"`
	Reason             *string    `json:"reason,omitempty"`
	RetryCount         int        `json:"retry_count"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// ConfidenceEvent records a change in raid confidence.
type ConfidenceEvent struct {
	ID         string              `json:"id"`
	RaidID     string              `json:"raid_id"`
	EventType  ConfidenceEventType `json:"event_type"`
	Delta      float64             `json:"delta"`
	ScoreAfter float64             `json:"score_after"`
	CreatedAt  time.Time           `json:"created_at"`
}
