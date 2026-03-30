package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
)

// Runner manages session lifecycles: workspace creation, git clone,
// Claude Code process spawning, and cleanup.
type Runner struct {
	cfg   *Config
	store SessionStore
	bus   EventEmitter

	mu         sync.Mutex
	processes  map[string]*exec.Cmd     // session ID -> Claude Code process
	transports map[string]*SDKTransport // session ID -> SDK WebSocket transport
	nextPort   int                      // next SDK port to allocate
}

// Compile-time check that Runner satisfies SessionRunner.
var _ SessionRunner = (*Runner)(nil)

// NewRunner creates a new session runner.
func NewRunner(cfg *Config, store SessionStore, bus EventEmitter) *Runner {
	return &Runner{
		cfg:        cfg,
		store:      store,
		bus:        bus,
		processes:  make(map[string]*exec.Cmd),
		transports: make(map[string]*SDKTransport),
		nextPort:   cfg.Forge.SDKPortStart,
	}
}

// allocatePort returns the next available SDK port for a session.
func (r *Runner) allocatePort() int {
	port := r.nextPort
	r.nextPort++
	return port
}

// CreateAndStart creates a new session from the request, provisions its
// workspace, and starts the Claude Code process.
func (r *Runner) CreateAndStart(ctx context.Context, req *CreateSessionRequest, ownerID string) (*Session, error) {
	if r.store.Count(StatusRunning) >= r.cfg.Forge.MaxConcurrent {
		return nil, fmt.Errorf("max concurrent sessions (%d) reached", r.cfg.Forge.MaxConcurrent)
	}

	now := time.Now().UTC()
	sess := &Session{
		ID:            uuid.New().String(),
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

	// Set workspace directory.
	if req.Source != nil && req.Source.Type == "local_mount" && req.Source.LocalPath != "" {
		// Local mount: use the existing directory directly.
		info, err := os.Stat(req.Source.LocalPath)
		if err != nil {
			return nil, fmt.Errorf("local path %q: %w", req.Source.LocalPath, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("local path %q is not a directory", req.Source.LocalPath)
		}
		sess.WorkspaceDir = req.Source.LocalPath
	} else {
		wsDir := filepath.Join(r.cfg.Forge.WorkspacesDir, sess.ID)
		if err := os.MkdirAll(wsDir, 0o750); err != nil { //nolint:gosec // path from trusted config
			return nil, fmt.Errorf("create workspace dir: %w", err)
		}
		sess.WorkspaceDir = wsDir
	}

	r.transition(sess, StatusStarting, ActivityStateStarting)

	// Provision in background with a detached context — the HTTP request
	// context would cancel as soon as the response is sent.
	go r.provision(context.Background(), sess)

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
	transport := r.transports[id]
	delete(r.transports, id)
	r.mu.Unlock()

	if transport != nil {
		transport.Stop()
	}

	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Signal(syscall.SIGTERM)
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(r.cfg.Forge.StopTimeout):
			_ = cmd.Process.Kill()
		}
	}

	r.transition(sess, StatusStopped, ActivityStateIdle)

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

	// Remove workspace directory — but never delete a local mount (user's project).
	isLocalMount := sess.Source != nil && sess.Source.Type == "local_mount"
	if sess.WorkspaceDir != "" && !isLocalMount {
		_ = os.RemoveAll(sess.WorkspaceDir) //nolint:gosec // path from trusted session state
	}

	r.store.Delete(id)
	return nil
}

// SendMessage sends a message to the Claude Code process via SDK WebSocket.
func (r *Runner) SendMessage(id, content string) error {
	sess := r.store.Get(id)
	if sess == nil {
		return fmt.Errorf("session %s: %w", id, ErrSessionNotFound)
	}
	if sess.Status != StatusRunning {
		return fmt.Errorf("session %s (status: %s): %w", id, sess.Status, ErrSessionNotRunning)
	}

	r.mu.Lock()
	transport := r.transports[id]
	r.mu.Unlock()

	if transport == nil {
		return fmt.Errorf("session %s: no active transport", id)
	}

	if err := transport.SendMessage(content); err != nil {
		return fmt.Errorf("send message via sdk: %w", err)
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

// Methods that expose store/bus through the SessionRunner interface.

// ListSessions returns all sessions from the store.
func (r *Runner) ListSessions() []*Session {
	return r.store.List()
}

// GetSession returns a session by ID, or nil if not found.
func (r *Runner) GetSession(id string) *Session {
	return r.store.Get(id)
}

// GetStats returns aggregate session statistics.
func (r *Runner) GetStats() StatsResponse {
	return StatsResponse{
		ActiveSessions: r.store.Count(StatusRunning),
		TotalSessions:  r.store.Count(""),
	}
}

// GetPRStatus detects PR status by running `gh pr view` in the session workspace.
func (r *Runner) GetPRStatus(id string) (PRStatusResponse, error) {
	sess := r.store.Get(id)
	if sess == nil {
		return PRStatusResponse{}, fmt.Errorf("session %s not found", id)
	}

	return r.detectPR(sess), nil
}

// GetChronicle reads the Claude log for a session and returns a summary.
func (r *Runner) GetChronicle(id string) (string, error) {
	sess := r.store.Get(id)
	if sess == nil {
		return "", fmt.Errorf("session %s not found", id)
	}

	return r.readChronicle(sess), nil
}

// SubscribeActivity returns a channel that receives activity events.
func (r *Runner) SubscribeActivity() (id string, ch <-chan ActivityEvent) {
	return r.bus.Subscribe()
}

// UnsubscribeActivity removes an activity subscription.
func (r *Runner) UnsubscribeActivity(id string) {
	r.bus.Unsubscribe(id)
}

// Internal methods for session lifecycle management.

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

	r.transition(sess, StatusRunning, ActivityStateActive)
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
		fmt.Fprintf(&b, "# Task: %s\n\n", sess.IssueID)
		if sess.IssueURL != "" {
			fmt.Fprintf(&b, "Issue: %s\n\n", sess.IssueURL)
		}
	}

	if sess.Source != nil && sess.Source.Branch != "" {
		fmt.Fprintf(&b, "Working branch: `%s`\n", sess.Source.Branch)
		if sess.Source.BaseBranch != "" {
			fmt.Fprintf(&b, "Base branch: `%s`\n", sess.Source.BaseBranch)
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
		_, writeErr := f.WriteString("\n\n# Forge Session Context\n\n" + content)
		if closeErr := f.Close(); closeErr != nil && writeErr == nil {
			return closeErr
		}
		return writeErr
	}

	return os.WriteFile(claudeMDPath, []byte(content), 0o644) //nolint:gosec // workspace file
}

// startClaude spawns the Claude Code CLI process with --sdk-url for
// WebSocket-based communication.
func (r *Runner) startClaude(ctx context.Context, sess *Session) error {
	claudeBin := r.cfg.Forge.ClaudeBinary
	if claudeBin == "" {
		claudeBin = "claude"
	}

	// Start SDK WebSocket transport so Claude Code can connect back.
	r.mu.Lock()
	port := r.allocatePort()
	r.mu.Unlock()

	transport := NewSDKTransport(sess.ID, port, r.bus)
	if err := transport.Start(); err != nil {
		return fmt.Errorf("start sdk transport: %w", err)
	}

	args := []string{
		"--sdk-url", transport.SDKURL(),
		"--output-format", "stream-json",
		"--input-format", "stream-json",
		"--verbose",
	}
	if sess.Model != "" {
		args = append(args, "--model", sess.Model)
	}
	if sess.SystemPrompt != "" {
		args = append(args, "--append-system-prompt", sess.SystemPrompt)
	}
	if sess.InitialPrompt != "" {
		args = append(args, "--print", sess.InitialPrompt)
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
		transport.Stop()
		return fmt.Errorf("open log file: %w", err)
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		transport.Stop()
		return fmt.Errorf("start claude: %w", err)
	}

	r.mu.Lock()
	r.processes[sess.ID] = cmd
	r.transports[sess.ID] = transport
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
	transport := r.transports[sessionID]
	delete(r.transports, sessionID)
	r.mu.Unlock()

	if transport != nil {
		transport.Stop()
	}

	sess := r.store.Get(sessionID)
	if sess == nil {
		return
	}

	// If we didn't explicitly stop it, it completed or failed.
	if sess.Status == StatusRunning {
		if err != nil {
			sess.Error = fmt.Sprintf("claude exited: %v", err)
			r.transition(sess, StatusFailed, ActivityStateIdle)
		} else {
			r.transition(sess, StatusStopped, ActivityStateIdle)
		}
	}
}

// detectPR runs `gh pr view --json` in the session workspace.
func (r *Runner) detectPR(sess *Session) PRStatusResponse {
	if sess.WorkspaceDir == "" {
		return PRStatusResponse{State: ActivityStateNone}
	}

	cmd := exec.CommandContext(context.Background(), "gh", "pr", "view", "--json", "number,url,state,mergeable,statusCheckRollup") //nolint:gosec // fixed args
	cmd.Dir = sess.WorkspaceDir
	output, err := cmd.Output()
	if err != nil {
		return PRStatusResponse{State: ActivityStateNone}
	}

	var pr struct {
		Number    int    `json:"number"`
		URL       string `json:"url"`
		State     string `json:"state"`
		Mergeable string `json:"mergeable"`
		Checks    []struct {
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
		} `json:"statusCheckRollup"`
	}
	if err := json.Unmarshal(output, &pr); err != nil {
		return PRStatusResponse{State: ActivityStateNone}
	}

	ciPassed := true
	for _, check := range pr.Checks {
		if check.Conclusion != "SUCCESS" && check.Conclusion != "NEUTRAL" && check.Conclusion != "SKIPPED" {
			ciPassed = false
			break
		}
	}

	return PRStatusResponse{
		PRID:      fmt.Sprintf("%d", pr.Number),
		URL:       pr.URL,
		State:     strings.ToLower(pr.State),
		Mergeable: strings.EqualFold(pr.Mergeable, "MERGEABLE"),
		CIPassed:  &ciPassed,
	}
}

// readChronicle reads the Claude log and returns a summary.
func (r *Runner) readChronicle(sess *Session) string {
	logPath := filepath.Join(sess.WorkspaceDir, ".forge-claude.log")
	cmd := exec.CommandContext(context.Background(), "tail", "-100", logPath) //nolint:gosec // fixed args, path from trusted session state
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(output)
}

// transition updates a session's status, persists it, and emits an activity event.
func (r *Runner) transition(sess *Session, status SessionStatus, activityState string) {
	sess.Status = status
	sess.UpdatedAt = time.Now().UTC()
	r.store.Put(sess)
	event := ActivityEvent{
		SessionID:     sess.ID,
		State:         activityState,
		OwnerID:       sess.OwnerID,
		SessionStatus: string(status),
	}
	if sess.Error != "" && status == StatusFailed {
		event.Metadata = map[string]any{"error": sess.Error}
	}
	r.bus.Emit(event)
}

// failSession marks a session as failed with the given error message.
func (r *Runner) failSession(sess *Session, errMsg string) {
	sess.Error = errMsg
	r.transition(sess, StatusFailed, ActivityStateIdle)
}
