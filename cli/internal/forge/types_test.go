package forge

import (
	"testing"
	"time"
)

func TestSessionToResponse(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 27, 12, 0, 0, 0, time.UTC)
	source := &SessionSource{
		Type:       "git",
		Repo:       "niuulabs/volundr",
		Branch:     "main",
		BaseBranch: "main",
	}

	sess := &Session{
		ID:            "sess-1",
		Name:          "test-session",
		Model:         "claude-sonnet-4-6",
		Source:        source,
		Status:        StatusRunning,
		WorkspaceDir:  "/tmp/workspace",
		ChatEndpoint:  "http://localhost:8080/chat",
		CodeEndpoint:  "http://localhost:8080/code",
		SystemPrompt:  "You are a helpful assistant.",
		InitialPrompt: "Hello",
		IssueID:       "NIU-255",
		IssueURL:      "https://linear.app/niuu/issue/NIU-255",
		OwnerID:       "owner-abc",
		Error:         "",
		MessageCount:  5,
		TokensUsed:    1200,
		CreatedAt:     now,
		UpdatedAt:     now.Add(10 * time.Minute),
		LastActive:    now.Add(15 * time.Minute),
	}

	resp := sess.ToResponse()

	if resp.ID != "sess-1" {
		t.Errorf("ID = %q, want %q", resp.ID, "sess-1")
	}
	if resp.Name != "test-session" {
		t.Errorf("Name = %q, want %q", resp.Name, "test-session")
	}
	if resp.Model != "claude-sonnet-4-6" {
		t.Errorf("Model = %q, want %q", resp.Model, "claude-sonnet-4-6")
	}
	if resp.Source != source {
		t.Error("Source pointer mismatch")
	}
	if resp.Status != "running" {
		t.Errorf("Status = %q, want %q", resp.Status, "running")
	}
	if resp.ChatEndpoint != "http://localhost:8080/chat" {
		t.Errorf("ChatEndpoint = %q, want %q", resp.ChatEndpoint, "http://localhost:8080/chat")
	}
	if resp.CodeEndpoint != "http://localhost:8080/code" {
		t.Errorf("CodeEndpoint = %q, want %q", resp.CodeEndpoint, "http://localhost:8080/code")
	}
	if resp.MessageCount != 5 {
		t.Errorf("MessageCount = %d, want %d", resp.MessageCount, 5)
	}
	if resp.TokensUsed != 1200 {
		t.Errorf("TokensUsed = %d, want %d", resp.TokensUsed, 1200)
	}
	if resp.TrackerIssueID != "NIU-255" {
		t.Errorf("TrackerIssueID = %q, want %q", resp.TrackerIssueID, "NIU-255")
	}
	if resp.IssueTrackerURL != "https://linear.app/niuu/issue/NIU-255" {
		t.Errorf("IssueTrackerURL = %q, want %q", resp.IssueTrackerURL, "https://linear.app/niuu/issue/NIU-255")
	}
	if resp.OwnerID != "owner-abc" {
		t.Errorf("OwnerID = %q, want %q", resp.OwnerID, "owner-abc")
	}
	if resp.Error != "" {
		t.Errorf("Error = %q, want empty", resp.Error)
	}

	wantCreated := "2026-03-27T12:00:00Z"
	if resp.CreatedAt != wantCreated {
		t.Errorf("CreatedAt = %q, want %q", resp.CreatedAt, wantCreated)
	}
	wantUpdated := "2026-03-27T12:10:00Z"
	if resp.UpdatedAt != wantUpdated {
		t.Errorf("UpdatedAt = %q, want %q", resp.UpdatedAt, wantUpdated)
	}
	wantActive := "2026-03-27T12:15:00Z"
	if resp.LastActive != wantActive {
		t.Errorf("LastActive = %q, want %q", resp.LastActive, wantActive)
	}
}

func TestSessionToResponseNilSource(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	sess := &Session{
		ID:         "sess-2",
		Name:       "no-source",
		Status:     StatusCreated,
		CreatedAt:  now,
		UpdatedAt:  now,
		LastActive: now,
	}

	resp := sess.ToResponse()

	if resp.Source != nil {
		t.Errorf("Source = %v, want nil", resp.Source)
	}
	if resp.Status != "created" {
		t.Errorf("Status = %q, want %q", resp.Status, "created")
	}
}

func TestSessionToResponseWithError(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	sess := &Session{
		ID:         "sess-3",
		Name:       "failed-session",
		Status:     StatusFailed,
		Error:      "process exited with code 1",
		CreatedAt:  now,
		UpdatedAt:  now,
		LastActive: now,
	}

	resp := sess.ToResponse()

	if resp.Status != "failed" {
		t.Errorf("Status = %q, want %q", resp.Status, "failed")
	}
	if resp.Error != "process exited with code 1" {
		t.Errorf("Error = %q, want %q", resp.Error, "process exited with code 1")
	}
}

func TestSessionToResponseTimezoneConversion(t *testing.T) {
	t.Parallel()

	// Create session with non-UTC timezone — ToResponse should convert to UTC
	loc := time.FixedZone("EST", -5*3600)
	est := time.Date(2026, 3, 27, 7, 0, 0, 0, loc) // 07:00 EST = 12:00 UTC

	sess := &Session{
		ID:         "sess-4",
		Name:       "tz-test",
		Status:     StatusStopped,
		CreatedAt:  est,
		UpdatedAt:  est,
		LastActive: est,
	}

	resp := sess.ToResponse()

	want := "2026-03-27T12:00:00Z"
	if resp.CreatedAt != want {
		t.Errorf("CreatedAt = %q, want %q (UTC conversion)", resp.CreatedAt, want)
	}
}

func TestSessionStatusConstants(t *testing.T) {
	t.Parallel()

	tests := []struct {
		status SessionStatus
		want   string
	}{
		{StatusCreated, "created"},
		{StatusStarting, "starting"},
		{StatusProvisioning, "provisioning"},
		{StatusRunning, "running"},
		{StatusStopping, "stopping"},
		{StatusStopped, "stopped"},
		{StatusFailed, "failed"},
	}

	for _, tt := range tests {
		if string(tt.status) != tt.want {
			t.Errorf("SessionStatus(%v) = %q, want %q", tt.status, string(tt.status), tt.want)
		}
	}
}

func TestActivityStateConstants(t *testing.T) {
	t.Parallel()

	if ActivityStateActive != "active" {
		t.Errorf("ActivityStateActive = %q", ActivityStateActive)
	}
	if ActivityStateIdle != "idle" {
		t.Errorf("ActivityStateIdle = %q", ActivityStateIdle)
	}
	if ActivityStateStarting != "starting" {
		t.Errorf("ActivityStateStarting = %q", ActivityStateStarting)
	}
	if ActivityStateToolExecuting != "tool_executing" {
		t.Errorf("ActivityStateToolExecuting = %q", ActivityStateToolExecuting)
	}
	if ActivityStateNone != "none" {
		t.Errorf("ActivityStateNone = %q", ActivityStateNone)
	}
	if ActivityStateGit != "git" {
		t.Errorf("ActivityStateGit = %q", ActivityStateGit)
	}
}

func TestSentinelErrors(t *testing.T) {
	t.Parallel()

	if ErrSessionNotFound.Error() != "session not found" {
		t.Errorf("ErrSessionNotFound = %q", ErrSessionNotFound.Error())
	}
	if ErrSessionNotRunning.Error() != "session is not running" {
		t.Errorf("ErrSessionNotRunning = %q", ErrSessionNotRunning.Error())
	}
}
