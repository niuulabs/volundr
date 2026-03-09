package postgres

import (
	"os"
	"path/filepath"
	"testing"

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
}

func TestFindMigrationFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test migration files.
	files := []string{
		"000001_initial.up.sql",
		"000001_initial.down.sql",
		"000002_add_table.up.sql",
		"000002_add_table.down.sql",
		"README.md",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(tmpDir, f), []byte("-- test"), 0o644); err != nil {
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

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"000001_initial_schema.up.sql", "000001_initial_schema"},
		{"000002_add_columns.up.sql", "000002_add_columns"},
		{"000010_project_mappings.up.sql", "000010_project_mappings"},
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

func TestStopNilPostgres(t *testing.T) {
	pg := &EmbeddedPostgres{}
	if err := pg.Stop(); err != nil {
		t.Errorf("Stop() on nil pg should not error, got: %v", err)
	}
}
