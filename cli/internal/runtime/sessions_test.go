package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchSessions_Success(t *testing.T) {
	sessions := []apiSessionResponse{
		{
			ID:        "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
			Name:      "fix-auth-bug",
			Model:     "claude-sonnet-4",
			Status:    "running",
			CreatedAt: "2026-03-29T10:00:00Z",
			Source:    apiSessionSource{Type: "git", Repo: "github.com/org/api"},
		},
		{
			ID:        "b2c3d4e5-f6g7-h8i9-j0k1-l2m3n4o5p6q7",
			Name:      "add-tests",
			Model:     "claude-sonnet-4",
			Status:    "stopped",
			CreatedAt: "2026-03-29T11:00:00Z",
			Source:    apiSessionSource{Type: "git", Repo: "github.com/org/web"},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sessions)
	}))
	defer server.Close()

	result, err := fetchSessions(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("fetchSessions: %v", err)
	}

	if len(result) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(result))
	}

	if result[0].ID != "a1b2c3d4" {
		t.Errorf("expected truncated ID 'a1b2c3d4', got %q", result[0].ID)
	}
	if result[0].Name != "fix-auth-bug" {
		t.Errorf("expected name 'fix-auth-bug', got %q", result[0].Name)
	}
	if result[0].Status != "running" {
		t.Errorf("expected status 'running', got %q", result[0].Status)
	}
	if result[0].Repo != "github.com/org/api" {
		t.Errorf("expected repo 'github.com/org/api', got %q", result[0].Repo)
	}
}

func TestFetchSessions_Unreachable(t *testing.T) {
	// Use a URL that won't connect.
	result, err := fetchSessions(context.Background(), "http://127.0.0.1:1")
	if err != nil {
		t.Fatalf("expected nil error for unreachable server, got: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil sessions for unreachable server, got %d", len(result))
	}
}

func TestFetchSessions_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	result, err := fetchSessions(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("expected nil error for server error, got: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil sessions for server error, got %d", len(result))
	}
}

func TestFetchSessions_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not json"))
	}))
	defer server.Close()

	result, err := fetchSessions(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("expected nil error for invalid JSON, got: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil sessions for invalid JSON, got %d", len(result))
	}
}

func TestFetchSessions_EmptyList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	defer server.Close()

	result, err := fetchSessions(context.Background(), server.URL)
	if err != nil {
		t.Fatalf("fetchSessions: %v", err)
	}

	if len(result) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(result))
	}
}

func TestTruncateID(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"a1b2c3d4-e5f6-g7h8", "a1b2c3d4"},
		{"short", "short"},
		{"12345678", "12345678"},
		{"123456789", "12345678"},
		{"", ""},
	}

	for _, tt := range tests {
		result := truncateID(tt.input)
		if result != tt.expected {
			t.Errorf("truncateID(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestCountActiveSessions(t *testing.T) {
	sessions := []SessionInfo{
		{Status: "running"},
		{Status: "starting"},
		{Status: "provisioning"},
		{Status: "created"},
		{Status: "stopped"},
		{Status: "failed"},
		{Status: "archived"},
	}

	count := countActiveSessions(sessions)
	if count != 4 {
		t.Errorf("expected 4 active sessions, got %d", count)
	}
}

func TestCountActiveSessions_Empty(t *testing.T) {
	count := countActiveSessions(nil)
	if count != 0 {
		t.Errorf("expected 0 for nil sessions, got %d", count)
	}
}
