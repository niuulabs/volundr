package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestNewLocalRuntime(t *testing.T) {
	r := NewLocalRuntime()
	if r == nil {
		t.Fatal("expected non-nil LocalRuntime")
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with our own PID (so it's a running process).
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestLocalRuntime_Status_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
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
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if len(status.Services) != 3 {
		t.Fatalf("expected 3 services, got %d", len(status.Services))
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	// Write a corrupt state file.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, []byte("not-json"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	r := NewLocalRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	// Should fall back to a generic running status.
	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}
	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestLocalRuntime_Logs(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
	}

	// Write a test log file.
	logContent := "test log line 1\ntest log line 2\n"
	if err := os.WriteFile(filepath.Join(logsDir, "api.log"), []byte(logContent), 0o600); err != nil {
		t.Fatalf("write log file: %v", err)
	}

	r := NewLocalRuntime()
	reader, err := r.Logs(context.Background(), "api", false)
	if err != nil {
		t.Fatalf("Logs: %v", err)
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewLocalRuntime()
	_, err := r.Logs(context.Background(), "nonexistent", false)
	if err == nil {
		t.Fatal("expected error for missing log file")
	}
}

func TestLocalRuntime_WriteStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
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
	}

	// Read back and verify.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("unmarshal: %v", err)
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
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
	}

	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("unmarshal: %v", err)
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
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
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	defer func() { _ = os.Chdir(origDir) }()

	result := findMigrationsDir()
	if result == "" {
		t.Fatal("expected non-empty migrations dir")
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
	}

	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.MkdirAll(subDir, 0o700); err != nil {
		t.Fatalf("create subdir: %v", err)
	}

	origDir, _ := os.Getwd()
	if err := os.Chdir(subDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	defer func() { _ = os.Chdir(origDir) }()

	result := findMigrationsDir()
	if result == "" {
		t.Fatal("expected non-empty migrations dir from parent")
	}
}

func TestStatusFromStateFile_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	if status.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped, got %q", status.Services[0].State)
	}
}

func TestStatusFromStateFile_StalePID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with a PID that is very unlikely to be running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped for stale PID, got %q", status.Services[0].State)
	}
}

func TestStatusFromStateFile_RunningWithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with our own PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	// Write a state file.
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
		{Name: "api", State: StateRunning, Port: 8081},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	if len(status.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(status.Services))
	}

	if status.Services[0].Name != "proxy" {
		t.Errorf("expected first service 'proxy', got %q", status.Services[0].Name)
	}
}

func TestStatusFromStateFile_RunningNoStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with our own PID (so it's running).
	pidPath := filepath.Join(volundrDir, PIDFile)
	pid := os.Getpid()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with our own PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	pid := os.Getpid()
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(pid)), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	// Write a corrupt state file.
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("{invalid"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
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

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with a non-numeric PID.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-pid"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	// Write a state file.
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	status, err := StatusFromStateFile()
	if err != nil {
		t.Fatalf("StatusFromStateFile: %v", err)
	}

	// Invalid PID means we can't verify process status, but the state file
	// should still be read. The function should return services from the state file.
	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}
}

func TestDownFromPID_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	err := DownFromPID()
	if err == nil {
		t.Fatal("expected error when no PID file")
	}

	if !contains(err.Error(), "no running instance") {
		t.Errorf("expected 'no running instance' error, got: %v", err)
	}
}

func TestDownFromPID_InvalidPID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-number"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	err := DownFromPID()
	if err == nil {
		t.Fatal("expected error for invalid PID")
	}

	if !contains(err.Error(), "parse PID") {
		t.Errorf("expected 'parse PID' error, got: %v", err)
	}
}

func TestDownFromPID_StalePID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a PID file with a PID that's very unlikely to be running.
	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	// Also write a state file that should be cleaned up.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	if err := os.WriteFile(stateFilePath, []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	err := DownFromPID()
	// Error is expected because the process can't be signaled.
	if err == nil {
		t.Fatal("expected error for stale PID")
	}

	// PID file should be cleaned up.
	if _, err := os.Stat(pidPath); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
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
