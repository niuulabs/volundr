// Package postgres manages the embedded PostgreSQL lifecycle.
package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	_ "github.com/lib/pq" // PostgreSQL driver for database/sql

	"github.com/niuulabs/volundr/cli/internal/config"
)

// EmbeddedPostgres manages an embedded PostgreSQL instance.
type EmbeddedPostgres struct {
	pg     *embeddedpostgres.EmbeddedPostgres
	config *config.Config
}

// New creates a new EmbeddedPostgres manager.
func New(cfg *config.Config) *EmbeddedPostgres {
	return &EmbeddedPostgres{
		config: cfg,
	}
}

// Start initializes and starts the embedded PostgreSQL instance.
func (e *EmbeddedPostgres) Start(_ context.Context) error {
	dataDir := e.config.Database.DataDir
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create data directory %s: %w", dataDir, err)
	}

	// Use a cache path within the volundr config directory for PG binaries.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}
	cachePath := filepath.Join(cfgDir, "cache", "pg")

	// RuntimePath must exist before the library starts; use a separate
	// directory so init/cleanup cycles don't interfere with data.
	runtimeDir := filepath.Join(cfgDir, "run", "pg")
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return fmt.Errorf("create runtime directory %s: %w", runtimeDir, err)
	}

	e.pg = embeddedpostgres.NewDatabase(
		embeddedpostgres.DefaultConfig().
			Port(uint32(e.config.Database.Port)). //nolint:gosec // port is a valid TCP port number (0-65535)
			Database(e.config.Database.Name).
			Username(e.config.Database.User).
			Password(e.config.Database.Password).
			DataPath(dataDir).
			BinariesPath(cachePath).
			RuntimePath(runtimeDir),
	)

	if err := e.pg.Start(); err != nil {
		return fmt.Errorf("start embedded postgres: %w", err)
	}

	return nil
}

// Stop gracefully stops the embedded PostgreSQL instance.
func (e *EmbeddedPostgres) Stop() error {
	if e.pg == nil {
		return nil
	}
	if err := e.pg.Stop(); err != nil {
		return fmt.Errorf("stop embedded postgres: %w", err)
	}
	return nil
}

// RunMigrations applies all pending up migrations from the given directory.
func (e *EmbeddedPostgres) RunMigrations(ctx context.Context, migrationsDir string) (applied int, err error) {
	dsn := e.config.DSN()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return 0, fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if cerr := db.Close(); cerr != nil && err == nil {
			err = fmt.Errorf("close database: %w", cerr)
		}
	}()

	return runMigrationsWithDB(ctx, db, migrationsDir)
}

// runMigrationsWithDB applies all pending up migrations using the provided database connection.
func runMigrationsWithDB(ctx context.Context, db *sql.DB, migrationsDir string) (int, error) {
	if err := db.PingContext(ctx); err != nil {
		return 0, fmt.Errorf("ping database: %w", err)
	}

	// Create migrations tracking table.
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	if err != nil {
		return 0, fmt.Errorf("create schema_migrations table: %w", err)
	}

	// Find all up migration files.
	files, err := findMigrationFiles(migrationsDir)
	if err != nil {
		return 0, fmt.Errorf("find migration files: %w", err)
	}

	applied := 0
	for _, f := range files {
		version := extractVersion(f)

		// Check if already applied.
		var exists bool
		err := db.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)",
			version,
		).Scan(&exists)
		if err != nil {
			return applied, fmt.Errorf("check migration %s: %w", version, err)
		}
		if exists {
			continue
		}

		// Read and execute migration.
		sqlBytes, err := os.ReadFile(filepath.Join(migrationsDir, f)) //nolint:gosec // migration files from trusted local directory
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
			"INSERT INTO schema_migrations (version) VALUES ($1)",
			version,
		); err != nil {
			_ = tx.Rollback()
			return applied, fmt.Errorf("record migration %s: %w", f, err)
		}

		if err := tx.Commit(); err != nil {
			return applied, fmt.Errorf("commit migration %s: %w", f, err)
		}

		applied++
	}

	return applied, nil
}

// findMigrationFiles returns sorted .up.sql files from the given directory.
func findMigrationFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations directory %s: %w", dir, err)
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".up.sql") {
			files = append(files, entry.Name())
		}
	}

	sort.Strings(files)
	return files, nil
}

// extractVersion extracts the version identifier from a migration filename.
// Example: "000001_initial_schema.up.sql" -> "000001_initial_schema".
func extractVersion(filename string) string {
	return strings.TrimSuffix(filename, ".up.sql")
}
