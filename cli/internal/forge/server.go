package forge

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

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

	handler := NewHandler(s.runner, s.cfg)
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
	tyrCfg := &tyr.Config{
		Enabled:      true,
		DatabaseDSN:  s.cfg.Tyr.DatabaseDSN,
		ForgeURL:     addr,
		LinearAPIKey: s.cfg.Tyr.LinearAPIKey,
		LinearTeamID: s.cfg.Tyr.LinearTeamID,
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

	log.Println("tyr-mini: routes registered on /api/v1/tyr/*")
	return nil
}

// Addr returns the configured listen address as "host:port".
func (s *Server) Addr() string {
	return fmt.Sprintf("%s:%d", s.cfg.Listen.Host, s.cfg.Listen.Port)
}

// TyrServer returns the tyr-mini server instance, if running.
func (s *Server) TyrServer() *tyr.Server {
	return s.tyrSrv
}
