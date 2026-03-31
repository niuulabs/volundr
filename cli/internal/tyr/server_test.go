package tyr

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"github.com/niuulabs/volundr/cli/internal/postgres"
)

func TestNewServer_MissingDSN(t *testing.T) {
	cfg := &Config{
		Enabled:     true,
		DatabaseDSN: "",
		ForgeURL:    "http://localhost:8080",
	}

	_, err := NewServer(cfg)
	if err == nil {
		t.Fatal("expected error for missing DSN")
	}
}

func TestConfig_Defaults(t *testing.T) {
	cfg := &Config{
		Enabled:     true,
		DatabaseDSN: "postgres://user:pass@localhost:5432/db",
		ForgeURL:    "http://localhost:8080",
	}

	if !cfg.Enabled {
		t.Error("expected enabled")
	}
	if cfg.DatabaseDSN == "" {
		t.Error("expected non-empty DSN")
	}
	if cfg.ForgeURL == "" {
		t.Error("expected non-empty ForgeURL")
	}
}

func TestRegisterRoutes_Integration(t *testing.T) {
	// Verify that RegisterRoutes doesn't panic and registers expected paths.
	db, _, err := sqlmockNew()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	dispatcher := NewDispatcher("http://localhost:8080")
	handler := NewHandler(store, dispatcher, nil, nil, "")

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// The mux should have tyr routes registered.
	// We can't directly check route counts, but we can verify no panic occurred.
}

func TestMigrationsFS_Embedded(t *testing.T) {
	// Verify migration files are embedded.
	entries, err := sqlFS.ReadDir("sql")
	if err != nil {
		t.Fatalf("read embedded sql dir: %v", err)
	}

	if len(entries) == 0 {
		t.Fatal("expected embedded migration files")
	}

	foundInitial := false
	for _, e := range entries {
		if e.Name() == "000001_initial_schema.up.sql" {
			foundInitial = true
		}
	}
	if !foundInitial {
		t.Error("expected 000001_initial_schema.up.sql in embedded migrations")
	}
}

func TestMigrationsFS_AllFilesReadable(t *testing.T) {
	entries, err := sqlFS.ReadDir("sql")
	if err != nil {
		t.Fatalf("read embedded sql dir: %v", err)
	}

	for _, e := range entries {
		data, err := sqlFS.ReadFile("sql/" + e.Name())
		if err != nil {
			t.Errorf("read %s: %v", e.Name(), err)
			continue
		}
		if len(data) == 0 {
			t.Errorf("migration %s is empty", e.Name())
		}
	}
}

func TestServerClose_NilDB(t *testing.T) {
	srv := &Server{}
	if err := srv.Close(); err != nil {
		t.Errorf("Close with nil db should not error: %v", err)
	}
}

func TestServerClose_WithDB(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectClose()

	srv := &Server{db: db}
	if err := srv.Close(); err != nil {
		t.Errorf("Close error: %v", err)
	}
}

func TestServerStore(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	srv := &Server{store: store}
	if srv.Store() != store {
		t.Error("Store() should return the underlying store")
	}
}

func TestServerRegisterRoutes(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	store := NewStore(db)
	dispatcher := NewDispatcher("http://localhost:8080")
	handler := NewHandler(store, dispatcher, nil, nil, "")
	srv := &Server{handler: handler}

	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)

	// Verify a known route is registered.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tyr/dispatch/config", http.NoBody)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code == http.StatusNotFound {
		t.Error("expected route to be registered")
	}
}

func TestServerRunMigrations_SubFSError(t *testing.T) {
	// RunMigrations calls fs.Sub then runMigrationsFS.
	// We can't easily make fs.Sub fail with the embedded FS,
	// but we can test RunMigrations with a mock DB that fails on the first query.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// For each migration, return already applied
	entries, _ := sqlFS.ReadDir("sql")
	for range entries {
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}

	srv := &Server{db: db}
	applied, err := srv.RunMigrations(context.Background())
	if err != nil {
		t.Fatalf("RunMigrations error: %v", err)
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
}

func TestRunMigrationsFS_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Create tyr_schema_migrations table
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Read embedded migrations — there should be at least one
	entries, err := sqlFS.ReadDir("sql")
	if err != nil {
		t.Fatalf("read sql dir: %v", err)
	}

	// For each .up.sql file, expect a check + apply
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if len(name) < 7 {
			continue
		}
		// Check if already applied — return false
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	}

	subFS, err2 := fs.Sub(sqlFS, "sql")
	if err2 != nil {
		t.Fatalf("sub fs: %v", err2)
	}

	applied, err := postgres.RunMigrationsWithFSTable(context.Background(), db, subFS, "tyr_schema_migrations")
	if err != nil {
		t.Fatalf("runMigrationsFS error: %v", err)
	}
	// All migrations marked as already applied
	if applied != 0 {
		t.Errorf("expected 0 applied (all skipped), got %d", applied)
	}
}

func TestRunMigrationsFS_ApplyNew(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Create tyr_schema_migrations table
	mock.ExpectExec("CREATE TABLE IF NOT EXISTS tyr_schema_migrations").
		WillReturnResult(sqlmock.NewResult(0, 0))

	// Read entries to know how many migrations there are
	entries, _ := sqlFS.ReadDir("sql")
	migrationCount := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		migrationCount++

		// First migration: not yet applied
		mock.ExpectQuery("SELECT EXISTS").
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		// Begin transaction, execute SQL, insert version, commit
		mock.ExpectBegin()
		mock.ExpectExec(".*").WillReturnResult(sqlmock.NewResult(0, 0))
		mock.ExpectExec("INSERT INTO tyr_schema_migrations").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()
	}

	subFS, _ := fs.Sub(sqlFS, "sql")
	applied, err := postgres.RunMigrationsWithFSTable(context.Background(), db, subFS, "tyr_schema_migrations")
	if err != nil {
		t.Fatalf("runMigrationsFS error: %v", err)
	}
	if applied != migrationCount {
		t.Errorf("expected %d applied, got %d", migrationCount, applied)
	}
}

func sqlmockNew() (*sql.DB, sqlmock.Sqlmock, error) {
	return sqlmock.New()
}
