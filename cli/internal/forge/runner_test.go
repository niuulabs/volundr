package forge

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
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
		return
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
		return
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
		return
	}

	sess := store.Get("sess-1")
	if sess == nil {
		t.Fatal("expected session in store after stop")
		return
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
		return
	}

	store.Put(&Session{
		ID:           "sess-del",
		Status:       StatusStopped,
		WorkspaceDir: wsDir,
	})

	if err := runner.Delete("sess-del"); err != nil {
		t.Fatalf("Delete: %v", err)
		return
	}

	// Session should be gone from store.
	if store.Get("sess-del") != nil {
		t.Error("expected session removed from store")
	}

	// In mini mode, workspaces are preserved (not deleted).
	if _, err := os.Stat(wsDir); os.IsNotExist(err) {
		t.Error("expected workspace dir to be preserved in mini mode")
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
		return
	}

	content, err := os.ReadFile(filepath.Join(wsDir, "CLAUDE.md"))
	if err != nil {
		t.Fatalf("read CLAUDE.md: %v", err)
		return
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
		return
	}

	sess := &Session{
		WorkspaceDir: wsDir,
		SystemPrompt: "Additional context.",
	}

	if err := runner.writeClaudeMD(sess); err != nil {
		t.Fatalf("writeClaudeMD: %v", err)
		return
	}

	content, err := os.ReadFile(filepath.Join(wsDir, "CLAUDE.md"))
	if err != nil {
		t.Fatal(err)
		return
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
		return
	}

	// No CLAUDE.md should be created for empty content.
	if _, err := os.Stat(filepath.Join(wsDir, "CLAUDE.md")); !os.IsNotExist(err) {
		t.Error("expected no CLAUDE.md for empty content")
	}
}

func TestRunner_Provision_GitCloneFailure(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	req := CreateSessionRequest{
		Name:  "git-session",
		Model: "claude-sonnet-4-6",
		Source: &SessionSource{
			Type:   "git",
			Repo:   "https://example.com/nonexistent/repo.git",
			Branch: "main",
		},
	}

	sess, err := runner.CreateAndStart(context.Background(), &req, "test-user")
	if err != nil {
		t.Fatalf("CreateAndStart: %v", err)
		return
	}

	// Wait for provision goroutine to fail.
	deadline := time.After(10 * time.Second)
	for {
		stored := store.Get(sess.ID)
		if stored != nil && stored.Status == StatusFailed {
			if stored.Error == "" {
				t.Error("expected error message on failed session")
			}
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for provision failure; status=%s", stored.Status)
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func TestRunner_Provision_NoClaude(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	// No source — skips git clone. But startClaude will fail (no binary).
	req := CreateSessionRequest{
		Name:          "no-claude",
		SystemPrompt:  "test prompt",
		InitialPrompt: "hello",
	}

	sess, err := runner.CreateAndStart(context.Background(), &req, "test-user")
	if err != nil {
		t.Fatalf("CreateAndStart: %v", err)
		return
	}

	// Wait for provision to fail due to missing claude binary.
	deadline := time.After(10 * time.Second)
	for {
		stored := store.Get(sess.ID)
		if stored != nil && stored.Status == StatusFailed {
			break
		}
		if stored != nil && stored.Status == StatusRunning {
			// If somehow claude exists and starts, that's fine too.
			break
		}
		select {
		case <-deadline:
			if stored != nil {
				t.Fatalf("timed out; status=%s error=%s", stored.Status, stored.Error)
				return
			}
			t.Fatal("timed out; session not found")
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func TestRunner_WriteClaudeMD_AppendError(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	wsDir := t.TempDir()
	claudePath := filepath.Join(wsDir, "CLAUDE.md")
	if err := os.WriteFile(claudePath, []byte("existing"), 0o400); err != nil {
		t.Fatal(err)
		return
	}

	sess := &Session{
		WorkspaceDir: wsDir,
		SystemPrompt: "New content.",
	}

	err := runner.writeClaudeMD(sess)
	if err == nil {
		t.Error("expected error when CLAUDE.md is read-only")
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
		return
	}
	if stored.Status != StatusFailed {
		t.Errorf("expected failed status, got %q", stored.Status)
	}
	if stored.Error != "something went wrong" {
		t.Errorf("expected error message, got %q", stored.Error)
	}
}

func TestRunner_ListSessions(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "a", Status: StatusRunning})
	store.Put(&Session{ID: "b", Status: StatusStopped})

	sessions := runner.ListSessions()
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

func TestRunner_GetSession(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "s1", Name: "test", Status: StatusRunning})

	sess := runner.GetSession("s1")
	if sess == nil {
		t.Fatal("expected session")
		return
	}
	if sess.Name != "test" {
		t.Errorf("expected name 'test', got %q", sess.Name)
	}

	if runner.GetSession("nonexistent") != nil {
		t.Error("expected nil for nonexistent session")
	}
}

func TestRunner_GetStats(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "a", Status: StatusRunning})
	store.Put(&Session{ID: "b", Status: StatusStopped})
	store.Put(&Session{ID: "c", Status: StatusRunning})

	stats := runner.GetStats()
	if stats.ActiveSessions != 2 {
		t.Errorf("expected 2 active, got %d", stats.ActiveSessions)
	}
	if stats.TotalSessions != 3 {
		t.Errorf("expected 3 total, got %d", stats.TotalSessions)
	}
}

func TestRunner_SubscribeUnsubscribeActivity(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	id, ch := runner.SubscribeActivity()
	if id == "" {
		t.Error("expected non-empty subscription ID")
	}
	if ch == nil {
		t.Error("expected non-nil channel")
	}

	runner.UnsubscribeActivity(id)
}

func TestRunner_GetPRStatus_NotFound(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	_, err := runner.GetPRStatus("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestRunner_GetChronicle_NotFound(t *testing.T) {
	runner, _, _ := newTestRunner(t)

	_, err := runner.GetChronicle("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestRunner_GetPRStatus_NoWorkspace(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "s1", Status: StatusRunning, WorkspaceDir: ""})

	pr, err := runner.GetPRStatus("s1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if pr.State != ActivityStateNone {
		t.Errorf("expected state 'none', got %q", pr.State)
	}
}

func TestRunner_GetChronicle_EmptyLog(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	wsDir := t.TempDir()
	store.Put(&Session{ID: "s1", Status: StatusRunning, WorkspaceDir: wsDir})

	summary, err := runner.GetChronicle("s1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	// No log file exists, so chronicle should be empty.
	if summary != "" {
		t.Errorf("expected empty chronicle, got %q", summary)
	}
}

func TestRunner_GetChronicle_WithLog(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	wsDir := t.TempDir()
	logContent := "session started\nassistant: hello\n"
	if err := os.WriteFile(filepath.Join(wsDir, ".forge-claude.log"), []byte(logContent), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	store.Put(&Session{ID: "s1", Status: StatusRunning, WorkspaceDir: wsDir})

	summary, err := runner.GetChronicle("s1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if summary == "" {
		t.Error("expected non-empty chronicle")
	}
}

func TestRunner_Delete_StopsRunningSession(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	wsDir := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(wsDir, 0o750); err != nil {
		t.Fatal(err)
		return
	}

	store.Put(&Session{
		ID:           "sess-running",
		Status:       StatusRunning,
		WorkspaceDir: wsDir,
	})

	if err := runner.Delete("sess-running"); err != nil {
		t.Fatalf("Delete: %v", err)
		return
	}

	if store.Get("sess-running") != nil {
		t.Error("expected session removed from store")
	}
}

func TestRunner_SendMessage_WithTransportNoConnection(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	transport := NewSDKTransport("s1", 0, runner.bus.(*EventBus))
	if err := transport.Start(); err != nil {
		t.Fatal(err)
		return
	}
	defer transport.Stop()

	store.Put(&Session{ID: "s1", Status: StatusRunning})
	runner.mu.Lock()
	runner.transports["s1"] = transport
	runner.mu.Unlock()

	// No CLI connected, so SendMessage should return an error.
	err := runner.SendMessage("s1", "hello")
	if err == nil {
		t.Error("expected error when CLI not connected")
	}
}

func TestRunner_SendMessage_WithConnectedClient(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	transport := NewSDKTransport("s1", 0, runner.bus.(*EventBus))
	if err := transport.Start(); err != nil {
		t.Fatal(err)
		return
	}
	defer transport.Stop()

	store.Put(&Session{ID: "s1", Status: StatusRunning})
	runner.mu.Lock()
	runner.transports["s1"] = transport
	runner.mu.Unlock()

	// Connect a WebSocket client.
	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/s1", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
		return
	}

	// Now SendMessage should succeed.
	if err := runner.SendMessage("s1", "hello from test"); err != nil {
		t.Fatalf("SendMessage: %v", err)
		return
	}

	// Verify message count was incremented.
	sess := store.Get("s1")
	if sess == nil {
		t.Fatal("expected session in store")
		return
	}
	if sess.MessageCount != 1 {
		t.Errorf("expected message count 1, got %d", sess.MessageCount)
	}
}

func TestRunner_SendMessage_NoTransport(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{ID: "s1", Status: StatusRunning})

	err := runner.SendMessage("s1", "hello")
	if err == nil {
		t.Error("expected error when no transport")
	}
}

func TestRunner_Stop_WithTransport(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	transport := NewSDKTransport("s1", 0, runner.bus.(*EventBus))
	if err := transport.Start(); err != nil {
		t.Fatal(err)
		return
	}

	wsDir := t.TempDir()
	store.Put(&Session{ID: "s1", Status: StatusRunning, WorkspaceDir: wsDir})
	runner.mu.Lock()
	runner.transports["s1"] = transport
	runner.mu.Unlock()

	if err := runner.Stop("s1"); err != nil {
		t.Fatalf("Stop: %v", err)
		return
	}

	sess := store.Get("s1")
	if sess == nil {
		t.Fatal("expected session in store")
		return
	}
	if sess.Status != StatusStopped {
		t.Errorf("expected stopped, got %q", sess.Status)
	}
}

func TestRunner_GetPRStatus_NoGitWorkspace(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	wsDir := t.TempDir()
	store.Put(&Session{ID: "s1", Status: StatusRunning, WorkspaceDir: wsDir})

	pr, err := runner.GetPRStatus("s1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	// gh pr view will fail in non-git dir, should return none state.
	if pr.State != ActivityStateNone {
		t.Errorf("expected state 'none', got %q", pr.State)
	}
}

func TestRunner_Delete_NoWorkspaceDir(t *testing.T) {
	runner, store, _ := newTestRunner(t)

	store.Put(&Session{
		ID:           "sess-nowsdir",
		Status:       StatusStopped,
		WorkspaceDir: "",
	})

	if err := runner.Delete("sess-nowsdir"); err != nil {
		t.Fatalf("Delete: %v", err)
		return
	}

	if store.Get("sess-nowsdir") != nil {
		t.Error("expected session removed from store")
	}
}
