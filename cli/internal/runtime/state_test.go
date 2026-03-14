package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestCheckNotRunning_NoPIDFile(t *testing.T) {
	// Use a temp dir as the config dir so there's no PID file.
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Ensure the .volundr dir exists but has no PID file.
	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	err := CheckNotRunning()
	if err != nil {
		t.Errorf("expected no error when no PID file exists, got: %v", err)
	}
}

func TestCheckNotRunning_StalePIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with a PID that's very unlikely to be running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write stale PID file: %v", err)
	}

	err := CheckNotRunning()
	if err != nil {
		t.Errorf("expected no error for stale PID, got: %v", err)
	}

	// Verify the stale PID file was cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected stale PID file to be removed")
	}
}

func TestCheckNotRunning_InvalidPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write an invalid PID file.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-number"), 0o600); err != nil {
		t.Fatalf("write invalid PID file: %v", err)
	}

	err := CheckNotRunning()
	if err != nil {
		t.Errorf("expected no error for invalid PID file, got: %v", err)
	}

	// Verify the invalid PID file was cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected invalid PID file to be removed")
	}
}

func TestWritePIDFile_RemovePIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write PID file.
	if err := WritePIDFile(); err != nil {
		t.Fatalf("WritePIDFile: %v", err)
	}

	// Verify the file was written with the current PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	data, err := os.ReadFile(pidPath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read PID file: %v", err)
	}

	pid, err := strconv.Atoi(string(data))
	if err != nil {
		t.Fatalf("parse PID: %v", err)
	}

	if pid != os.Getpid() {
		t.Errorf("expected PID %d, got %d", os.Getpid(), pid)
	}

	// Remove PID file.
	if err := RemovePIDFile(); err != nil {
		t.Fatalf("RemovePIDFile: %v", err)
	}

	// Verify the file was removed.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
}

func TestWriteStateFile_ReadBack(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	services := []ServiceStatus{
		{Name: "api", State: StateRunning, Port: 8080},
		{Name: "postgres", State: StateRunning, Port: 5433},
	}

	// Write state file.
	if err := WriteStateFile(services); err != nil {
		t.Fatalf("WriteStateFile: %v", err)
	}

	// Read it back.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}

	var readBack []ServiceStatus
	if err := json.Unmarshal(data, &readBack); err != nil {
		t.Fatalf("unmarshal state: %v", err)
	}

	if len(readBack) != 2 {
		t.Fatalf("expected 2 services, got %d", len(readBack))
	}

	if readBack[0].Name != "api" || readBack[0].State != StateRunning || readBack[0].Port != 8080 {
		t.Errorf("unexpected api service: %+v", readBack[0])
	}

	if readBack[1].Name != "postgres" || readBack[1].State != StateRunning || readBack[1].Port != 5433 {
		t.Errorf("unexpected postgres service: %+v", readBack[1])
	}
}

func TestRemoveStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write then remove.
	services := []ServiceStatus{{Name: "api", State: StateRunning}}
	if err := WriteStateFile(services); err != nil {
		t.Fatalf("WriteStateFile: %v", err)
	}

	if err := RemoveStateFile(); err != nil {
		t.Fatalf("RemoveStateFile: %v", err)
	}

	stateFilePath := filepath.Join(volundrDir, StateFile)
	if _, err := os.Stat(stateFilePath); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}
