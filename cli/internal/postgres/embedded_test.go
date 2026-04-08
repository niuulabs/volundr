package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestNew(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			DataDir:  t.TempDir(),
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	if pg == nil {
		t.Fatal("expected non-nil EmbeddedPostgres")
		return
	}
	if pg.config != cfg {
		t.Error("expected config to be stored")
	}
	if pg.pg != nil {
		t.Error("expected pg field to be nil before Start")
	}
}

func TestStopNilPostgres(t *testing.T) {
	pg := &EmbeddedPostgres{}
	if err := pg.Stop(); err != nil {
		t.Errorf("Stop() on nil pg should not error, got: %v", err)
	}
}

func TestStartDataDirCreation(t *testing.T) {
	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, "nested", "data", "pg")

	t.Setenv("VOLUNDR_HOME", tmpDir)

	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			DataDir:  dataDir,
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	// Start will fail at e.pg.Start() since there's no real PG binary,
	// but the directories should be created before that point.
	err := pg.Start(context.Background())
	if err == nil {
		// If it somehow succeeds (unlikely without binaries), stop it.
		_ = pg.Stop()
		return
	}

	// Verify that the data directory was created.
	if _, statErr := os.Stat(dataDir); os.IsNotExist(statErr) {
		t.Error("expected data directory to be created")
	}

	// Verify that the runtime directory was created.
	runtimeDir := filepath.Join(tmpDir, "run", "pg")
	if _, statErr := os.Stat(runtimeDir); os.IsNotExist(statErr) {
		t.Error("expected runtime directory to be created")
	}
}

func TestStartDataDirError(t *testing.T) {
	// Use a path under /dev/null which is not a directory, so MkdirAll fails.
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			DataDir:  "/dev/null/impossible/path",
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	err := pg.Start(context.Background())
	if err == nil {
		_ = pg.Stop()
		t.Fatal("expected error creating data directory")
		return
	}

	expected := "create data directory"
	if got := err.Error(); !contains(got, expected) {
		t.Errorf("expected error containing %q, got %q", expected, got)
	}
}

func TestStartRuntimeDirError(t *testing.T) {
	tmpDir := t.TempDir()
	dataDir := filepath.Join(tmpDir, "data")

	// Set VOLUNDR_HOME to a path where run/pg can't be created.
	// Create a file where the "run" directory should be.
	volundrHome := filepath.Join(tmpDir, "volundr_home")
	if err := os.MkdirAll(volundrHome, 0o700); err != nil {
		t.Fatal(err)
		return
	}
	// Create a file named "run" so MkdirAll("run/pg") will fail.
	runFile := filepath.Join(volundrHome, "run")
	if err := os.WriteFile(runFile, []byte("block"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	t.Setenv("VOLUNDR_HOME", volundrHome)

	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			DataDir:  dataDir,
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	err := pg.Start(context.Background())
	if err == nil {
		_ = pg.Stop()
		t.Fatal("expected error creating runtime directory")
		return
	}

	expected := "create runtime directory"
	if got := err.Error(); !contains(got, expected) {
		t.Errorf("expected error containing %q, got %q", expected, got)
	}
}

// FindMigrationFiles tests.

func TestFindMigrationFiles(t *testing.T) {
	tmpDir := t.TempDir()

	files := []string{
		"000001_initial.up.sql",
		"000001_initial.down.sql",
		"000002_add_table.up.sql",
		"000002_add_table.down.sql",
		"README.md",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(tmpDir, f), []byte("-- test"), 0o600); err != nil {
			t.Fatalf("create test file: %v", err)
			return
		}
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatalf("findMigrationFiles() error: %v", err)
		return
	}

	if len(result) != 2 {
		t.Fatalf("expected 2 up migration files, got %d", len(result))
		return
	}

	if result[0] != "000001_initial.up.sql" {
		t.Errorf("expected first file to be 000001, got %q", result[0])
	}
	if result[1] != "000002_add_table.up.sql" {
		t.Errorf("expected second file to be 000002, got %q", result[1])
	}
}

func TestFindMigrationFilesEmpty(t *testing.T) {
	tmpDir := t.TempDir()

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatalf("findMigrationFiles() error: %v", err)
		return
	}

	if len(result) != 0 {
		t.Errorf("expected 0 files, got %d", len(result))
	}
}

func TestFindMigrationFilesNonExistent(t *testing.T) {
	_, err := findMigrationFiles("/nonexistent/dir")
	if err == nil {
		t.Error("expected error for non-existent directory")
	}
}

func TestFindMigrationFilesSkipsSubdirectories(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a subdirectory that looks like a migration.
	if err := os.Mkdir(filepath.Join(tmpDir, "000001_subdir.up.sql"), 0o700); err != nil {
		t.Fatal(err)
		return
	}
	// Create a real migration file.
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_real.up.sql"), []byte("-- test"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatalf("findMigrationFiles() error: %v", err)
		return
	}

	if len(result) != 1 {
		t.Fatalf("expected 1 file (skipping subdirectory), got %d", len(result))
		return
	}
	if result[0] != "000002_real.up.sql" {
		t.Errorf("expected 000002_real.up.sql, got %q", result[0])
	}
}

func TestFindMigrationFilesSortsCorrectly(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files in reverse order.
	files := []string{
		"000003_third.up.sql",
		"000001_first.up.sql",
		"000002_second.up.sql",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(tmpDir, f), []byte("-- test"), 0o600); err != nil {
			t.Fatal(err)
			return
		}
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatal(err)
		return
	}

	expected := []string{"000001_first.up.sql", "000002_second.up.sql", "000003_third.up.sql"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d files, got %d", len(expected), len(result))
		return
	}
	for i, want := range expected {
		if result[i] != want {
			t.Errorf("result[%d] = %q, want %q", i, result[i], want)
		}
	}
}

// ExtractVersion tests.

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"000001_initial_schema.up.sql", "000001_initial_schema"},
		{"000002_add_columns.up.sql", "000002_add_columns"},
		{"000010_project_mappings.up.sql", "000010_project_mappings"},
		{"no_suffix.txt", "no_suffix.txt"},
		{"000001.up.sql", "000001"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := extractVersion(tt.input)
			if got != tt.expected {
				t.Errorf("extractVersion(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

// RunMigrationsWithDB tests.

func TestRunMigrationsWithDB_PingError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing().WillReturnError(fmt.Errorf("connection refused"))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err == nil {
		t.Fatal("expected ping error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "ping database") {
		t.Errorf("expected 'ping database' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_CreateTableError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnError(fmt.Errorf("permission denied"))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err == nil {
		t.Fatal("expected create table error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "create schema_migrations table") {
		t.Errorf("expected 'create schema_migrations table' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_InvalidMigrationsDir(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	applied, err := runMigrationsWithDB(context.Background(), db, "/nonexistent/migrations/dir")
	if err == nil {
		t.Fatal("expected error for non-existent migrations directory")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "find migration files") {
		t.Errorf("expected 'find migration files' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_NoMigrations(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_AppliesNewMigrations(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_add_col.up.sql"), []byte("ALTER TABLE test ADD COLUMN name TEXT"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Migration 000001: not yet applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Migration 000002: not yet applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000002_add_col").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("ALTER TABLE test ADD COLUMN name TEXT").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000002_add_col").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 2 {
		t.Errorf("expected 2 applied, got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_SkipsAlreadyApplied(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_add_col.up.sql"), []byte("ALTER TABLE test ADD COLUMN name TEXT"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Migration 000001: already applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Migration 000002: not yet applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000002_add_col").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("ALTER TABLE test ADD COLUMN name TEXT").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000002_add_col").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 1 {
		t.Errorf("expected 1 applied (skipped 000001), got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_CheckVersionError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnError(fmt.Errorf("query failed"))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected error checking migration version")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "check migration") {
		t.Errorf("expected 'check migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_ReadMigrationFileError(t *testing.T) {
	tmpDir := t.TempDir()
	// Create a migration file and make it unreadable.
	migrationFile := filepath.Join(tmpDir, "000001_init.up.sql")
	if err := os.WriteFile(migrationFile, []byte("CREATE TABLE test (id INT)"), 0o000); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected error reading migration file")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "read migration") {
		t.Errorf("expected 'read migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_BeginTxError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin().WillReturnError(fmt.Errorf("cannot begin transaction"))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected begin transaction error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "begin transaction") {
		t.Errorf("expected 'begin transaction' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_ExecMigrationError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("INVALID SQL"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("INVALID SQL").
		WillReturnError(fmt.Errorf("syntax error"))
	mock.ExpectRollback()

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected exec migration error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "execute migration") {
		t.Errorf("expected 'execute migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_RecordMigrationError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnError(fmt.Errorf("unique constraint violation"))
	mock.ExpectRollback()

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected record migration error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "record migration") {
		t.Errorf("expected 'record migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_CommitError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit().WillReturnError(fmt.Errorf("commit failed"))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected commit error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "commit migration") {
		t.Errorf("expected 'commit migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_AllAlreadyApplied(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied (all already applied), got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithDB_PartialApplyOnError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_fail.up.sql"), []byte("BAD SQL"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// First migration succeeds.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Second migration fails at exec.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000002_fail").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("BAD SQL").
		WillReturnError(fmt.Errorf("syntax error"))
	mock.ExpectRollback()

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected error on second migration")
		return
	}
	if applied != 1 {
		t.Errorf("expected 1 applied (first succeeded), got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// RunMigrationsWithFS tests.

func TestRunMigrationsWithFS_PingError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing().WillReturnError(fmt.Errorf("connection refused"))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(t.TempDir()))
	if err == nil {
		t.Fatal("expected ping error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "ping database") {
		t.Errorf("expected 'ping database' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_CreateTableError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnError(fmt.Errorf("permission denied"))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(t.TempDir()))
	if err == nil {
		t.Fatal("expected create table error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "create schema_migrations table") {
		t.Errorf("expected 'create schema_migrations table' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_NoMigrations(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(t.TempDir()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_AppliesNewMigrations(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_add_col.up.sql"), []byte("ALTER TABLE test ADD COLUMN name TEXT"), 0o600); err != nil {
		t.Fatal(err)
		return
	}
	// Also add a down migration to verify it's skipped.
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.down.sql"), []byte("DROP TABLE test"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Migration 000001: not yet applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	// Migration 000002: not yet applied.
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000002_add_col").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("ALTER TABLE test ADD COLUMN name TEXT").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000002_add_col").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 2 {
		t.Errorf("expected 2 applied, got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_SkipsAlreadyApplied(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_CheckVersionError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnError(fmt.Errorf("query failed"))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err == nil {
		t.Fatal("expected error checking migration version")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "check migration") {
		t.Errorf("expected 'check migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_BeginTxError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin().WillReturnError(fmt.Errorf("cannot begin transaction"))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err == nil {
		t.Fatal("expected begin transaction error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "begin transaction") {
		t.Errorf("expected 'begin transaction' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_ExecMigrationError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("INVALID SQL"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("INVALID SQL").
		WillReturnError(fmt.Errorf("syntax error"))
	mock.ExpectRollback()

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err == nil {
		t.Fatal("expected exec migration error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "execute migration") {
		t.Errorf("expected 'execute migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_RecordMigrationError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnError(fmt.Errorf("unique constraint violation"))
	mock.ExpectRollback()

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err == nil {
		t.Fatal("expected record migration error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "record migration") {
		t.Errorf("expected 'record migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

func TestRunMigrationsWithFS_CommitError(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "000001_init.up.sql"), []byte("CREATE TABLE test (id INT)"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
		return
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectBegin()
	mock.ExpectExec("CREATE TABLE test").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO schema_migrations").
		WithArgs("000001_init").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit().WillReturnError(fmt.Errorf("commit failed"))

	applied, err := runMigrationsWithFS(context.Background(), db, os.DirFS(tmpDir))
	if err == nil {
		t.Fatal("expected commit error")
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if !contains(err.Error(), "commit migration") {
		t.Errorf("expected 'commit migration' in error, got %q", err.Error())
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// RunMigrationsFS (public method) tests.

func TestRunMigrationsFS_OpenDatabaseError(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	// RunMigrationsFS will fail at PingContext because no real DB is running.
	_, err := pg.RunMigrationsFS(context.Background(), os.DirFS(t.TempDir()))
	if err == nil {
		t.Fatal("expected error when no database is running")
		return
	}
}

// AllowDockerConnections tests.

func TestAllowDockerConnections_NoHbaFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("VOLUNDR_HOME", tmpDir)

	cfg := &config.Config{}
	pg := New(cfg)

	err := pg.allowDockerConnections(context.Background(), tmpDir)
	if err == nil {
		t.Fatal("expected error reading pg_hba.conf")
		return
	}
	if !contains(err.Error(), "read pg_hba.conf") {
		t.Errorf("expected 'read pg_hba.conf' in error, got %q", err.Error())
	}
}

func TestAllowDockerConnections_AlreadyContainsRule(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("VOLUNDR_HOME", tmpDir)

	// Write pg_hba.conf with the Docker rule already present.
	hbaPath := filepath.Join(tmpDir, "pg_hba.conf")
	if err := os.WriteFile(hbaPath, []byte("host all all 172.16.0.0/12 password\n"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	cfg := &config.Config{}
	pg := New(cfg)

	// Should return nil without error since rule already exists.
	err := pg.allowDockerConnections(context.Background(), tmpDir)
	if err != nil {
		t.Fatalf("expected no error when rule already exists, got: %v", err)
		return
	}
}

func TestAllowDockerConnections_AppendsRule(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("VOLUNDR_HOME", tmpDir)

	// Create required directories for pg_ctl path.
	pgCtlDir := filepath.Join(tmpDir, "cache", "pg", "bin")
	if err := os.MkdirAll(pgCtlDir, 0o700); err != nil {
		t.Fatal(err)
		return
	}

	// Write pg_hba.conf without the Docker rule.
	hbaPath := filepath.Join(tmpDir, "pg_hba.conf")
	if err := os.WriteFile(hbaPath, []byte("# Default rules\nlocal all all trust\n"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	cfg := &config.Config{}
	pg := New(cfg)

	// This will fail at the pg_ctl reload step since there's no real pg_ctl,
	// but the file should have been updated before that point.
	err := pg.allowDockerConnections(context.Background(), tmpDir)

	// Read the file to verify the rule was appended.
	data, readErr := os.ReadFile(hbaPath) //nolint:gosec // test file path from t.TempDir()
	if readErr != nil {
		t.Fatalf("read pg_hba.conf: %v", readErr)
		return
	}

	if !strings.Contains(string(data), "172.16.0.0/12") {
		t.Error("expected Docker bridge rule to be appended to pg_hba.conf")
	}

	// We expect an error from pg_ctl reload since there's no real binary.
	if err == nil {
		t.Log("allowDockerConnections succeeded unexpectedly (pg_ctl may exist)")
	}
}

// RunMigrations (public method) tests.

func TestRunMigrations_OpenDatabaseError(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	// RunMigrations will fail at PingContext because no real DB is running.
	_, err := pg.RunMigrations(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected error when no database is running")
		return
	}
}

func TestRunTyrMigrations_OpenDatabaseError(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	// RunTyrMigrations will fail at PingContext because no real DB is running.
	_, err := pg.RunTyrMigrations(context.Background(), t.TempDir())
	if err == nil {
		t.Fatal("expected error when no database is running")
		return
	}
}

func TestRunTyrMigrationsFS_OpenDatabaseError(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     15433,
			User:     "test",
			Password: "test",
			Name:     "testdb",
		},
	}

	pg := New(cfg)
	// RunTyrMigrationsFS will fail at PingContext because no real DB is running.
	_, err := pg.RunTyrMigrationsFS(context.Background(), os.DirFS(t.TempDir()))
	if err == nil {
		t.Fatal("expected error when no database is running")
		return
	}
}

// contains is a helper to check substring presence.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
