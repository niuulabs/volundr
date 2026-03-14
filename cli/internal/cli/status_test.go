package cli

import (
	"os"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunStatus_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	// No PID file exists, so status should show "stopped".
	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_JSON_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus JSON: %v", err)
	}
}

func TestRunStatus_WithPIDFile_DeadProcess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a PID file with a PID that doesn't exist (99999999).
	pidFile := tmpDir + "/volundr.pid"
	if err := os.WriteFile(pidFile, []byte("99999999"), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}
