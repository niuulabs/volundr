package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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
	}
	// Create a file named "run" so MkdirAll("run/pg") will fail.
	runFile := filepath.Join(volundrHome, "run")
	if err := os.WriteFile(runFile, []byte("block"), 0o600); err != nil {
		t.Fatal(err)
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
	}

	expected := "create runtime directory"
	if got := err.Error(); !contains(got, expected) {
		t.Errorf("expected error containing %q, got %q", expected, got)
	}
}

// --- findMigrationFiles tests ---

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
		}
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatalf("findMigrationFiles() error: %v", err)
	}

	if len(result) != 2 {
		t.Fatalf("expected 2 up migration files, got %d", len(result))
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
	}
	// Create a real migration file.
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_real.up.sql"), []byte("-- test"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatalf("findMigrationFiles() error: %v", err)
	}

	if len(result) != 1 {
		t.Fatalf("expected 1 file (skipping subdirectory), got %d", len(result))
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
		}
	}

	result, err := findMigrationFiles(tmpDir)
	if err != nil {
		t.Fatal(err)
	}

	expected := []string{"000001_first.up.sql", "000002_second.up.sql", "000003_third.up.sql"}
	if len(result) != len(expected) {
		t.Fatalf("expected %d files, got %d", len(expected), len(result))
	}
	for i, want := range expected {
		if result[i] != want {
			t.Errorf("result[%d] = %q, want %q", i, result[i], want)
		}
	}
}

// --- extractVersion tests ---

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

// --- runMigrationsWithDB tests ---

func TestRunMigrationsWithDB_PingError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing().WillReturnError(fmt.Errorf("connection refused"))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err == nil {
		t.Fatal("expected ping error")
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
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnError(fmt.Errorf("permission denied"))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err == nil {
		t.Fatal("expected create table error")
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
	}
	defer func() { _ = db.Close() }()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	applied, err := runMigrationsWithDB(context.Background(), db, "/nonexistent/migrations/dir")
	if err == nil {
		t.Fatal("expected error for non-existent migrations directory")
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
	}
	defer db.Close()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	applied, err := runMigrationsWithDB(context.Background(), db, t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
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
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_add_col.up.sql"), []byte("ALTER TABLE test ADD COLUMN name TEXT"), 0o600); err != nil {
		t.Fatal(err)
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_add_col.up.sql"), []byte("ALTER TABLE test ADD COLUMN name TEXT"), 0o600); err != nil {
		t.Fatal(err)
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnError(fmt.Errorf("query failed"))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected error checking migration version")
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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err == nil {
		t.Fatal("expected error reading migration file")
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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectPing()
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("000001_init").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	applied, err := runMigrationsWithDB(context.Background(), db, tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
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
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "000002_fail.up.sql"), []byte("BAD SQL"), 0o600); err != nil {
		t.Fatal(err)
	}

	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

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
	}
	if applied != 1 {
		t.Errorf("expected 1 applied (first succeeded), got %d", applied)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled expectations: %v", err)
	}
}

// --- RunMigrations (public method) tests ---

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
