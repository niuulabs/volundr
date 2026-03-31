package tyr

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewDispatcher(t *testing.T) {
	d := NewDispatcher("http://localhost:8080/")
	if d == nil {
		t.Fatal("expected non-nil dispatcher")
		return
	}
	if d.forgeURL != "http://localhost:8080" {
		t.Errorf("expected trailing slash stripped, got %q", d.forgeURL)
	}
}

func TestSpawnSession_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/volundr/sessions" {
			t.Errorf("expected /api/v1/volundr/sessions, got %s", r.URL.Path)
		}

		var req forgeCreateSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
			return
		}

		if req.Name == "" {
			t.Error("expected non-empty session name")
		}
		if req.Source == nil {
			t.Error("expected non-nil source")
		}
		if req.Source != nil && req.Source.Repo != "github.com/org/repo" {
			t.Errorf("expected repo 'github.com/org/repo', got %q", req.Source.Repo)
		}
		if req.InitialPrompt == "" {
			t.Error("expected non-empty initial prompt")
		}

		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(ForgeSessionResponse{
			ID:   "session-123",
			Name: req.Name,
		})
	}))
	defer server.Close()

	d := NewDispatcher(server.URL)
	raid := &Raid{
		ID:                 "raid-1",
		TrackerID:          "NIU-100",
		Name:               "Implement feature",
		Description:        "Build the thing",
		AcceptanceCriteria: []string{"it works", "tests pass"},
		CreatedAt:          time.Now(),
		UpdatedAt:          time.Now(),
	}
	saga := &Saga{
		ID:            "saga-1",
		Slug:          "my-project",
		Repos:         []string{"github.com/org/repo"},
		FeatureBranch: "feat/my-project",
		BaseBranch:    "main",
	}

	session, err := d.SpawnSession(context.Background(), raid, saga, "claude-sonnet-4-6")
	if err != nil {
		t.Fatalf("SpawnSession error: %v", err)
		return
	}
	if session.ID != "session-123" {
		t.Errorf("expected session ID 'session-123', got %q", session.ID)
	}
}

func TestSpawnSession_ForgeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"detail":"max sessions reached"}`))
	}))
	defer server.Close()

	d := NewDispatcher(server.URL)
	raid := &Raid{ID: "raid-1", TrackerID: "NIU-100", Name: "Test"}
	saga := &Saga{ID: "saga-1", Slug: "test", Repos: []string{"repo"}, BaseBranch: "main"}

	_, err := d.SpawnSession(context.Background(), raid, saga, "")
	if err == nil {
		t.Fatal("expected error from forge conflict")
		return
	}
	if !strings.Contains(err.Error(), "409") {
		t.Errorf("expected 409 in error, got: %v", err)
	}
}

func TestSpawnSession_EmptyRepos(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req forgeCreateSessionRequest
		_ = json.NewDecoder(r.Body).Decode(&req)

		if req.Source.Repo != "" {
			t.Errorf("expected empty repo, got %q", req.Source.Repo)
		}

		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(ForgeSessionResponse{ID: "s-1", Name: "test"})
	}))
	defer server.Close()

	d := NewDispatcher(server.URL)
	raid := &Raid{ID: "r-1", TrackerID: "NIU-1", Name: "Test"}
	saga := &Saga{ID: "s-1", Slug: "test", Repos: []string{}, BaseBranch: "main"}

	_, err := d.SpawnSession(context.Background(), raid, saga, "")
	if err != nil {
		t.Fatalf("SpawnSession error: %v", err)
		return
	}
}

func TestBuildDispatchPrompt(t *testing.T) {
	raid := &Raid{
		TrackerID:          "NIU-100",
		Name:               "Add login page",
		Description:        "Create a login page with email/password",
		AcceptanceCriteria: []string{"form validates input", "redirects on success"},
	}

	prompt := buildDispatchPrompt(raid, "github.com/org/repo", "feat/auth", "niu-100")

	if !strings.Contains(prompt, "NIU-100") {
		t.Error("prompt should contain tracker ID")
	}
	if !strings.Contains(prompt, "Add login page") {
		t.Error("prompt should contain raid name")
	}
	if !strings.Contains(prompt, "Create a login page") {
		t.Error("prompt should contain description")
	}
	if !strings.Contains(prompt, "form validates input") {
		t.Error("prompt should contain acceptance criteria")
	}
	if !strings.Contains(prompt, "feat/auth") {
		t.Error("prompt should contain feature branch")
	}
	if !strings.Contains(prompt, "niu-100") {
		t.Error("prompt should contain raid branch")
	}
	if !strings.Contains(prompt, "github.com/org/repo") {
		t.Error("prompt should contain repo")
	}
}

func TestBuildDispatchPrompt_MinimalRaid(t *testing.T) {
	raid := &Raid{
		TrackerID: "R1",
		Name:      "Simple task",
	}

	prompt := buildDispatchPrompt(raid, "", "feat/test", "r1")

	if !strings.Contains(prompt, "R1") {
		t.Error("prompt should contain tracker ID")
	}
	if !strings.Contains(prompt, "Simple task") {
		t.Error("prompt should contain name")
	}
	// Should not contain "Repository:" when repo is empty.
	if strings.Contains(prompt, "Repository:") {
		t.Error("prompt should not contain Repository: when repo is empty")
	}
}

func TestSpawnSession_FallbackBranch(t *testing.T) {
	var receivedName string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req forgeCreateSessionRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		receivedName = req.Name
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(ForgeSessionResponse{ID: "s-1", Name: req.Name})
	}))
	defer server.Close()

	d := NewDispatcher(server.URL)

	// Raid with empty TrackerID — should use first 8 chars of ID.
	raid := &Raid{ID: "12345678-abcd-efgh", TrackerID: "", Name: "Test"}
	saga := &Saga{ID: "s-1", Slug: "test", Repos: []string{"r1"}, BaseBranch: "main"}

	_, err := d.SpawnSession(context.Background(), raid, saga, "")
	if err != nil {
		t.Fatalf("SpawnSession error: %v", err)
		return
	}
	if receivedName != "12345678" {
		t.Errorf("expected session name '12345678', got %q", receivedName)
	}
}
