package forge

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/niuulabs/volundr/cli/internal/broker"
	"github.com/niuulabs/volundr/cli/internal/tracker"
	"github.com/niuulabs/volundr/cli/internal/tyr"
	"github.com/niuulabs/volundr/cli/internal/web"
)

// Server is the main forge server that ties together the store, runner,
// event bus, auth, and HTTP handler.
type Server struct {
	cfg    *Config
	store  SessionStore
	runner *Runner
	bus    EventEmitter
	auth   *PATAuth
	srv    *http.Server
	tyrSrv *tyr.Server
	cancel context.CancelFunc // triggers graceful shutdown when called
}

// NewServer creates a new forge server from the given config.
func NewServer(cfg *Config) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	// Ensure workspaces directory exists.
	if err := os.MkdirAll(cfg.Forge.WorkspacesDir, 0o750); err != nil {
		return nil, fmt.Errorf("create workspaces dir: %w", err)
	}

	bus := NewEventBus()
	store := NewStore(cfg.Forge.StateFile)
	runner := NewRunner(cfg, store, bus)
	auth := NewPATAuth(&cfg.Auth)

	return &Server{
		cfg:    cfg,
		store:  store,
		runner: runner,
		bus:    bus,
		auth:   auth,
	}, nil
}

// Run starts the HTTP server and blocks until interrupted.
func (s *Server) Run(ctx context.Context) error {
	mux := http.NewServeMux()

	// Initialize tracker for issue search if Linear is configured.
	var t tracker.Tracker
	if s.cfg.Tyr.LinearAPIKey != "" {
		t = tracker.NewLinearTracker(tracker.LinearConfig{
			APIKey: s.cfg.Tyr.LinearAPIKey,
			TeamID: s.cfg.Tyr.LinearTeamID,
		})
	}

	handler := NewHandler(s.runner, s.cfg, t)
	handler.RegisterRoutes(mux)

	// Admin shutdown endpoint — localhost-only, no auth.
	mux.HandleFunc("POST /admin/shutdown", s.handleShutdown)

	// Mount tyr-mini routes if enabled.
	if s.cfg.Tyr.Enabled {
		if err := s.initTyr(ctx, mux); err != nil {
			return fmt.Errorf("init tyr-mini: %w", err)
		}
		defer func() {
			if s.tyrSrv != nil {
				_ = s.tyrSrv.Close()
			}
		}()
	}

	// Catch-all for unimplemented API paths — return JSON 404 instead of
	// falling through to the SPA handler which would return HTML.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"detail":"not found"}` + "\n"))
	})

	addr := fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)

	if s.cfg.Web {
		webCfg := &web.RuntimeConfig{APIBaseURL: fmt.Sprintf("http://%s", addr)}
		mux.Handle("/", web.Handler(webCfg))
	}

	s.srv = &http.Server{
		Addr:              addr,
		Handler:           s.auth.Wrap(mux),
		ReadHeaderTimeout: s.cfg.Listen.ReadHeaderTimeout,
	}

	// Graceful shutdown on signals or cancel.
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() { //nolint:gosec // shutdown handler must outlive request context
		<-ctx.Done()
		log.Println("shutting down...")
		s.runner.StopAll()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), s.cfg.Listen.ShutdownTimeout)
		defer shutdownCancel()
		_ = s.srv.Shutdown(shutdownCtx)
	}()

	log.Printf("forge listening on %s", addr)
	log.Printf("  workspaces: %s", s.cfg.Forge.WorkspacesDir)
	log.Printf("  max concurrent sessions: %d", s.cfg.Forge.MaxConcurrent)
	log.Printf("  auth mode: %s", s.cfg.Auth.Mode)
	log.Printf("  web ui: %v", s.cfg.Web)
	log.Printf("  tyr-mini: %v", s.cfg.Tyr.Enabled)

	if s.cfg.Listen.Host == "0.0.0.0" && s.cfg.Auth.Mode == "none" {
		log.Println("WARNING: listening on all interfaces with auth=none — any network client can create sessions")
	}
	if s.cfg.Auth.Mode == "none" {
		log.Println("WARNING: authentication disabled — all requests are unauthenticated")
	}

	if IsMacOS() {
		installs := DetectXcodeInstallations(s.cfg.Forge.Xcode.SearchPaths)
		if len(installs) > 0 {
			for _, inst := range installs {
				marker := "  "
				if inst.Active {
					marker = "* "
				}
				log.Printf("  xcode: %s%s (%s) — %s", marker, inst.Version, inst.Build, inst.Path)
			}
		} else {
			log.Println("  xcode: not found")
		}
	}

	if err := s.srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

// handleShutdown handles POST /admin/shutdown. It initiates graceful
// shutdown: stops all sessions, then shuts down the HTTP server.
func (s *Server) handleShutdown(w http.ResponseWriter, _ *http.Request) {
	log.Println("shutdown requested via /admin/shutdown")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"shutting_down"}` + "\n"))

	// Trigger shutdown asynchronously so the response can be sent.
	go s.cancel()
}

// initTyr initializes the tyr-mini server, runs migrations, and mounts routes.
func (s *Server) initTyr(ctx context.Context, mux *http.ServeMux) error {
	addr := fmt.Sprintf("http://%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)
	var tyrModels []tyr.AIModel
	for _, m := range s.cfg.AIModels {
		tyrModels = append(tyrModels, tyr.AIModel{ID: m.ID, Name: m.Name})
	}

	tyrCfg := &tyr.Config{
		Enabled:      true,
		DatabaseDSN:  s.cfg.Tyr.DatabaseDSN,
		ForgeURL:     addr,
		LinearAPIKey:        s.cfg.Tyr.LinearAPIKey,
		LinearTeamID:        s.cfg.Tyr.LinearTeamID,
		AIModels:            tyrModels,
		DefaultSystemPrompt: s.cfg.Tyr.DefaultSystemPrompt,
	}

	tyrSrv, err := tyr.NewServer(tyrCfg)
	if err != nil {
		return fmt.Errorf("create tyr-mini server: %w", err)
	}

	applied, err := tyrSrv.RunMigrations(ctx)
	if err != nil {
		_ = tyrSrv.Close()
		return fmt.Errorf("run tyr migrations: %w", err)
	}
	if applied > 0 {
		log.Printf("tyr-mini: applied %d migrations", applied)
	}

	tyrSrv.RegisterRoutes(mux)
	s.tyrSrv = tyrSrv

	// Start background services (activity subscriber + review engine).
	eventAdapter := &tyrEventAdapter{bus: s.bus}
	prAdapter := &tyrPRAdapter{runner: s.runner}
	spawnerAdapter := &tyrSpawnerAdapter{runner: s.runner, forgeURL: addr}
	tyrSrv.StartBackground(eventAdapter, prAdapter, spawnerAdapter)

	log.Println("tyr-mini: routes registered on /api/v1/tyr/*")
	return nil
}

// --- Adapters to satisfy tyr interfaces without import cycles ---

type tyrEventAdapter struct {
	bus EventEmitter
}

func (a *tyrEventAdapter) Subscribe() (string, <-chan tyr.SessionEvent) {
	id, ch := a.bus.Subscribe()
	out := make(chan tyr.SessionEvent, 64)
	go func() {
		for evt := range ch {
			out <- tyr.SessionEvent{
				SessionID:     evt.SessionID,
				State:         evt.State,
				SessionStatus: evt.SessionStatus,
				OwnerID:       evt.OwnerID,
				Metadata:      evt.Metadata,
			}
		}
		close(out)
	}()
	return id, out
}

func (a *tyrEventAdapter) Unsubscribe(id string) {
	a.bus.Unsubscribe(id)
}

type tyrPRAdapter struct {
	runner *Runner
}

func (a *tyrPRAdapter) GetPRStatus(sessionID string) (tyr.PRCheckResult, error) {
	pr, err := a.runner.GetPRStatus(sessionID)
	if err != nil {
		return tyr.PRCheckResult{}, err
	}
	ciPassed := false
	if pr.CIPassed != nil {
		ciPassed = *pr.CIPassed
	}
	return tyr.PRCheckResult{
		URL:       pr.URL,
		PRID:      pr.PRID,
		State:     pr.State,
		Mergeable: pr.Mergeable,
		CIPassed:  ciPassed,
	}, nil
}

type tyrSpawnerAdapter struct {
	runner   *Runner
	forgeURL string
}

func (a *tyrSpawnerAdapter) SpawnReviewerSession(raid *tyr.Raid, saga *tyr.Saga, model, systemPrompt, initialPrompt string) (string, error) {
	// Create session via Forge.
	req := &CreateSessionRequest{
		Name:          "review-" + strings.ToLower(raid.Identifier),
		Model:         model,
		SystemPrompt:  systemPrompt,
		InitialPrompt: initialPrompt,
		IssueID:       raid.Identifier,
		IssueURL:      raid.URL,
	}
	if len(saga.Repos) > 0 {
		req.Source = &SessionSource{
			Type:       "git",
			Repo:       saga.Repos[0],
			Branch:     saga.FeatureBranch,
			BaseBranch: saga.BaseBranch,
		}
	}
	sess, err := a.runner.CreateAndStart(context.Background(), req, "tyr-reviewer")
	if err != nil {
		return "", err
	}
	return sess.ID, nil
}

func (a *tyrSpawnerAdapter) SendMessage(sessionID, content string) error {
	return a.runner.SendMessage(sessionID, content)
}

func (a *tyrSpawnerAdapter) GetLastAssistantMessage(sessionID string) (string, error) {
	b := a.runner.GetBroker(sessionID)
	if b == nil {
		return "", fmt.Errorf("no broker for session %s", sessionID)
	}
	history := b.ConversationHistory()
	turns, _ := history["turns"].([]broker.ConversationTurn)
	// Find last assistant turn.
	for i := len(turns) - 1; i >= 0; i-- {
		if turns[i].Role == "assistant" {
			return turns[i].Content, nil
		}
	}
	return "", nil
}

func (a *tyrSpawnerAdapter) StopSession(sessionID string) error {
	return a.runner.Stop(sessionID)
}

// Addr returns the configured listen address as "host:port".
func (s *Server) Addr() string {
	return fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)
}

// TyrServer returns the tyr-mini server instance, if running.
func (s *Server) TyrServer() *tyr.Server {
	return s.tyrSrv
}
