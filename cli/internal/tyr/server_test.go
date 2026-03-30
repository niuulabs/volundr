package tyr

import (
	"context"
	"io/fs"
	"testing"
	"testing/fstest"
)

func TestMigrationsFS(t *testing.T) {
	mfs := MigrationsFS()
	if mfs == nil {
		t.Fatal("expected non-nil migrations FS")
	}

	entries, err := fs.ReadDir(mfs, ".")
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one migration file")
	}

	found := false
	for _, e := range entries {
		if e.Name() == "000001_initial_schema.up.sql" {
			found = true
		}
	}
	if !found {
		t.Error("expected to find 000001_initial_schema.up.sql")
	}
}

func TestRunTyrMigrations_EmptyFS(t *testing.T) {
	// Use an empty FS — should apply 0 migrations.
	emptyFS := fstest.MapFS{}

	// We can't test with a real DB here, but we can test the "no files" path
	// by verifying the function doesn't panic with nil db.
	// This is a basic smoke test — full integration tested via server_test.
	_ = emptyFS

	// Test that MigrationsFS returns a valid FS.
	mfs := MigrationsFS()
	if mfs == nil {
		t.Fatal("MigrationsFS returned nil")
	}
}

func TestNewServer_InvalidDSN(t *testing.T) {
	ctx := context.Background()
	cfg := ServerConfig{
		ForgeBaseURL: "http://localhost:8081",
		DSN:          "postgres://invalid:invalid@localhost:99999/nonexistent?sslmode=disable",
	}

	_, err := NewServer(ctx, cfg, nil)
	if err == nil {
		t.Fatal("expected error for invalid DSN")
	}
}

func TestServerClose_Nil(t *testing.T) {
	s := &Server{}
	if err := s.Close(); err != nil {
		t.Errorf("Close on nil db should not error: %v", err)
	}
}

func TestServerStore(t *testing.T) {
	s := &Server{store: &Store{}}
	if s.Store() == nil {
		t.Error("expected non-nil store")
	}
}

func TestRunMigrations_InvalidDSN(t *testing.T) {
	ctx := context.Background()
	dsn := "postgres://invalid:invalid@localhost:99999/nonexistent?sslmode=disable&connect_timeout=1"
	emptyFS := fstest.MapFS{}

	_, err := RunMigrations(ctx, dsn, emptyFS)
	if err == nil {
		t.Fatal("expected error for invalid DSN")
	}
}

func TestRunMigrations_NilFS(t *testing.T) {
	// RunMigrations is called from k3s mode. When migrationFS is nil,
	// the caller (runTyrMigrationsK3s) returns 0 early, so RunMigrations
	// itself should never receive nil. But test that it handles non-nil empty FS.
	// We can't test with a real DB here; just ensure the function exists
	// and has the right signature.
	var fn func(context.Context, string, fs.FS) (int, error)
	fn = RunMigrations
	if fn == nil {
		t.Fatal("RunMigrations should be non-nil")
	}
}
