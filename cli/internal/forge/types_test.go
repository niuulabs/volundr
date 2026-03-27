package forge

import (
	"testing"
	"time"
)

func TestSession_ToResponse(t *testing.T) {
	now := time.Date(2026, 3, 15, 10, 0, 0, 0, time.UTC)
	sess := &Session{
		ID:           "ses-1",
		Name:         "test-session",
		Model:        "claude-sonnet-4-6",
		Source:       &SessionSource{Type: "git", Repo: "org/repo", Branch: "main"},
		Status:       StatusRunning,
		ChatEndpoint: "/chat",
		CodeEndpoint: "/code",
		IssueID:      "NIU-100",
		IssueURL:     "https://linear.app/NIU-100",
		OwnerID:      "user-1",
		MessageCount: 5,
		TokensUsed:   1200,
		CreatedAt:    now,
		UpdatedAt:    now,
		LastActive:   now,
	}

	resp := sess.ToResponse()

	if resp.ID != "ses-1" {
		t.Errorf("ID: got %q, want %q", resp.ID, "ses-1")
	}
	if resp.Name != "test-session" {
		t.Errorf("Name: got %q, want %q", resp.Name, "test-session")
	}
	if resp.Status != "running" {
		t.Errorf("Status: got %q, want %q", resp.Status, "running")
	}
	if resp.ChatEndpoint != "/chat" {
		t.Errorf("ChatEndpoint: got %q, want %q", resp.ChatEndpoint, "/chat")
	}
	if resp.TrackerIssueID != "NIU-100" {
		t.Errorf("TrackerIssueID: got %q, want %q", resp.TrackerIssueID, "NIU-100")
	}
	if resp.IssueTrackerURL != "https://linear.app/NIU-100" {
		t.Errorf("IssueTrackerURL: got %q, want %q", resp.IssueTrackerURL, "https://linear.app/NIU-100")
	}
	if resp.OwnerID != "user-1" {
		t.Errorf("OwnerID: got %q, want %q", resp.OwnerID, "user-1")
	}
	if resp.MessageCount != 5 {
		t.Errorf("MessageCount: got %d, want %d", resp.MessageCount, 5)
	}
	if resp.TokensUsed != 1200 {
		t.Errorf("TokensUsed: got %d, want %d", resp.TokensUsed, 1200)
	}
	if resp.Source == nil || resp.Source.Repo != "org/repo" {
		t.Error("Source not propagated correctly")
	}
	want := "2026-03-15T10:00:00Z"
	if resp.CreatedAt != want {
		t.Errorf("CreatedAt: got %q, want %q", resp.CreatedAt, want)
	}
}
