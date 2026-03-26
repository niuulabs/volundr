package forge

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Server is the main forge server that ties together the store, runner,
// event bus, auth, and HTTP handler.
type Server struct {
	cfg    *Config
	store  *Store
	runner *Runner
	bus    *EventBus
	auth   *PATAuth
	srv    *http.Server
}

// NewServer creates a new forge server from the given config.
func NewServer(cfg *Config) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	// Ensure workspaces directory exists.
	if err := os.MkdirAll(cfg.Forge.WorkspacesDir, 0o755); err != nil {
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

	handler := NewHandler(s.runner, s.cfg)
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)

	s.srv = &http.Server{
		Addr:              addr,
		Handler:           s.auth.Wrap(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown on signals.
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		log.Println("shutting down...")
		s.runner.StopAll()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(shutdownCtx)
	}()

	log.Printf("forge listening on %s", addr)
	log.Printf("  workspaces: %s", s.cfg.Forge.WorkspacesDir)
	log.Printf("  max concurrent sessions: %d", s.cfg.Forge.MaxConcurrent)
	log.Printf("  auth mode: %s", s.cfg.Auth.Mode)

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
