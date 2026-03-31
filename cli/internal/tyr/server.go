package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"

	_ "github.com/lib/pq" // PostgreSQL driver

	"github.com/niuulabs/volundr/cli/internal/postgres"
	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// Config holds configuration for the tyr-mini server.
type Config struct {
	// Enabled controls whether tyr-mini starts alongside Forge.
	Enabled bool
	// DatabaseDSN is the PostgreSQL connection string.
	DatabaseDSN string
	// ForgeURL is the base URL for the Forge server (for session dispatch).
	ForgeURL string
	// LinearAPIKey is the Linear API key for tracker integration.
	LinearAPIKey string
	// LinearTeamID is the Linear team ID (auto-discovered if empty).
	LinearTeamID string
}

// Server manages the tyr-mini lifecycle: database, migrations, and HTTP handlers.
type Server struct {
	cfg     *Config
	store   *Store
	handler *Handler
	db      *sql.DB
}

// NewServer creates and initializes a tyr-mini server.
func NewServer(cfg *Config) (*Server, error) {
	if cfg.DatabaseDSN == "" {
		return nil, fmt.Errorf("tyr-mini requires a database DSN")
	}

	db, err := sql.Open("postgres", cfg.DatabaseDSN)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	store := NewStore(db)
	dispatcher := NewDispatcher(cfg.ForgeURL)

	// Initialize tracker if a Linear API key is available.
	var t tracker.Tracker
	if cfg.LinearAPIKey != "" {
		t = tracker.NewLinearTracker(tracker.LinearConfig{
			APIKey: cfg.LinearAPIKey,
			TeamID: cfg.LinearTeamID,
		})
	}

	handler := NewHandler(store, dispatcher, t)

	return &Server{
		cfg:     cfg,
		store:   store,
		handler: handler,
		db:      db,
	}, nil
}

// RunMigrations applies all Tyr SQL migrations from the embedded FS.
func (s *Server) RunMigrations(ctx context.Context) (int, error) {
	subFS, err := fs.Sub(sqlFS, "sql")
	if err != nil {
		return 0, fmt.Errorf("sub fs: %w", err)
	}

	return postgres.RunMigrationsWithFSTable(ctx, s.db, subFS, "tyr_schema_migrations")
}

// RegisterRoutes mounts tyr-mini's API handlers on the given mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	s.handler.RegisterRoutes(mux)
}

// Close closes the database connection.
func (s *Server) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// Store returns the underlying store (for CLI subcommands).
func (s *Server) Store() *Store {
	return s.store
}
