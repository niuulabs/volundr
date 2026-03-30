package forge

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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

	handler := NewHandler(s.runner)
	handler.RegisterRoutes(mux)

	// Admin shutdown endpoint — localhost-only, no auth.
	mux.HandleFunc("POST /admin/shutdown", s.handleShutdown)

	addr := fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)

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

// Addr returns the configured listen address as "host:port".
func (s *Server) Addr() string {
	return fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)
}
