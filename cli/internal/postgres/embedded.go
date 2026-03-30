// Package postgres manages the embedded PostgreSQL lifecycle.
package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
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
func (e *EmbeddedPostgres) Start(ctx context.Context) error {
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

	pgConfig := embeddedpostgres.DefaultConfig().
		Port(uint32(e.config.Database.Port)). //nolint:gosec // port is a valid TCP port number (0-65535)
		Database(e.config.Database.Name).
		Username(e.config.Database.User).
		Password(e.config.Database.Password).
		DataPath(dataDir).
		BinariesPath(cachePath).
		RuntimePath(runtimeDir)

	// When running in Docker or k3s mode, containers reach Postgres via the
	// Docker bridge IP. Postgres must listen on all interfaces, not just
	// localhost, and accept connections from Docker networks.
	if e.config.Runtime == "docker" || e.config.Runtime == "k3s" {
		pgConfig = pgConfig.StartParameters(map[string]string{
			"listen_addresses": "*",
		})
	}

	e.pg = embeddedpostgres.NewDatabase(pgConfig)

	if err := e.pg.Start(); err != nil {
		return fmt.Errorf("start embedded postgres: %w", err)
	}

	// When containers need to connect, allow password auth from Docker
	// bridge networks (172.16.0.0/12 covers the default 172.17.0.0/16
	// and k3d networks).
	if e.config.Runtime == "docker" || e.config.Runtime == "k3s" {
		if err := e.allowDockerConnections(ctx, dataDir); err != nil {
			return fmt.Errorf("configure pg_hba for docker: %w", err)
		}
	}

	return nil
}

// allowDockerConnections appends a pg_hba.conf rule that permits
// password-authenticated connections from Docker bridge networks,
// then signals Postgres to reload its configuration.
func (e *EmbeddedPostgres) allowDockerConnections(ctx context.Context, dataDir string) (err error) {
	hbaPath := filepath.Join(dataDir, "pg_hba.conf")
	hbaRule := "\n# Allow connections from Docker bridge networks\nhost    all    all    172.16.0.0/12    password\n"

	data, err := os.ReadFile(hbaPath) //nolint:gosec // pg_hba.conf in trusted data directory
	if err != nil {
		return fmt.Errorf("read pg_hba.conf: %w", err)
	}

	// Don't add the rule twice.
	if strings.Contains(string(data), "172.16.0.0/12") {
		return nil
	}

	f, err := os.OpenFile(hbaPath, os.O_APPEND|os.O_WRONLY, 0o600) //nolint:gosec // pg_hba.conf in trusted data directory
	if err != nil {
		return fmt.Errorf("open pg_hba.conf: %w", err)
	}
	defer func() {
		if cerr := f.Close(); err == nil && cerr != nil {
			err = fmt.Errorf("close pg_hba.conf: %w", cerr)
		}
	}()

	if _, err := f.WriteString(hbaRule); err != nil {
		return fmt.Errorf("write pg_hba.conf: %w", err)
	}

	// Reload Postgres config (SIGHUP via pg_ctl).
	cfgDir, cfgErr := config.ConfigDir()
	if cfgErr != nil {
		return fmt.Errorf("get config dir: %w", cfgErr)
	}
	pgCtl := filepath.Join(cfgDir, "cache", "pg", "bin", "pg_ctl")

	cmd := exec.CommandContext(ctx, pgCtl, "reload", "-D", dataDir) //nolint:gosec // pg_ctl path from trusted cache directory
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("reload postgres config: %w\n%s", err, out)
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

// RunMigrationsFS applies all pending up migrations from an fs.FS.
func (e *EmbeddedPostgres) RunMigrationsFS(ctx context.Context, migrationFS fs.FS) (applied int, err error) {
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

	return runMigrationsWithTableFS(ctx, db, migrationFS, "schema_migrations")
}

// RunTyrMigrations applies Tyr-specific migrations from the given directory.
// Uses a separate tracking table to avoid version conflicts with Volundr migrations.
func (e *EmbeddedPostgres) RunTyrMigrations(ctx context.Context, migrationsDir string) (applied int, err error) {
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

	return runMigrationsWithTableDB(ctx, db, migrationsDir, "tyr_schema_migrations")
}

// RunTyrMigrationsFS applies Tyr-specific migrations from an fs.FS.
// Uses a separate tracking table to avoid version conflicts with Volundr migrations.
func (e *EmbeddedPostgres) RunTyrMigrationsFS(ctx context.Context, migrationFS fs.FS) (applied int, err error) {
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

	return runMigrationsWithTableFS(ctx, db, migrationFS, "tyr_schema_migrations")
}

// runMigrationsWithFS applies all pending up migrations from an fs.FS.
func runMigrationsWithFS(ctx context.Context, db *sql.DB, migrationFS fs.FS) (int, error) {
	return runMigrationsWithTableFS(ctx, db, migrationFS, "schema_migrations")
}

// runMigrationsWithTableFS applies all pending up migrations from an fs.FS
// using the specified tracking table name.
func runMigrationsWithTableFS(ctx context.Context, db *sql.DB, migrationFS fs.FS, table string) (int, error) {
	if err := db.PingContext(ctx); err != nil {
		return 0, fmt.Errorf("ping database: %w", err)
	}

	//nolint:gosec // table name is a trusted internal constant, not user input
	_, err := db.ExecContext(ctx, fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`, table))
	if err != nil {
		return 0, fmt.Errorf("create %s table: %w", table, err)
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
		version := extractVersion(f)

		var exists bool
		//nolint:gosec // table name is a trusted internal constant, not user input
		err := db.QueryRowContext(ctx,
			fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM %s WHERE version = $1)", table),
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

		//nolint:gosec // table name is a trusted internal constant, not user input
		if _, err := tx.ExecContext(ctx,
			fmt.Sprintf("INSERT INTO %s (version) VALUES ($1)", table),
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

// runMigrationsWithDB applies all pending up migrations using the provided database connection.
func runMigrationsWithDB(ctx context.Context, db *sql.DB, migrationsDir string) (int, error) {
	return runMigrationsWithTableDB(ctx, db, migrationsDir, "schema_migrations")
}

// runMigrationsWithTableDB applies all pending up migrations using the provided
// database connection and the specified tracking table name.
func runMigrationsWithTableDB(ctx context.Context, db *sql.DB, migrationsDir string, table string) (int, error) {
	if err := db.PingContext(ctx); err != nil {
		return 0, fmt.Errorf("ping database: %w", err)
	}

	// Create migrations tracking table.
	//nolint:gosec // table name is a trusted internal constant, not user input
	_, err := db.ExecContext(ctx, fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`, table))
	if err != nil {
		return 0, fmt.Errorf("create %s table: %w", table, err)
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
		//nolint:gosec // table name is a trusted internal constant, not user input
		err := db.QueryRowContext(ctx,
			fmt.Sprintf("SELECT EXISTS(SELECT 1 FROM %s WHERE version = $1)", table),
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

		//nolint:gosec // table name is a trusted internal constant, not user input
		if _, err := tx.ExecContext(ctx,
			fmt.Sprintf("INSERT INTO %s (version) VALUES ($1)", table),
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
