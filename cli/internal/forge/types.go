// Package forge implements a macOS-native session runner that exposes
// a Volundr-compatible REST API. Sessions are managed as local processes
// (workspace directory + Claude Code) rather than Kubernetes pods.
package forge

import (
	"fmt"
	"time"
)

// Sentinel errors for typed error handling in handlers.
var (
	ErrSessionNotFound   = fmt.Errorf("session not found")
	ErrSessionNotRunning = fmt.Errorf("session is not running")
)

// Activity state constants for SSE events.
const (
	ActivityStateActive        = "active"
	ActivityStateIdle          = "idle"
	ActivityStateStarting      = "starting"
	ActivityStateToolExecuting = "tool_executing"
	ActivityStateNone          = "none"
	ActivityStateGit           = "git"
)

// --- API request/response types matching Volundr's REST surface ---

// SessionSource describes where the session code comes from.
type SessionSource struct {
	Type       string `json:"type"`
	Repo       string `json:"repo"`
	Branch     string `json:"branch"`
	BaseBranch string `json:"base_branch,omitempty"`
}

// CreateSessionRequest matches the body Tyr sends to POST /api/v1/volundr/sessions.
type CreateSessionRequest struct {
	Name          string         `json:"name"`
	Model         string         `json:"model,omitempty"`
	Source        *SessionSource `json:"source,omitempty"`
	SystemPrompt  string         `json:"system_prompt,omitempty"`
	InitialPrompt string         `json:"initial_prompt,omitempty"`
	IssueID       string         `json:"issue_id,omitempty"`
	IssueURL      string         `json:"issue_url,omitempty"`
	TemplateName  string         `json:"template_name,omitempty"`
}

// SessionResponse is returned for session CRUD operations.
type SessionResponse struct {
	ID              string         `json:"id"`
	Name            string         `json:"name"`
	Model           string         `json:"model"`
	Source          *SessionSource `json:"source,omitempty"`
	Status          string         `json:"status"`
	ChatEndpoint    string         `json:"chat_endpoint,omitempty"`
	CodeEndpoint    string         `json:"code_endpoint,omitempty"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
	LastActive      string         `json:"last_active"`
	MessageCount    int            `json:"message_count"`
	TokensUsed      int            `json:"tokens_used"`
	PodName         string         `json:"pod_name,omitempty"`
	Error           string         `json:"error,omitempty"`
	TrackerIssueID  string         `json:"tracker_issue_id,omitempty"`
	IssueTrackerURL string         `json:"issue_tracker_url,omitempty"`
	OwnerID         string         `json:"owner_id,omitempty"`
	TenantID        string         `json:"tenant_id,omitempty"`
	CostEstimate    float64        `json:"cost_estimate,omitempty"`
}

// SendMessageRequest is the body for POST /sessions/{id}/messages.
type SendMessageRequest struct {
	Content string `json:"content"`
}

// PRStatusResponse is returned by GET /sessions/{id}/pr.
type PRStatusResponse struct {
	PRID      string `json:"pr_id"`
	URL       string `json:"url"`
	State     string `json:"state"`
	Mergeable bool   `json:"mergeable"`
	CIPassed  *bool  `json:"ci_passed"`
}

// ChronicleResponse is returned by GET /sessions/{id}/chronicle.
type ChronicleResponse struct {
	Summary string `json:"summary"`
}

// ActivityEvent is emitted over SSE for session activity.
type ActivityEvent struct {
	SessionID     string         `json:"session_id"`
	State         string         `json:"state"`
	Metadata      map[string]any `json:"metadata"`
	OwnerID       string         `json:"owner_id"`
	SessionStatus string         `json:"session_status,omitempty"`
}

// StatsResponse holds aggregate statistics.
type StatsResponse struct {
	ActiveSessions int     `json:"active_sessions"`
	TotalSessions  int     `json:"total_sessions"`
	TokensToday    int     `json:"tokens_today"`
	CostToday      float64 `json:"cost_today"`
}

// --- Internal session state ---

// SessionStatus enumerates session lifecycle states.
type SessionStatus string

const (
	StatusCreated      SessionStatus = "created"
	StatusStarting     SessionStatus = "starting"
	StatusProvisioning SessionStatus = "provisioning"
	StatusRunning      SessionStatus = "running"
	StatusStopping     SessionStatus = "stopping"
	StatusStopped      SessionStatus = "stopped"
	StatusFailed       SessionStatus = "failed"
)

// Session is the internal representation of a running or completed session.
type Session struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Model         string         `json:"model"`
	Source        *SessionSource `json:"source,omitempty"`
	Status        SessionStatus  `json:"status"`
	WorkspaceDir  string         `json:"workspace_dir"`
	ChatEndpoint  string         `json:"chat_endpoint,omitempty"`
	CodeEndpoint  string         `json:"code_endpoint,omitempty"`
	SystemPrompt  string         `json:"system_prompt,omitempty"`
	InitialPrompt string         `json:"initial_prompt,omitempty"`
	IssueID       string         `json:"issue_id,omitempty"`
	IssueURL      string         `json:"issue_url,omitempty"`
	OwnerID       string         `json:"owner_id,omitempty"`
	Error         string         `json:"error,omitempty"`
	MessageCount  int            `json:"message_count"`
	TokensUsed    int            `json:"tokens_used"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	LastActive    time.Time      `json:"last_active"`
}

// ToResponse converts internal Session to the API response shape.
func (s *Session) ToResponse() SessionResponse {
	return SessionResponse{
		ID:              s.ID,
		Name:            s.Name,
		Model:           s.Model,
		Source:          s.Source,
		Status:          string(s.Status),
		ChatEndpoint:    s.ChatEndpoint,
		CodeEndpoint:    s.CodeEndpoint,
		CreatedAt:       s.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       s.UpdatedAt.UTC().Format(time.RFC3339),
		LastActive:      s.LastActive.UTC().Format(time.RFC3339),
		MessageCount:    s.MessageCount,
		TokensUsed:      s.TokensUsed,
		Error:           s.Error,
		TrackerIssueID:  s.IssueID,
		IssueTrackerURL: s.IssueURL,
		OwnerID:         s.OwnerID,
	}
}
