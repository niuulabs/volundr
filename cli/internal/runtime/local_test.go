package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestNewLocalRuntime(t *testing.T) {
	r := NewLocalRuntime()
	if r == nil {
		t.Fatal("expected non-nil LocalRuntime")
		return
	}
	if r.pg != nil {
		t.Error("expected pg to be nil on new LocalRuntime")
	}
	if r.apiCmd != nil {
		t.Error("expected apiCmd to be nil on new LocalRuntime")
	}
	if r.proxyRtr != nil {
		t.Error("expected proxyRtr to be nil on new LocalRuntime")
	}
}

func TestLocalRuntime_Status_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
		return
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].Name != "volundr" {
		t.Errorf("expected service name 'volundr', got %q", status.Services[0].Name)
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped, got %q", status.Services[0].State)
	}
}

func TestLocalRuntime_Status_PIDFileNoStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with our own PID (so it's a running process).
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
		return
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestLocalRuntime_Status_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write a state file.
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
		{Name: "api", State: StateRunning, Port: 8081, PID: 12345},
		{Name: "postgres", State: StateRunning, Port: 5433},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
		return
	}

	if len(status.Services) != 3 {
		t.Fatalf("expected 3 services, got %d", len(status.Services))
		return
	}

	if status.Services[0].Name != "proxy" {
		t.Errorf("expected first service 'proxy', got %q", status.Services[0].Name)
	}
	if status.Services[1].Name != "api" {
		t.Errorf("expected second service 'api', got %q", status.Services[1].Name)
	}
	if status.Services[2].Name != "postgres" {
		t.Errorf("expected third service 'postgres', got %q", status.Services[2].Name)
	}
}

func TestLocalRuntime_Status_CorruptStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write a corrupt state file.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, []byte("not-json"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
		return
	}

	// Should fall back to a generic running status.
	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}
	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestLocalRuntime_Logs(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	// Write a test log file.
	logContent := "test log line 1\ntest log line 2\n"
	if err := os.WriteFile(filepath.Join(logsDir, "api.log"), []byte(logContent), 0o600); err != nil {
		t.Fatalf("write log file: %v", err)
		return
	}

	r := NewLocalRuntime()
	reader, err := r.Logs(context.Background(), "api", false)
	if err != nil {
		t.Fatalf("Logs: %v", err)
		return
	}
	defer func() { _ = reader.Close() }()

	data := make([]byte, 1024)
	n, _ := reader.Read(data)
	if string(data[:n]) != logContent {
		t.Errorf("expected log content %q, got %q", logContent, string(data[:n]))
	}
}

func TestLocalRuntime_Logs_MissingFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	_, err := r.Logs(context.Background(), "nonexistent", false)
	if err == nil {
		t.Fatal("expected error for missing log file")
		return
	}
}

func TestLocalRuntime_WriteStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	if err := r.writeStateFile(cfg); err != nil {
		t.Fatalf("writeStateFile: %v", err)
		return
	}

	// Read back and verify.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read state file: %v", err)
		return
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}

	// Should have proxy and postgres (no api since apiCmd is nil).
	expectedNames := map[string]bool{
		"proxy":    false,
		"postgres": false,
	}

	for _, svc := range services {
		if _, ok := expectedNames[svc.Name]; ok {
			expectedNames[svc.Name] = true
		}
	}

	for name, found := range expectedNames {
		if !found {
			t.Errorf("expected service %q in state file", name)
		}
	}
}

func TestLocalRuntime_WriteStateFile_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode: "external",
			Port: 5432,
		},
	}

	if err := r.writeStateFile(cfg); err != nil {
		t.Fatalf("writeStateFile: %v", err)
		return
	}

	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read state file: %v", err)
		return
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}

	// Should only have proxy (no postgres for external DB, no api since apiCmd is nil).
	for _, svc := range services {
		if svc.Name == "postgres" {
			t.Error("did not expect postgres service for external DB mode")
		}
	}
}

func TestLocalRuntime_Down_NoProcess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	// Down with no process running should complete without error.
	err := r.Down(context.Background())
	if err != nil {
		t.Errorf("expected no error for Down with no process, got: %v", err)
	}
}

func TestFindMigrationsDir_NoDir(t *testing.T) {
	// Change to a temp dir where there's no migrations directory.
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	result := findMigrationsDir()
	if result != "" {
		t.Errorf("expected empty string when no migrations dir, got %q", result)
	}
}

func TestFindMigrationsDir_Found(t *testing.T) {
	tmpDir := t.TempDir()
	migDir := filepath.Join(tmpDir, "migrations")
	if err := os.MkdirAll(migDir, 0o700); err != nil {
		t.Fatalf("create migrations dir: %v", err)
		return
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	result := findMigrationsDir()
	if result == "" {
		t.Fatal("expected non-empty migrations dir")
		return
	}

	// On macOS, /var is a symlink to /private/var, so resolve symlinks for comparison.
	absExpected, _ := filepath.Abs(migDir)
	absExpected, _ = filepath.EvalSymlinks(absExpected)
	resultResolved, _ := filepath.EvalSymlinks(result)
	if resultResolved != absExpected {
		t.Errorf("expected %q, got %q", absExpected, resultResolved)
	}
}

func TestFindMigrationsDir_ParentDir(t *testing.T) {
	tmpDir := t.TempDir()
	migDir := filepath.Join(tmpDir, "migrations")
	if err := os.MkdirAll(migDir, 0o700); err != nil {
		t.Fatalf("create migrations dir: %v", err)
		return
	}

	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.MkdirAll(subDir, 0o700); err != nil {
		t.Fatalf("create subdir: %v", err)
		return
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(subDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	result := findMigrationsDir()
	if result == "" {
		t.Fatal("expected non-empty migrations dir from parent")
		return
	}
}

func TestStatusFromStateFile_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped, got %q", status.Services[0].State)
	}
}

func TestStatusFromStateFile_StalePID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with a PID that is very unlikely to be running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped for stale PID, got %q", status.Services[0].State)
	}
}

func TestStatusFromStateFile_RunningWithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with our own PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write a state file.
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
		{Name: "api", State: StateRunning, Port: 8081},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	if len(status.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(status.Services))
		return
	}

	if status.Services[0].Name != "proxy" {
		t.Errorf("expected first service 'proxy', got %q", status.Services[0].Name)
	}
}

func TestStatusFromStateFile_RunningNoStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with our own PID (so it's running).
	pidPath := filepath.Join(volundrDir, PIDFile)
	pid := os.Getpid()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}

	if status.Services[0].PID != pid {
		t.Errorf("expected PID %d, got %d", pid, status.Services[0].PID)
	}
}

func TestStatusFromStateFile_CorruptStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with our own PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	pid := os.Getpid()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write a corrupt state file.
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("{invalid"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}

	if status.Services[0].PID != pid {
		t.Errorf("expected PID %d, got %d", pid, status.Services[0].PID)
	}
}

func TestStatusFromStateFile_InvalidPID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with a non-numeric PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-pid"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write a state file.
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
		return
	}

	// Invalid PID means we can't verify process status, but the state file
	// should still be read. The function should return services from the state file.
	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
		return
	}
}

func TestDownFromPID_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	err := DownFromPID()
	if err == nil {
		t.Fatal("expected error when no PID file")
		return
	}

	if !contains(err.Error(), "no running instance") {
		t.Errorf("expected 'no running instance' error, got: %v", err)
	}
}

func TestDownFromPID_InvalidPID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-number"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	err := DownFromPID()
	if err == nil {
		t.Fatal("expected error for invalid PID")
		return
	}

	if !contains(err.Error(), "parse PID") {
		t.Errorf("expected 'parse PID' error, got: %v", err)
	}
}

func TestDownFromPID_StalePID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with a PID that's very unlikely to be running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Also write a state file that should be cleaned up.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	err := DownFromPID()
	// Error is expected because the process can't be signaled.
	if err == nil {
		t.Fatal("expected error for stale PID")
		return
	}

	// PID file should be cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
}

func TestLocalRuntime_Init_CreatesDirs(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "external",
		},
	}

	// Init in external mode skips postgres setup, just creates dirs.
	err := r.Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init: %v", err)
		return
	}

	volundrDir := filepath.Join(tmpDir, ".niuu")
	for _, sub := range []string{"data/pg", "logs", "cache"} {
		dir := filepath.Join(volundrDir, sub)
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("expected directory %s to exist: %v", dir, err)
		}
	}
}

func TestLocalRuntime_Down_NoApiNoPostgres(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Create PID and state files to verify cleanup.
	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	r := NewLocalRuntime()
	// Down with nil apiCmd and nil pg should just clean up files.
	err := r.Down(context.Background())
	if err != nil {
		t.Fatalf("Down: %v", err)
		return
	}

	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}

func TestLocalRuntime_StartAPI(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
		Anthropic: config.AnthropicConfig{APIKey: "sk-test"},
	}

	err := r.startAPI(context.Background(), cfg, 8081)
	if err != nil {
		t.Fatalf("startAPI: %v", err)
		return
	}

	// apiCmd should be set.
	if r.apiCmd == nil {
		t.Fatal("expected apiCmd to be set after startAPI")
		return
	}

	// Wait for the process to finish.
	_ = r.apiCmd.Wait()
}

func TestLocalRuntime_StartAPI_NoLogsDir(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Create config dir but NOT logs dir.
	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
	}

	err := r.startAPI(context.Background(), cfg, 8081)
	if err == nil {
		t.Fatal("expected error when logs dir does not exist")
		return
	}
}

func TestLocalRuntime_WriteStateFile_WithAPICmd(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	// Start a mock API process so apiCmd.Process is set.
	if err := r.startAPI(context.Background(), cfg, 8081); err != nil {
		t.Fatalf("startAPI: %v", err)
		return
	}
	// Wait for it to complete (it's a mock, exits immediately).
	_ = r.apiCmd.Wait()

	if err := r.writeStateFile(cfg); err != nil {
		t.Fatalf("writeStateFile: %v", err)
		return
	}

	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read state file: %v", err)
		return
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}

	// Should have proxy, api (since apiCmd.Process exists), and postgres.
	found := map[string]bool{}
	for _, svc := range services {
		found[svc.Name] = true
	}
	for _, name := range []string{"proxy", "api", "postgres"} {
		if !found[name] {
			t.Errorf("expected service %q in state file", name)
		}
	}
}

func TestDownFromPID_ReadError(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with whitespace around the number.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("  999999999  "), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	err := DownFromPID()
	// Process 999999999 is unlikely to exist, so Signal will fail.
	if err == nil {
		t.Fatal("expected error for non-existent PID")
		return
	}
	if !contains(err.Error(), "SIGTERM") {
		t.Errorf("expected SIGTERM error, got: %v", err)
	}

	// PID file should be cleaned up after failed signal.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed after failed signal")
	}
}

func TestLocalRuntime_Down_WithApiCmd(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	// Create PID and state files.
	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
	}

	// Start a mock API process.
	if err := r.startAPI(context.Background(), cfg, 8081); err != nil {
		t.Fatalf("startAPI: %v", err)
		return
	}

	// Now call Down, which should attempt to stop the apiCmd.
	err := r.Down(context.Background())
	if err != nil {
		// The process may have already exited (mock process exits immediately).
		// An error from signaling a dead process is acceptable.
		t.Logf("Down returned: %v (acceptable for mock process)", err)
	}

	// PID and state files should be cleaned up.
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}

func TestLocalRuntime_Up_AlreadyRunning(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Write a PID file with our own PID to simulate already running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}

	r := NewLocalRuntime()
	cfg := &config.Config{}

	err := r.Up(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when already running")
		return
	}
}

func TestLocalRuntime_Up_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Host: "127.0.0.1", Port: 0},
		Database: config.DatabaseConfig{
			Mode:     "external",
			Port:     5432,
			User:     "user",
			Password: "pass",
			Name:     "mydb",
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := r.Up(ctx, cfg)
	if err != nil {
		t.Fatalf("Up: %v", err)
		return
	}

	// Verify PID file was written.
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); err != nil {
		t.Error("expected PID file to be written")
	}

	// Verify state file was written.
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); err != nil {
		t.Error("expected state file to be written")
	}

	// Wait for mock process to exit.
	if r.apiCmd != nil {
		_ = r.apiCmd.Wait()
	}

	cancel()
}

func TestLocalRuntime_Init_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "external",
		},
	}

	err := r.Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init: %v", err)
		return
	}

	// Verify directories were created.
	volundrDir := filepath.Join(tmpDir, ".niuu")
	for _, sub := range []string{"data/pg", "logs", "cache"} {
		dir := filepath.Join(volundrDir, sub)
		if _, err := os.Stat(dir); err != nil {
			t.Errorf("expected directory %s to exist: %v", dir, err)
		}
	}
}

func TestDownFromPID_SuccessPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	stateFilePath := filepath.Join(volundrDir, StateFile)

	// Write a PID file with a PID that's not running.
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
		return
	}
	if err := os.WriteFile(stateFilePath, []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
		return
	}

	err := DownFromPID()
	// Should error because the process can't be signaled.
	if err == nil {
		t.Fatal("expected error for non-existent PID")
		return
	}

	// Both files should be cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
}

func TestLocalRuntime_Init_EmbeddedDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	withMockPostgres(t, &fakePostgres{})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
		},
	}

	err := r.Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init: %v", err)
		return
	}
}

func TestLocalRuntime_Init_EmbeddedDB_StartFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	withMockPostgres(t, &fakePostgres{startErr: fmt.Errorf("download failed")})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
		},
	}

	err := r.Init(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when postgres start fails")
		return
	}
	if !contains(err.Error(), "test embedded postgres") {
		t.Errorf("expected 'test embedded postgres' error, got: %v", err)
	}
}

func TestLocalRuntime_Init_EmbeddedDB_StopFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	withMockPostgres(t, &fakePostgres{stopErr: fmt.Errorf("stop failed")})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
		},
	}

	err := r.Init(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when postgres stop fails")
		return
	}
	if !contains(err.Error(), "stop test postgres") {
		t.Errorf("expected 'stop test postgres' error, got: %v", err)
	}
}

func TestLocalRuntime_Up_EmbeddedDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
		return
	}

	withMockExec(t)
	withMockPostgres(t, &fakePostgres{migrationsN: 3})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Host: "127.0.0.1", Port: 0},
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
			DataDir:  filepath.Join(volundrDir, "data", "pg"),
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := r.Up(ctx, cfg)
	if err != nil {
		t.Fatalf("Up: %v", err)
		return
	}

	// Verify PID file was written.
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); err != nil {
		t.Error("expected PID file to be written")
	}

	// Verify state file was written with postgres service.
	stateData, err := os.ReadFile(filepath.Join(volundrDir, StateFile)) //nolint:gosec // test reads from temp dir
	if err != nil {
		t.Fatalf("read state file: %v", err)
		return
	}
	var services []ServiceStatus
	if err := json.Unmarshal(stateData, &services); err != nil {
		t.Fatalf("unmarshal state: %v", err)
		return
	}
	foundPostgres := false
	for _, svc := range services {
		if svc.Name == "postgres" {
			foundPostgres = true
		}
	}
	if !foundPostgres {
		t.Error("expected postgres service in state file for embedded mode")
	}

	if r.apiCmd != nil {
		_ = r.apiCmd.Wait()
	}
	cancel()
}

func TestLocalRuntime_Up_EmbeddedDB_StartFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	withMockPostgres(t, &fakePostgres{startErr: fmt.Errorf("pg start failed")})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
		},
	}

	err := r.Up(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when postgres start fails")
		return
	}
	if !contains(err.Error(), "start embedded postgres") {
		t.Errorf("expected 'start embedded postgres' error, got: %v", err)
	}
}

func TestLocalRuntime_Up_EmbeddedDB_MigrationFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Create a migrations dir so findMigrationsDir finds it.
	migDir := filepath.Join(tmpDir, "migrations")
	if err := os.MkdirAll(migDir, 0o700); err != nil {
		t.Fatalf("create migrations dir: %v", err)
		return
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	withMockExec(t)
	withMockPostgres(t, &fakePostgres{migrationsErr: fmt.Errorf("migration failed")})

	r := NewLocalRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
		},
	}

	err := r.Up(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when migrations fail")
		return
	}
	if !contains(err.Error(), "run migrations") {
		t.Errorf("expected 'run migrations' error, got: %v", err)
	}
}

func TestLocalRuntime_Down_WithPostgres(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	r.pg = &fakePostgres{}

	err := r.Down(context.Background())
	if err != nil {
		t.Fatalf("Down: %v", err)
		return
	}
}

func TestLocalRuntime_Down_WithPostgresStopFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	r := NewLocalRuntime()
	r.pg = &fakePostgres{stopErr: fmt.Errorf("stop failed")}

	err := r.Down(context.Background())
	if err == nil {
		t.Fatal("expected error when postgres stop fails")
		return
	}
	if !contains(err.Error(), "stop postgres") {
		t.Errorf("expected 'stop postgres' error, got: %v", err)
	}
}

func TestLocalRuntime_Up_StartAPIFail(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Create config dir but NOT logs dir, so startAPI fails.
	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	withMockExec(t)

	r := NewLocalRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Host: "127.0.0.1", Port: 0},
		Database: config.DatabaseConfig{
			Mode: "external",
		},
	}

	err := r.Up(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when startAPI fails")
		return
	}
	if !contains(err.Error(), "start API") {
		t.Errorf("expected 'start API' error, got: %v", err)
	}
}

func TestRunMigrationsAuto_FilesystemFallback(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a migrations directory.
	migDir := filepath.Join(tmpDir, "migrations")
	if err := os.MkdirAll(migDir, 0o700); err != nil {
		t.Fatalf("create migrations dir: %v", err)
		return
	}
	// Create a migration file so findMigrationsDir finds something.
	if err := os.WriteFile(filepath.Join(migDir, "000001_init.up.sql"), []byte("-- test"), 0o600); err != nil {
		t.Fatal(err)
		return
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	fp := &fakePostgres{migrationsN: 1}
	applied, source, err := runMigrationsAuto(context.Background(), fp)
	if err != nil {
		t.Fatalf("runMigrationsAuto: %v", err)
		return
	}
	if applied != 1 {
		t.Errorf("expected 1 applied, got %d", applied)
	}
	// source should be an absolute path (not "embedded").
	if source == "" || source == "embedded" {
		t.Errorf("expected filesystem path as source, got %q", source)
	}
}

func TestRunMigrationsAuto_NoMigrationsFound(t *testing.T) {
	tmpDir := t.TempDir()

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	fp := &fakePostgres{}
	applied, source, err := runMigrationsAuto(context.Background(), fp)
	if err != nil {
		t.Fatalf("runMigrationsAuto: %v", err)
		return
	}
	if applied != 0 {
		t.Errorf("expected 0 applied, got %d", applied)
	}
	if source != "" {
		t.Errorf("expected empty source, got %q", source)
	}
}

func TestRunMigrationsAuto_FilesystemError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a migrations directory.
	migDir := filepath.Join(tmpDir, "migrations")
	if err := os.MkdirAll(migDir, 0o700); err != nil {
		t.Fatalf("create migrations dir: %v", err)
		return
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
		return
	}
	defer func() { _ = os.Chdir(origDir) }()

	fp := &fakePostgres{migrationsErr: fmt.Errorf("migration failed")}
	_, _, err := runMigrationsAuto(context.Background(), fp)
	if err == nil {
		t.Fatal("expected error from migrations")
		return
	}
}

func TestDownFromPID_SuccessWithRunningProcess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".niuu")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
		return
	}

	// Start a sleep process that we can signal.
	cmd := exec.CommandContext(context.Background(), "sleep", "60") //nolint:gosec // test process
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sleep process: %v", err)
		return
	}
	pid := cmd.Process.Pid

	// Write PID file with the sleep process PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		_ = cmd.Process.Kill()
		t.Fatalf("write PID file: %v", err)
		return
	}

	// Write state file that should be cleaned up.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, []byte("[]"), 0o600); err != nil {
		_ = cmd.Process.Kill()
		t.Fatalf("write state file: %v", err)
		return
	}

	err := DownFromPID()
	if err != nil {
		t.Fatalf("DownFromPID: %v", err)
		return
	}

	// PID file should be cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}

	// State file should be cleaned up.
	if _, err := os.Stat(stateFilePath); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}

	// Clean up: the process was signaled, wait for it.
	_ = cmd.Wait()
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && containsSubstring(s, substr)
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
