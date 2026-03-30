package tyr

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http"
	"sort"
	"strings"
)

// ServerConfig holds settings for the tyr-mini server.
type ServerConfig struct {
	// ForgeBaseURL is the Forge API URL for dispatching raids.
	ForgeBaseURL string
	// DSN is the PostgreSQL connection string.
	DSN string
}

// Server is the tyr-mini server that can be embedded into Forge's mux.
type Server struct {
	handler *Handler
	store   *Store
	db      *sql.DB
}

// NewServer creates a tyr-mini server, runs migrations, and initialises the store.
func NewServer(ctx context.Context, cfg ServerConfig, migrationFS fs.FS) (*Server, error) {
	db, err := sql.Open("postgres", cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("open tyr database: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping tyr database: %w", err)
	}

	// Run tyr migrations.
	if migrationFS != nil {
		if _, err := runTyrMigrations(ctx, db, migrationFS); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("run tyr migrations: %w", err)
		}
	}

	store := NewStore(db)
	dispatcher := NewDispatcher(DispatcherConfig{ForgeBaseURL: cfg.ForgeBaseURL}, store)
	handler := NewHandler(store, dispatcher)

	return &Server{
		handler: handler,
		store:   store,
		db:      db,
	}, nil
}

// NewServerFromHandler creates a Server from an existing Handler. This is
// useful in tests where constructing a full Server (with DB connection and
// migrations) is unnecessary.
func NewServerFromHandler(h *Handler) *Server {
	return &Server{handler: h}
}

// RegisterRoutes mounts tyr-mini routes onto an existing HTTP mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	s.handler.RegisterRoutes(mux)
}

// Close releases database resources.
func (s *Server) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// Store returns the underlying store for direct access (e.g., CLI commands).
func (s *Server) Store() *Store {
	return s.store
}

// RunMigrations opens a database connection, applies tyr migrations, and
// closes the connection. This is used by k3s mode to run migrations before
// starting the Tyr Docker container.
func RunMigrations(ctx context.Context, dsn string, migrationFS fs.FS) (int, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return 0, fmt.Errorf("open tyr database: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		return 0, fmt.Errorf("ping tyr database: %w", err)
	}

	return runTyrMigrations(ctx, db, migrationFS)
}

// runTyrMigrations applies tyr-specific migrations using the same pattern as
// the main embedded postgres migration runner.
func runTyrMigrations(ctx context.Context, db *sql.DB, migrationFS fs.FS) (int, error) {
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
		return 0, fmt.Errorf("read tyr migrations fs: %w", err)
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
			return applied, fmt.Errorf("check tyr migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		sqlBytes, err := fs.ReadFile(migrationFS, f)
		if err != nil {
			return applied, fmt.Errorf("read tyr migration %s: %w", f, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return applied, fmt.Errorf("begin tx for %s: %w", f, err)
		}

		if _, err := tx.ExecContext(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback()
			return applied, fmt.Errorf("execute tyr migration %s: %w", f, err)
		}

		if _, err := tx.ExecContext(ctx,
			"INSERT INTO tyr_schema_migrations (version) VALUES ($1)",
			version,
		); err != nil {
			_ = tx.Rollback()
			return applied, fmt.Errorf("record tyr migration %s: %w", f, err)
		}

		if err := tx.Commit(); err != nil {
			return applied, fmt.Errorf("commit tyr migration %s: %w", f, err)
		}

		applied++
	}

	return applied, nil
}
