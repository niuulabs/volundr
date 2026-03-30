package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"sort"
	"strings"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// Config holds configuration for the tyr-mini server.
type Config struct {
	// Enabled controls whether tyr-mini starts alongside Forge.
	Enabled bool
	// DatabaseDSN is the PostgreSQL connection string.
	DatabaseDSN string
	// ForgeURL is the base URL for the Forge server (for session dispatch).
	ForgeURL string
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

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	store := NewStore(db)
	dispatcher := NewDispatcher(cfg.ForgeURL)
	handler := NewHandler(store, dispatcher)

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

	return runMigrationsFS(ctx, s.db, subFS)
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

// ---------------------------------------------------------------------------
// Migration runner (adapted from postgres package for embedded FS)
// ---------------------------------------------------------------------------

func runMigrationsFS(ctx context.Context, db *sql.DB, migrationFS fs.FS) (int, error) {
	// Use a separate migrations table to avoid collisions with Forge's schema_migrations.
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS tyr_schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	if err != nil {
		return 0, fmt.Errorf("create tyr_schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrationFS, ".")
	if err != nil {
		return 0, fmt.Errorf("read migrations fs: %w", err)
	}

	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)

	applied := 0
	for _, f := range files {
		version := strings.TrimSuffix(f, ".up.sql")

		var exists bool
		err := db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM tyr_schema_migrations WHERE version = $1)",
			version,
		).Scan(&exists)
		if err != nil {
			return applied, fmt.Errorf("check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		sqlBytes, err := fs.ReadFile(migrationFS, f)
		if err != nil {
			return applied, fmt.Errorf("read migration %s: %w", f, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return applied, fmt.Errorf("begin transaction for %s: %w", f, err)
		}

		if _, err := tx.ExecContext(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback()
			return applied, fmt.Errorf("execute migration %s: %w", f, err)
		}

		if _, err := tx.ExecContext(ctx,
			"INSERT INTO tyr_schema_migrations (version) VALUES ($1)",
			version,
		); err != nil {
			_ = tx.Rollback()
			return applied, fmt.Errorf("record migration %s: %w", f, err)
		}

		if err := tx.Commit(); err != nil {
			return applied, fmt.Errorf("commit migration %s: %w", f, err)
		}

		log.Printf("tyr-mini: applied migration %s", version)
		applied++
	}

	return applied, nil
}
