package forge

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Runner manages session lifecycles: workspace creation, git clone,
// Claude Code process spawning, and cleanup.
type Runner struct {
	cfg   *Config
	store *Store
	bus   *EventBus

	mu        sync.Mutex
	processes map[string]*exec.Cmd // session ID -> Claude Code process
}

// NewRunner creates a new session runner.
func NewRunner(cfg *Config, store *Store, bus *EventBus) *Runner {
	return &Runner{
		cfg:       cfg,
		store:     store,
		bus:       bus,
		processes: make(map[string]*exec.Cmd),
	}
}

// CreateAndStart creates a new session from the request, provisions its
// workspace, and starts the Claude Code process.
func (r *Runner) CreateAndStart(ctx context.Context, req CreateSessionRequest, ownerID string) (*Session, error) {
	if r.store.Count(StatusRunning) >= r.cfg.Forge.MaxConcurrent {
		return nil, fmt.Errorf("max concurrent sessions (%d) reached", r.cfg.Forge.MaxConcurrent)
	}

	now := time.Now().UTC()
	sess := &Session{
		ID:            newUUID(),
		Name:          req.Name,
		Model:         req.Model,
		Source:        req.Source,
		Status:        StatusCreated,
		SystemPrompt:  req.SystemPrompt,
		InitialPrompt: req.InitialPrompt,
		IssueID:       req.IssueID,
		IssueURL:      req.IssueURL,
		OwnerID:       ownerID,
		CreatedAt:     now,
		UpdatedAt:     now,
		LastActive:    now,
	}

	// Create workspace directory.
	wsDir := filepath.Join(r.cfg.Forge.WorkspacesDir, sess.ID)
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		return nil, fmt.Errorf("create workspace dir: %w", err)
	}
	sess.WorkspaceDir = wsDir

	sess.Status = StatusStarting
	r.store.Put(sess)
	r.bus.Emit(ActivityEvent{
		SessionID:     sess.ID,
		State:         "starting",
		OwnerID:       ownerID,
		SessionStatus: string(StatusStarting),
	})

	// Clone repo in background, then start Claude Code.
	go r.provision(ctx, sess)

	return sess, nil
}

// Stop gracefully stops a running session.
func (r *Runner) Stop(id string) error {
	sess := r.store.Get(id)
	if sess == nil {
		return fmt.Errorf("session %s not found", id)
	}

	sess.Status = StatusStopping
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)

	r.mu.Lock()
	cmd := r.processes[id]
	delete(r.processes, id)
	r.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		// Send SIGTERM, wait up to 10s, then SIGKILL.
		_ = cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			_ = cmd.Process.Kill()
		}
	}

	sess.Status = StatusStopped
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)
	r.bus.Emit(ActivityEvent{
		SessionID:     id,
		State:         "idle",
		OwnerID:       sess.OwnerID,
		SessionStatus: string(StatusStopped),
	})

	return nil
}

// Delete stops a session (if running) and removes its workspace.
func (r *Runner) Delete(id string) error {
	sess := r.store.Get(id)
	if sess == nil {
		return fmt.Errorf("session %s not found", id)
	}

	if sess.Status == StatusRunning || sess.Status == StatusStarting {
		_ = r.Stop(id)
	}

	// Remove workspace directory.
	if sess.WorkspaceDir != "" {
		_ = os.RemoveAll(sess.WorkspaceDir)
	}

	r.store.Delete(id)
	return nil
}

// SendMessage writes a message to the Claude Code process stdin.
func (r *Runner) SendMessage(id string, content string) error {
	sess := r.store.Get(id)
	if sess == nil {
		return fmt.Errorf("session %s not found", id)
	}
	if sess.Status != StatusRunning {
		return fmt.Errorf("session %s is not running (status: %s)", id, sess.Status)
	}

	// For now, write to a message file that the session's CLAUDE.md can
	// reference, or use the Claude CLI's stdin pipe. This will be enhanced
	// to use the SDK WebSocket transport when available.
	msgFile := filepath.Join(sess.WorkspaceDir, ".forge-message")
	if err := os.WriteFile(msgFile, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write message: %w", err)
	}

	sess.MessageCount++
	sess.LastActive = time.Now().UTC()
	r.store.Put(sess)

	return nil
}

// StopAll stops all running sessions (used during shutdown).
func (r *Runner) StopAll() {
	for _, sess := range r.store.List() {
		if sess.Status == StatusRunning || sess.Status == StatusStarting {
			_ = r.Stop(sess.ID)
		}
	}
}

// provision clones the repo and starts Claude Code. Runs in a goroutine.
func (r *Runner) provision(ctx context.Context, sess *Session) {
	sess.Status = StatusProvisioning
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)

	// Clone repo if source is git.
	if sess.Source != nil && sess.Source.Type == "git" {
		if err := r.gitClone(ctx, sess); err != nil {
			r.failSession(sess, fmt.Sprintf("git clone failed: %v", err))
			return
		}
	}

	// Write CLAUDE.md with system prompt and task context.
	if err := r.writeClaudeMD(sess); err != nil {
		r.failSession(sess, fmt.Sprintf("write CLAUDE.md failed: %v", err))
		return
	}

	// Start Claude Code process.
	if err := r.startClaude(ctx, sess); err != nil {
		r.failSession(sess, fmt.Sprintf("start claude failed: %v", err))
		return
	}

	sess.Status = StatusRunning
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)
	r.bus.Emit(ActivityEvent{
		SessionID:     sess.ID,
		State:         "active",
		OwnerID:       sess.OwnerID,
		SessionStatus: string(StatusRunning),
	})
}

// gitClone clones the repository into the workspace directory.
func (r *Runner) gitClone(ctx context.Context, sess *Session) error {
	repo := sess.Source.Repo
	branch := sess.Source.Branch
	if branch == "" {
		branch = "main"
	}

	// Build clone URL. If it looks like a shorthand (github.com/org/repo),
	// prepend https://.
	cloneURL := repo
	if !strings.Contains(cloneURL, "://") {
		cloneURL = "https://" + cloneURL
	}

	// Inject GitHub token for authenticated clones.
	ghToken := r.cfg.ResolveGitHubToken()
	if ghToken != "" && strings.Contains(cloneURL, "github.com") {
		cloneURL = strings.Replace(cloneURL, "https://", "https://x-access-token:"+ghToken+"@", 1)
	}

	args := []string{"clone", "--branch", branch, "--single-branch", "--depth", "50", cloneURL, "."}
	cmd := exec.CommandContext(ctx, "git", args...) //nolint:gosec // args are from validated session config
	cmd.Dir = sess.WorkspaceDir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w", strings.TrimSpace(string(output)), err)
	}

	return nil
}

// writeClaudeMD creates a CLAUDE.md file in the workspace with task context.
func (r *Runner) writeClaudeMD(sess *Session) error {
	var b strings.Builder

	if sess.SystemPrompt != "" {
		b.WriteString(sess.SystemPrompt)
		b.WriteString("\n\n")
	}

	if sess.IssueID != "" {
		b.WriteString(fmt.Sprintf("# Task: %s\n\n", sess.IssueID))
		if sess.IssueURL != "" {
			b.WriteString(fmt.Sprintf("Issue: %s\n\n", sess.IssueURL))
		}
	}

	if sess.Source != nil && sess.Source.Branch != "" {
		b.WriteString(fmt.Sprintf("Working branch: `%s`\n", sess.Source.Branch))
		if sess.Source.BaseBranch != "" {
			b.WriteString(fmt.Sprintf("Base branch: `%s`\n", sess.Source.BaseBranch))
		}
		b.WriteString("\n")
	}

	content := b.String()
	if content == "" {
		return nil
	}

	claudeMDPath := filepath.Join(sess.WorkspaceDir, "CLAUDE.md")
	// Only write if there isn't already one from the repo.
	if _, err := os.Stat(claudeMDPath); err == nil {
		// Append to existing CLAUDE.md.
		f, err := os.OpenFile(claudeMDPath, os.O_APPEND|os.O_WRONLY, 0o644) //nolint:gosec // workspace file
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = f.WriteString("\n\n# Forge Session Context\n\n" + content)
		return err
	}

	return os.WriteFile(claudeMDPath, []byte(content), 0o644) //nolint:gosec // workspace file
}

// startClaude spawns the Claude Code CLI process in the workspace.
func (r *Runner) startClaude(ctx context.Context, sess *Session) error {
	claudeBin := r.cfg.Forge.ClaudeBinary
	if claudeBin == "" {
		claudeBin = "claude"
	}

	args := []string{}
	if sess.InitialPrompt != "" {
		args = append(args, "--print", sess.InitialPrompt)
	}
	if sess.Model != "" {
		args = append(args, "--model", sess.Model)
	}

	cmd := exec.CommandContext(ctx, claudeBin, args...) //nolint:gosec // binary path from trusted config
	cmd.Dir = sess.WorkspaceDir

	env := os.Environ()
	if apiKey := r.cfg.ResolveAnthropicKey(); apiKey != "" {
		env = append(env, "ANTHROPIC_API_KEY="+apiKey)
	}
	cmd.Env = env

	// Log stdout/stderr to workspace.
	logPath := filepath.Join(sess.WorkspaceDir, ".forge-claude.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) //nolint:gosec // workspace log
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("start claude: %w", err)
	}

	r.mu.Lock()
	r.processes[sess.ID] = cmd
	r.mu.Unlock()

	// Monitor the process in the background.
	go r.monitor(sess.ID, cmd, logFile)

	return nil
}

// monitor waits for the Claude process to exit and updates session state.
func (r *Runner) monitor(sessionID string, cmd *exec.Cmd, logFile *os.File) {
	defer func() { _ = logFile.Close() }()

	err := cmd.Wait()

	r.mu.Lock()
	delete(r.processes, sessionID)
	r.mu.Unlock()

	sess := r.store.Get(sessionID)
	if sess == nil {
		return
	}

	// If we didn't explicitly stop it, it completed or failed.
	if sess.Status == StatusRunning {
		if err != nil {
			sess.Status = StatusFailed
			sess.Error = fmt.Sprintf("claude exited: %v", err)
		} else {
			sess.Status = StatusStopped
		}
		sess.UpdatedAt = time.Now().UTC()
		r.store.Put(sess)
		r.bus.Emit(ActivityEvent{
			SessionID:     sessionID,
			State:         "idle",
			OwnerID:       sess.OwnerID,
			SessionStatus: string(sess.Status),
		})
	}
}

// newUUID generates a random UUID v4 string.
// TODO: replace with github.com/google/uuid after go mod tidy.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// failSession marks a session as failed with the given error message.
func (r *Runner) failSession(sess *Session, errMsg string) {
	sess.Status = StatusFailed
	sess.Error = errMsg
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)
	r.bus.Emit(ActivityEvent{
		SessionID:     sess.ID,
		State:         "idle",
		OwnerID:       sess.OwnerID,
		SessionStatus: string(StatusFailed),
		Metadata:      map[string]any{"error": errMsg},
	})
}
