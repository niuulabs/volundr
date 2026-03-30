// Package tyr implements a lightweight Go-native subset of the Tyr saga
// coordinator for mini mode. It provides saga/phase/raid CRUD, a raid state
// machine, and dispatch to Forge sessions — all without Python or Docker.
package tyr

import (
	"fmt"
	"time"
)

// ---------------------------------------------------------------------------
// Status enums — match full Tyr's Python StrEnum values exactly.
// ---------------------------------------------------------------------------

// SagaStatus represents the lifecycle state of a saga.
type SagaStatus string

// Saga status constants.
const (
	SagaStatusActive   SagaStatus = "ACTIVE"
	SagaStatusComplete SagaStatus = "COMPLETE"
	SagaStatusFailed   SagaStatus = "FAILED"
)

// PhaseStatus represents the lifecycle state of a phase.
type PhaseStatus string

// Phase status constants.
const (
	PhaseStatusPending  PhaseStatus = "PENDING"
	PhaseStatusActive   PhaseStatus = "ACTIVE"
	PhaseStatusGated    PhaseStatus = "GATED"
	PhaseStatusComplete PhaseStatus = "COMPLETE"
)

// RaidStatus represents the lifecycle state of a raid.
type RaidStatus string

// Raid status constants.
const (
	RaidStatusPending   RaidStatus = "PENDING"
	RaidStatusQueued    RaidStatus = "QUEUED"
	RaidStatusRunning   RaidStatus = "RUNNING"
	RaidStatusReview    RaidStatus = "REVIEW"
	RaidStatusEscalated RaidStatus = "ESCALATED"
	RaidStatusMerged    RaidStatus = "MERGED"
	RaidStatusFailed    RaidStatus = "FAILED"
)

// raidTransitions encodes the allowed state transitions for raids.
// Matches full Tyr's RAID_TRANSITIONS exactly.
var raidTransitions = map[RaidStatus]map[RaidStatus]bool{
	RaidStatusPending:   {RaidStatusQueued: true},
	RaidStatusQueued:    {RaidStatusRunning: true, RaidStatusFailed: true},
	RaidStatusRunning:   {RaidStatusReview: true, RaidStatusMerged: true, RaidStatusFailed: true},
	RaidStatusReview:    {RaidStatusPending: true, RaidStatusQueued: true, RaidStatusEscalated: true, RaidStatusMerged: true, RaidStatusFailed: true},
	RaidStatusEscalated: {RaidStatusQueued: true, RaidStatusMerged: true, RaidStatusFailed: true},
	RaidStatusMerged:    {},
	RaidStatusFailed:    {RaidStatusQueued: true},
}

// ValidateTransition checks whether a raid status transition is allowed.
func ValidateTransition(current, target RaidStatus) error {
	allowed, ok := raidTransitions[current]
	if !ok {
		return fmt.Errorf("unknown raid status %q", current)
	}
	if !allowed[target] {
		return fmt.Errorf("invalid transition from %s to %s", current, target)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Domain entities — match full Tyr's database schema.
// ---------------------------------------------------------------------------

// Saga represents a tracked project decomposition.
type Saga struct {
	ID            string     `json:"id"`
	TrackerID     string     `json:"tracker_id"`
	TrackerType   string     `json:"tracker_type"`
	Slug          string     `json:"slug"`
	Name          string     `json:"name"`
	Repos         []string   `json:"repos"`
	FeatureBranch string     `json:"feature_branch"`
	BaseBranch    string     `json:"base_branch"`
	Status        SagaStatus `json:"status"`
	Confidence    float64    `json:"confidence"`
	OwnerID       string     `json:"owner_id"`
	CreatedAt     time.Time  `json:"created_at"`
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

// Raid represents a single unit of work within a phase.
type Raid struct {
	ID                 string     `json:"id"`
	PhaseID            string     `json:"phase_id"`
	TrackerID          string     `json:"tracker_id"`
	Name               string     `json:"name"`
	Description        string     `json:"description"`
	AcceptanceCriteria []string   `json:"acceptance_criteria"`
	DeclaredFiles      []string   `json:"declared_files"`
	EstimateHours      *float64   `json:"estimate_hours"`
	Status             RaidStatus `json:"status"`
	Confidence         float64    `json:"confidence"`
	SessionID          *string    `json:"session_id"`
	Branch             *string    `json:"branch"`
	ChronicleSummary   *string    `json:"chronicle_summary"`
	PRUrl              *string    `json:"pr_url"`
	PRID               *string    `json:"pr_id"`
	Reason             *string    `json:"reason"`
	RetryCount         int        `json:"retry_count"`
	ReviewerSessionID  *string    `json:"reviewer_session_id"`
	ReviewRound        int        `json:"review_round"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// ConfidenceEvent records a change in a raid's confidence score.
type ConfidenceEvent struct {
	ID         string    `json:"id"`
	RaidID     string    `json:"raid_id"`
	EventType  string    `json:"event_type"`
	Delta      float64   `json:"delta"`
	ScoreAfter float64   `json:"score_after"`
	CreatedAt  time.Time `json:"created_at"`
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

// SagaListItem is returned by GET /api/v1/tyr/sagas.
type SagaListItem struct {
	ID             string   `json:"id"`
	TrackerID      string   `json:"tracker_id"`
	TrackerType    string   `json:"tracker_type"`
	Slug           string   `json:"slug"`
	Name           string   `json:"name"`
	Repos          []string `json:"repos"`
	FeatureBranch  string   `json:"feature_branch"`
	Status         string   `json:"status"`
	Progress       float64  `json:"progress"`
	MilestoneCount int      `json:"milestone_count"`
	IssueCount     int      `json:"issue_count"`
}

// SagaDetailResponse is returned by GET /api/v1/tyr/sagas/{id}.
type SagaDetailResponse struct {
	ID            string                `json:"id"`
	TrackerID     string                `json:"tracker_id"`
	TrackerType   string                `json:"tracker_type"`
	Slug          string                `json:"slug"`
	Name          string                `json:"name"`
	Repos         []string              `json:"repos"`
	FeatureBranch string                `json:"feature_branch"`
	BaseBranch    string                `json:"base_branch"`
	Status        string                `json:"status"`
	Confidence    float64               `json:"confidence"`
	Phases        []PhaseDetailResponse `json:"phases"`
}

// PhaseDetailResponse is a phase with its raids.
type PhaseDetailResponse struct {
	ID         string               `json:"id"`
	Number     int                  `json:"number"`
	Name       string               `json:"name"`
	Status     string               `json:"status"`
	Confidence float64              `json:"confidence"`
	Raids      []RaidDetailResponse `json:"raids"`
}

// RaidDetailResponse is a raid within a phase.
type RaidDetailResponse struct {
	ID                 string   `json:"id"`
	TrackerID          string   `json:"tracker_id"`
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	AcceptanceCriteria []string `json:"acceptance_criteria"`
	Status             string   `json:"status"`
	Confidence         float64  `json:"confidence"`
	SessionID          *string  `json:"session_id"`
	Branch             *string  `json:"branch"`
	PRUrl              *string  `json:"pr_url"`
	RetryCount         int      `json:"retry_count"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

// ActiveRaidResponse is returned by GET /api/v1/tyr/raids/active.
type ActiveRaidResponse struct {
	TrackerID         string  `json:"tracker_id"`
	Identifier        string  `json:"identifier"`
	Title             string  `json:"title"`
	URL               string  `json:"url"`
	Status            string  `json:"status"`
	SessionID         *string `json:"session_id"`
	ReviewerSessionID *string `json:"reviewer_session_id"`
	ReviewRound       int     `json:"review_round"`
	Confidence        float64 `json:"confidence"`
	PRUrl             *string `json:"pr_url"`
	LastUpdated       string  `json:"last_updated"`
}

// CommitRequest is the body for POST /api/v1/tyr/sagas/commit.
type CommitRequest struct {
	Name       string             `json:"name"`
	Slug       string             `json:"slug"`
	Repos      []string           `json:"repos"`
	BaseBranch string             `json:"base_branch"`
	Phases     []PhaseSpecRequest `json:"phases"`
}

// PhaseSpecRequest describes a phase to create.
type PhaseSpecRequest struct {
	Name  string            `json:"name"`
	Raids []RaidSpecRequest `json:"raids"`
}

// RaidSpecRequest describes a raid to create.
type RaidSpecRequest struct {
	Name               string   `json:"name"`
	Description        string   `json:"description"`
	AcceptanceCriteria []string `json:"acceptance_criteria"`
	DeclaredFiles      []string `json:"declared_files"`
	EstimateHours      float64  `json:"estimate_hours"`
}

// CommittedSagaResponse is returned by POST /api/v1/tyr/sagas/commit.
type CommittedSagaResponse struct {
	ID            string                   `json:"id"`
	TrackerID     string                   `json:"tracker_id"`
	TrackerType   string                   `json:"tracker_type"`
	Slug          string                   `json:"slug"`
	Name          string                   `json:"name"`
	Repos         []string                 `json:"repos"`
	FeatureBranch string                   `json:"feature_branch"`
	BaseBranch    string                   `json:"base_branch"`
	Status        string                   `json:"status"`
	Confidence    float64                  `json:"confidence"`
	Phases        []CommittedPhaseResponse `json:"phases"`
}

// CommittedPhaseResponse is a phase in the commit response.
type CommittedPhaseResponse struct {
	ID        string                  `json:"id"`
	TrackerID string                  `json:"tracker_id"`
	Number    int                     `json:"number"`
	Name      string                  `json:"name"`
	Status    string                  `json:"status"`
	Raids     []CommittedRaidResponse `json:"raids"`
}

// CommittedRaidResponse is a raid in the commit response.
type CommittedRaidResponse struct {
	ID        string `json:"id"`
	TrackerID string `json:"tracker_id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
}

// DispatchRequest is the body for POST /api/v1/tyr/dispatch/approve.
type DispatchRequest struct {
	Items []DispatchItem `json:"items"`
	Model string         `json:"model"`
}

// DispatchItem is a single item to dispatch.
type DispatchItem struct {
	SagaID  string `json:"saga_id"`
	IssueID string `json:"issue_id"`
	Repo    string `json:"repo"`
}

// DispatchResult is returned per dispatched item.
type DispatchResult struct {
	IssueID     string `json:"issue_id"`
	SessionID   string `json:"session_id"`
	SessionName string `json:"session_name"`
	Status      string `json:"status"`
}

// RaidStatusUpdate is the body for POST /api/v1/tyr/raids/{id}/{action}.
type RaidStatusUpdate struct {
	Reason string `json:"reason,omitempty"`
}

// RaidResponse is the standard raid action response.
type RaidResponse struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Status           string  `json:"status"`
	Confidence       float64 `json:"confidence"`
	RetryCount       int     `json:"retry_count"`
	Branch           *string `json:"branch"`
	ChronicleSummary *string `json:"chronicle_summary"`
	Reason           *string `json:"reason"`
}
