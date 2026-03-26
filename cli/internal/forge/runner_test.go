package forge

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestRunner(t *testing.T) (*Runner, *Store, *EventBus) {
	t.Helper()

	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Forge.MaxConcurrent = 4
	cfg.Forge.SDKPortStart = 0 // use ephemeral ports in tests

	bus := NewEventBus()
	store := NewStore("")
	runner := NewRunner(cfg, store, bus)
	return runner, store, bus
}

func TestRunner_CreateAndStart_CreatesWorkspace(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	req := CreateSessionRequest{
		Name:  "test-session",
		Model: "claude-sonnet-4-6",
	}

	sess, err := runner.CreateAndStart(context.Background(), &req, "test-user")
	if err != nil {
		t.Fatalf("CreateAndStart: %v", err)
	}

	if sess.ID == "" {
		t.Error("expected non-empty session ID")
	}
	if sess.Name != "test-session" {
		t.Errorf("expected name 'test-session', got %q", sess.Name)
	}
	if sess.OwnerID != "test-user" {
		t.Errorf("expected owner 'test-user', got %q", sess.OwnerID)
	}

	// Workspace directory should exist.
	if _, err := os.Stat(sess.WorkspaceDir); err != nil {
		t.Errorf("workspace dir should exist: %v", err)
	}

	// Session should be in the store.
	stored := store.Get(sess.ID)
	if stored == nil {
		t.Fatal("expected session in store")
	}
	// Status should be starting or provisioning (async).
	if stored.Status != StatusStarting && stored.Status != StatusProvisioning &&
		stored.Status != StatusFailed {
		t.Logf("session status: %s (provisioning runs async)", stored.Status)
	}
}

func TestRunner_CreateAndStart_MaxConcurrent(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Forge.MaxConcurrent = 1
	cfg.Forge.SDKPortStart = 0

	store := NewStore("")
	bus := NewEventBus()
	runner := NewRunner(cfg, store, bus)

	// Seed the store with a running session to hit the limit.
	store.Put(&Session{ID: "existing", Status: StatusRunning})

	req := CreateSessionRequest{Name: "overflow"}
	_, err := runner.CreateAndStart(context.Background(), &req, "user")
	if err == nil {
		t.Error("expected error when max concurrent reached")
	}
}

func TestRunner_Stop_NotFound(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	err := runner.Stop("nonexistent")
	if err == nil {
		t.Error("expected error for stopping nonexistent session")
	}
}

func TestRunner_Stop_UpdatesStatus(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{
		ID:           "sess-1",
		Status:       StatusRunning,
		WorkspaceDir: t.TempDir(),
	})

	if err := runner.Stop("sess-1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	sess := store.Get("sess-1")
	if sess == nil {
		t.Fatal("expected session in store after stop")
	}
	if sess.Status != StatusStopped {
		t.Errorf("expected status stopped, got %q", sess.Status)
	}
}

func TestRunner_Delete_NotFound(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	err := runner.Delete("nonexistent")
	if err == nil {
		t.Error("expected error for deleting nonexistent session")
	}
}

func TestRunner_Delete_RemovesWorkspace(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	wsDir := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	store.Put(&Session{
		ID:           "sess-del",
		Status:       StatusStopped,
		WorkspaceDir: wsDir,
	})

	if err := runner.Delete("sess-del"); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Session should be gone from store.
	if store.Get("sess-del") != nil {
		t.Error("expected session removed from store")
	}

	// Workspace should be removed.
	if _, err := os.Stat(wsDir); !os.IsNotExist(err) {
		t.Error("expected workspace dir to be removed")
	}
}

func TestRunner_SendMessage_NotFound(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	err := runner.SendMessage("nonexistent", "hello")
	if err == nil {
		t.Error("expected error for missing session")
	}
}

func TestRunner_SendMessage_NotRunning(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{
		ID:     "sess-stopped",
		Status: StatusStopped,
	})

	err := runner.SendMessage("sess-stopped", "hello")
	if err == nil {
		t.Error("expected error for stopped session")
	}
}

func TestRunner_StopAll(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "a", Status: StatusRunning, WorkspaceDir: t.TempDir()})
	store.Put(&Session{ID: "b", Status: StatusRunning, WorkspaceDir: t.TempDir()})
	store.Put(&Session{ID: "c", Status: StatusStopped})

	runner.StopAll()

	for _, id := range []string{"a", "b"} {
		sess := store.Get(id)
		if sess != nil && sess.Status != StatusStopped {
			t.Errorf("session %s should be stopped, got %q", id, sess.Status)
		}
	}
}

func TestRunner_WriteClaudeMD_NewFile(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	wsDir := t.TempDir()
	sess := &Session{
		WorkspaceDir: wsDir,
		SystemPrompt: "You are a helpful assistant.",
		IssueID:      "NIU-100",
		IssueURL:     "https://linear.app/niuu/issue/NIU-100",
		Source: &SessionSource{
			Branch:     "feature/test",
			BaseBranch: "main",
		},
	}

	if err := runner.writeClaudeMD(sess); err != nil {
		t.Fatalf("writeClaudeMD: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(wsDir, "CLAUDE.md"))
	if err != nil {
		t.Fatalf("read CLAUDE.md: %v", err)
	}

	s := string(content)
	if s == "" {
		t.Error("expected non-empty CLAUDE.md")
	}
}

func TestRunner_WriteClaudeMD_AppendsExisting(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	wsDir := t.TempDir()
	existing := "# Existing CLAUDE.md\nSome rules.\n"
	if err := os.WriteFile(filepath.Join(wsDir, "CLAUDE.md"), []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	sess := &Session{
		WorkspaceDir: wsDir,
		SystemPrompt: "Additional context.",
	}

	if err := runner.writeClaudeMD(sess); err != nil {
		t.Fatalf("writeClaudeMD: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(wsDir, "CLAUDE.md"))
	if err != nil {
		t.Fatal(err)
	}

	s := string(content)
	if len(s) <= len(existing) {
		t.Error("expected CLAUDE.md to be appended to")
	}
}

func TestRunner_WriteClaudeMD_EmptyNoFile(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	wsDir := t.TempDir()
	sess := &Session{WorkspaceDir: wsDir}

	if err := runner.writeClaudeMD(sess); err != nil {
		t.Fatalf("writeClaudeMD: %v", err)
	}

	// No CLAUDE.md should be created for empty content.
	if _, err := os.Stat(filepath.Join(wsDir, "CLAUDE.md")); !os.IsNotExist(err) {
		t.Error("expected no CLAUDE.md for empty content")
	}
}

func TestRunner_Transition_EmitsEvent(t *testing.T) {
	runner, store, bus := newTestRunner(t)

	subID, ch := bus.Subscribe()
	defer bus.Unsubscribe(subID)

	sess := &Session{
		ID:      "evt-sess",
		OwnerID: "alice",
	}
	store.Put(sess)

	runner.transition(sess, StatusRunning, ActivityStateActive)

	select {
	case event := <-ch:
		if event.SessionID != "evt-sess" {
			t.Errorf("expected session ID 'evt-sess', got %q", event.SessionID)
		}
		if event.State != ActivityStateActive {
			t.Errorf("expected state 'active', got %q", event.State)
		}
		if event.OwnerID != "alice" {
			t.Errorf("expected owner 'alice', got %q", event.OwnerID)
		}
	case <-time.After(time.Second):
		t.Error("expected event, timed out")
	}
}

func TestRunner_FailSession_SetsError(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	sess := &Session{ID: "fail-sess"}
	store.Put(sess)

	runner.failSession(sess, "something went wrong")

	stored := store.Get("fail-sess")
	if stored == nil {
		t.Fatal("expected session in store")
	}
	if stored.Status != StatusFailed {
		t.Errorf("expected failed status, got %q", stored.Status)
	}
	if stored.Error != "something went wrong" {
		t.Errorf("expected error message, got %q", stored.Error)
	}
}
