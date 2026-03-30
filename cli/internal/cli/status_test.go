package cli

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

// writeTestConfigSimple writes a simple config yaml to the dir.
func writeTestConfigSimple(t *testing.T, dir, mode string) {
	t.Helper()
	cfg := `volundr:
  mode: ` + mode + `
  web: true
  forge:
    listen: "127.0.0.1:8080"
    max_concurrent: 4
listen:
  host: "127.0.0.1"
  port: 8080
database:
  mode: embedded
  port: 5433
  user: volundr
  password: testpass
  name: volundr
`
	err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(cfg), 0o600)
	if err != nil {
		t.Fatalf("write config: %v", err)
	}
}

func TestRunStatus_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "mini")

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_JSON_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "mini")

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus JSON: %v", err)
	}

	// Read and validate JSON output.
	var result DetailedStatus
	if decErr := json.NewDecoder(r).Decode(&result); decErr != nil {
		t.Fatalf("decode JSON: %v", decErr)
	}

	if result.Mode != "mini" {
		t.Errorf("expected mode mini, got %s", result.Mode)
	}
	if result.Server.Status != "stopped" {
		t.Errorf("expected server stopped, got %s", result.Server.Status)
	}
}

func TestRunStatus_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a state file with services that have PID and port values.
	stateContent := `{"runtime":"mini","services":[{"name":"forge","state":"running","pid":12345,"port":8080},{"name":"postgres","state":"running","pid":0,"port":0,"error":""}]}`
	if err := os.WriteFile(tmpDir+"/state.json", []byte(stateContent), 0o600); err != nil {
		t.Fatalf("write state: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_WithPIDFile_DeadProcess(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "mini")

	// Write a PID file with a PID that doesn't exist (99999999).
	pidFile := filepath.Join(tmpDir, "volundr.pid")
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

func TestRunStatus_NoConfig_Fallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// No config file — should fall back to StatusFromStateFile.
	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_NoConfig_JSON_Fallback(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus: %v", err)
	}

	var result DetailedStatus
	if decErr := json.NewDecoder(r).Decode(&result); decErr != nil {
		t.Fatalf("decode JSON: %v", decErr)
	}
	if result.Server.Status != "stopped" {
		t.Errorf("expected server stopped, got %s", result.Server.Status)
	}
}

func TestRunStatus_K3sMode_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "k3s")

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_K3sMode_JSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "k3s")

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus: %v", err)
	}

	var result DetailedStatus
	if decErr := json.NewDecoder(r).Decode(&result); decErr != nil {
		t.Fatalf("decode JSON: %v", decErr)
	}
	if result.Mode != "k3s" {
		t.Errorf("expected mode k3s, got %s", result.Mode)
	}
}

func TestRunStatus_WithStateFile_Running(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "mini")

	// Write PID file with our own PID (guaranteed to be alive).
	pidFile := filepath.Join(tmpDir, "volundr.pid")
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	// Write state file.
	stateData := `[
		{"name": "proxy", "state": "running", "port": 8080},
		{"name": "api", "state": "running", "pid": 12345, "port": 8081},
		{"name": "postgres", "state": "running", "port": 5433}
	]`
	if err := os.WriteFile(filepath.Join(tmpDir, "state.json"), []byte(stateData), 0o600); err != nil {
		t.Fatalf("write state: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus: %v", err)
	}

	var result DetailedStatus
	if decErr := json.NewDecoder(r).Decode(&result); decErr != nil {
		t.Fatalf("decode JSON: %v", decErr)
	}

	if result.Server.Status != "running" {
		t.Errorf("expected server running, got %s", result.Server.Status)
	}
	if result.Server.Address != "127.0.0.1:8080" {
		t.Errorf("expected address 127.0.0.1:8080, got %s", result.Server.Address)
	}
	if result.Database == nil {
		t.Fatal("expected database info")
	}
	if result.Database.Port != 5433 {
		t.Errorf("expected db port 5433, got %d", result.Database.Port)
	}
}

func TestRunStatus_WithStateFile_TextOutput(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	writeTestConfigSimple(t, tmpDir, "mini")

	pidFile := filepath.Join(tmpDir, "volundr.pid")
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	stateData := `[
		{"name": "proxy", "state": "running", "port": 8080},
		{"name": "api", "state": "running", "pid": 12345, "port": 8081},
		{"name": "postgres", "state": "running", "port": 5433}
	]`
	if err := os.WriteFile(filepath.Join(tmpDir, "state.json"), []byte(stateData), 0o600); err != nil {
		t.Fatalf("write state: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	// Should not error — just prints.
	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_MiniWithSessions(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create a mock server that serves sessions and stats.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/volundr/stats":
			_, _ = w.Write([]byte(`{"active_sessions": 2, "total_sessions": 3}`))
		case "/api/v1/volundr/sessions":
			_, _ = w.Write([]byte(`[
				{"id": "a1b2c3d4e5f6", "name": "fix-auth", "status": "running", "model": "claude-sonnet-4", "repo": "github.com/org/api", "created_at": "` + time.Now().Add(-12*time.Minute).Format(time.RFC3339) + `"},
				{"id": "g7h8i9j0k1l2", "name": "add-tests", "status": "running", "model": "claude-sonnet-4", "repo": "github.com/org/web", "created_at": "` + time.Now().Add(-3*time.Minute).Format(time.RFC3339) + `"},
				{"id": "m3n4o5p6q7r8", "name": "refactor-db", "status": "stopped", "model": "claude-sonnet-4", "repo": "github.com/org/core", "created_at": "` + time.Now().Add(-1*time.Hour).Format(time.RFC3339) + `"}
			]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	// Parse the server address to get host and port for config.
	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())

	// Write config pointing to our mock server.
	cfgData := `volundr:
  mode: mini
  web: true
  forge:
    listen: "` + host + `:` + portStr + `"
    max_concurrent: 4
listen:
  host: "` + host + `"
  port: ` + portStr + `
database:
  mode: embedded
  port: 5433
  user: volundr
  password: testpass
  name: volundr
`
	if err := os.WriteFile(filepath.Join(tmpDir, "config.yaml"), []byte(cfgData), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// Write PID + state to indicate running.
	if err := os.WriteFile(filepath.Join(tmpDir, "volundr.pid"), []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write pid: %v", err)
	}
	stateData := `[{"name": "proxy", "state": "running", "port": 8080}]`
	if err := os.WriteFile(filepath.Join(tmpDir, "state.json"), []byte(stateData), 0o600); err != nil {
		t.Fatalf("write state: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus: %v", err)
	}

	var result DetailedStatus
	if decErr := json.NewDecoder(r).Decode(&result); decErr != nil {
		t.Fatalf("decode JSON: %v", decErr)
	}

	if result.Sessions == nil {
		t.Fatal("expected sessions info")
	}
	if result.Sessions.Active != 2 {
		t.Errorf("expected 2 active sessions, got %d", result.Sessions.Active)
	}
	if result.Sessions.Total != 3 {
		t.Errorf("expected 3 total sessions, got %d", result.Sessions.Total)
	}
	if len(result.Sessions.List) != 3 {
		t.Errorf("expected 3 sessions in list, got %d", len(result.Sessions.List))
	}
}

func TestBuildDetailedStatus_MiniRunning(t *testing.T) {
	cfg := &config.Config{
		Volundr: config.VolundrConfig{
			Mode: "mini",
			Web:  true,
			Forge: config.ForgeSettings{
				MaxConcurrent: 4,
			},
		},
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	stack := &runtime.StackStatus{
		Runtime: "local",
		Services: []runtime.ServiceStatus{
			{Name: "proxy", State: runtime.StateRunning, Port: 8080},
			{Name: "api", State: runtime.StateRunning, PID: 12345, Port: 8081},
			{Name: "postgres", State: runtime.StateRunning, Port: 5433},
		},
	}

	ds := buildDetailedStatus("mini", cfg, stack)

	if ds.Mode != "mini" {
		t.Errorf("expected mode mini, got %s", ds.Mode)
	}
	if ds.Server.Status != "running" {
		t.Errorf("expected server running, got %s", ds.Server.Status)
	}
	if ds.Server.Address != "127.0.0.1:8080" {
		t.Errorf("expected address 127.0.0.1:8080, got %s", ds.Server.Address)
	}
	if ds.WebUI != "http://127.0.0.1:8080" {
		t.Errorf("expected web UI url, got %s", ds.WebUI)
	}
	if ds.Database == nil || ds.Database.Port != 5433 {
		t.Errorf("expected database on port 5433")
	}
	if ds.Sessions == nil || ds.Sessions.Max != 4 {
		t.Errorf("expected sessions max 4")
	}
}

func TestBuildDetailedStatus_MiniStopped(t *testing.T) {
	cfg := &config.Config{
		Volundr: config.VolundrConfig{
			Mode: "mini",
			Forge: config.ForgeSettings{
				MaxConcurrent: 4,
			},
		},
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	stack := &runtime.StackStatus{
		Runtime: "local",
		Services: []runtime.ServiceStatus{
			{Name: "volundr", State: runtime.StateStopped},
		},
	}

	ds := buildDetailedStatus("mini", cfg, stack)

	if ds.Server.Status != "stopped" {
		t.Errorf("expected server stopped, got %s", ds.Server.Status)
	}
	if ds.WebUI != "" {
		t.Errorf("expected no web UI when stopped, got %s", ds.WebUI)
	}
	if ds.Server.Address != "" {
		t.Errorf("expected no address when stopped, got %s", ds.Server.Address)
	}
}

func TestBuildDetailedStatus_K3sWithPods(t *testing.T) {
	cfg := &config.Config{
		Volundr: config.VolundrConfig{Mode: "k3s"},
		Listen:  config.ListenConfig{Host: "127.0.0.1", Port: 8080},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	stack := &runtime.StackStatus{
		Runtime: "k3s",
		Services: []runtime.ServiceStatus{
			{Name: "proxy", State: runtime.StateRunning, Port: 8080},
			{Name: "api", State: runtime.StateRunning, Port: 18080},
			{Name: "postgres", State: runtime.StateRunning, Port: 5433},
			{Name: "k3s-cluster", State: runtime.StateRunning},
			{Name: "session-a1b2c3-skuld", State: runtime.StateRunning},
			{Name: "tyr-7f8d9e-abc", State: runtime.StateRunning},
		},
	}

	ds := buildDetailedStatus("k3s", cfg, stack)

	if ds.Mode != "k3s" {
		t.Errorf("expected mode k3s, got %s", ds.Mode)
	}
	if ds.Cluster == nil {
		t.Fatal("expected cluster info")
	}
	if ds.Cluster.Status != "running" {
		t.Errorf("expected cluster running, got %s", ds.Cluster.Status)
	}
	// Tyr should be detected from tyr-prefixed pod and excluded from pods list.
	if ds.Tyr == nil {
		t.Fatal("expected tyr info from tyr-prefixed pod")
	}
	if len(ds.Pods) != 1 {
		t.Errorf("expected 1 pod (tyr excluded), got %d", len(ds.Pods))
	}
	if len(ds.Pods) > 0 && ds.Pods[0].Name != "session-a1b2c3-skuld" {
		t.Errorf("expected session pod, got %s", ds.Pods[0].Name)
	}
}

func TestBuildDetailedStatus_WithTyrService(t *testing.T) {
	cfg := &config.Config{
		Volundr: config.VolundrConfig{Mode: "mini"},
		Listen:  config.ListenConfig{Host: "127.0.0.1", Port: 8080},
	}

	stack := &runtime.StackStatus{
		Runtime: "local",
		Services: []runtime.ServiceStatus{
			{Name: "proxy", State: runtime.StateRunning, Port: 8080},
			{Name: "tyr", State: runtime.StateRunning, Port: 8081, PID: 99999},
		},
	}

	ds := buildDetailedStatus("mini", cfg, stack)

	if ds.Tyr == nil {
		t.Fatal("expected tyr info")
	}
	if ds.Tyr.Status != "running" {
		t.Errorf("expected tyr running, got %s", ds.Tyr.Status)
	}
	if ds.Tyr.PID != 99999 {
		t.Errorf("expected tyr PID 99999, got %d", ds.Tyr.PID)
	}
	if ds.Tyr.Address != "127.0.0.1:8081" {
		t.Errorf("expected tyr address 127.0.0.1:8081, got %s", ds.Tyr.Address)
	}
}

func TestInferServerState(t *testing.T) {
	tests := []struct {
		name     string
		services []runtime.ServiceStatus
		expected string
	}{
		{
			name:     "empty services",
			services: nil,
			expected: "stopped",
		},
		{
			name: "volundr stopped",
			services: []runtime.ServiceStatus{
				{Name: "volundr", State: runtime.StateStopped},
			},
			expected: "stopped",
		},
		{
			name: "volundr running",
			services: []runtime.ServiceStatus{
				{Name: "volundr", State: runtime.StateRunning},
			},
			expected: "running",
		},
		{
			name: "proxy running",
			services: []runtime.ServiceStatus{
				{Name: "proxy", State: runtime.StateRunning, Port: 8080},
				{Name: "api", State: runtime.StateRunning, Port: 8081},
			},
			expected: "running",
		},
		{
			name: "proxy stopped but postgres running",
			services: []runtime.ServiceStatus{
				{Name: "proxy", State: runtime.StateStopped, Port: 8080},
				{Name: "postgres", State: runtime.StateRunning, Port: 5433},
			},
			expected: "stopped",
		},
		{
			name: "proxy in error state",
			services: []runtime.ServiceStatus{
				{Name: "proxy", State: runtime.StateError, Port: 8080},
				{Name: "postgres", State: runtime.StateRunning, Port: 5433},
			},
			expected: "error",
		},
		{
			name: "only postgres running",
			services: []runtime.ServiceStatus{
				{Name: "postgres", State: runtime.StateRunning, Port: 5433},
			},
			expected: "stopped",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := inferServerState(tt.services)
			if result != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, result)
			}
		})
	}
}

func TestFindService(t *testing.T) {
	services := []runtime.ServiceStatus{
		{Name: "proxy", State: runtime.StateRunning, Port: 8080},
		{Name: "api", State: runtime.StateRunning, PID: 123, Port: 8081},
		{Name: "postgres", State: runtime.StateRunning, Port: 5433},
	}

	svc := findService("api", services)
	if svc == nil {
		t.Fatal("expected to find api service")
	}
	if svc.PID != 123 {
		t.Errorf("expected PID 123, got %d", svc.PID)
	}

	svc = findService("nonexistent", services)
	if svc != nil {
		t.Error("expected nil for nonexistent service")
	}
}

func TestFindServicePrefix(t *testing.T) {
	services := []runtime.ServiceStatus{
		{Name: "proxy", State: runtime.StateRunning},
		{Name: "tyr-abc-123", State: runtime.StateRunning, Port: 8081},
	}

	svc := findServicePrefix("tyr", services)
	if svc == nil {
		t.Fatal("expected to find tyr-prefixed service")
	}
	if svc.Name != "tyr-abc-123" {
		t.Errorf("expected tyr-abc-123, got %s", svc.Name)
	}

	svc = findServicePrefix("missing", services)
	if svc != nil {
		t.Error("expected nil for missing prefix")
	}
}

func TestFindServicePID(t *testing.T) {
	services := []runtime.ServiceStatus{
		{Name: "api", State: runtime.StateRunning, PID: 456},
	}

	pid := findServicePID("api", services)
	if pid != 456 {
		t.Errorf("expected PID 456, got %d", pid)
	}

	pid = findServicePID("missing", services)
	if pid != 0 {
		t.Errorf("expected PID 0, got %d", pid)
	}
}

func TestFormatAge(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "30s"},
		{5 * time.Minute, "5m"},
		{90 * time.Minute, "1h"},
		{3 * time.Hour, "3h"},
		{36 * time.Hour, "1d"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := formatAge(tt.d)
			if got != tt.want {
				t.Errorf("formatAge(%v) = %s, want %s", tt.d, got, tt.want)
			}
		})
	}
}

func TestPrintDetailedStatus_Stopped(t *testing.T) {
	ds := DetailedStatus{
		Mode: "mini",
		Server: ServerInfo{
			Status: "stopped",
		},
	}

	// Should not panic.
	printDetailedStatus(&ds)
}

func TestPrintDetailedStatus_Running(t *testing.T) {
	ds := DetailedStatus{
		Mode: "mini",
		Server: ServerInfo{
			Status:  "running",
			Address: "127.0.0.1:8080",
			PID:     12345,
		},
		WebUI: "http://127.0.0.1:8080",
		Tyr: &ServiceInfo{
			Status:  "running",
			Address: "127.0.0.1:8081",
			PID:     12346,
		},
		Database: &DatabaseInfo{
			Status: "running",
			Mode:   "embedded",
			Port:   5433,
		},
		Sessions: &SessionSummary{
			Active: 2,
			Max:    4,
			Total:  3,
			List: []SessionInfo{
				{ID: "a1b2c3d4e5f6", Name: "fix-auth", Status: "running", Model: "claude-sonnet-4", Repo: "github.com/org/api", Age: "12m"},
				{ID: "g7h8i9j0k1l2", Name: "add-tests", Status: "running", Model: "claude-sonnet-4", Repo: "github.com/org/web", Age: "3m"},
			},
		},
	}

	// Should not panic.
	printDetailedStatus(&ds)
}

func TestPrintDetailedStatus_K3sWithPods(t *testing.T) {
	ds := DetailedStatus{
		Mode: "k3s",
		Server: ServerInfo{
			Status:  "running",
			Address: "127.0.0.1:8080",
		},
		Cluster: &ClusterInfo{
			Name:   "k3d-volundr",
			Status: "running",
		},
		Database: &DatabaseInfo{
			Status: "running",
			Mode:   "embedded",
			Port:   5433,
		},
		Pods: []PodInfo{
			{Name: "session-a1b2c3-skuld", Status: "running"},
			{Name: "tyr-7f8d9e-abc", Status: "running"},
		},
	}

	// Should not panic.
	printDetailedStatus(&ds)
}

func TestPrintDetailedStatus_EmptyMode(t *testing.T) {
	ds := DetailedStatus{
		Mode:   "",
		Server: ServerInfo{Status: "stopped"},
	}

	// Should default to "local" in display.
	printDetailedStatus(&ds)
}

func TestFetchMiniSessions_ServerDown(t *testing.T) {
	cfg := &config.Config{
		Listen: config.ListenConfig{Host: "127.0.0.1", Port: 19999},
		Volundr: config.VolundrConfig{
			Forge: config.ForgeSettings{MaxConcurrent: 4},
		},
	}

	ds := DetailedStatus{
		Sessions: &SessionSummary{Max: 4},
	}

	// Should not panic when server is unreachable.
	fetchMiniSessions(&ds, cfg)

	// Sessions should remain at defaults since server is down.
	if ds.Sessions.Active != 0 {
		t.Errorf("expected 0 active sessions, got %d", ds.Sessions.Active)
	}
}

func TestFetchMiniSessions_WithMockServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/volundr/stats":
			_, _ = w.Write([]byte(`{"active_sessions": 1, "total_sessions": 2}`))
		case "/api/v1/volundr/sessions":
			_, _ = w.Write([]byte(`[
				{"id": "abc123def456", "name": "test-session", "status": "running", "model": "claude-sonnet-4", "source": {"repo": "github.com/test/repo"}, "created_at": "` + time.Now().Add(-5*time.Minute).Format(time.RFC3339) + `"}
			]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	// Parse host/port from server.
	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)

	cfg := &config.Config{
		Listen: config.ListenConfig{Host: host, Port: port},
		Volundr: config.VolundrConfig{
			Forge: config.ForgeSettings{MaxConcurrent: 4},
		},
	}

	ds := DetailedStatus{}
	fetchMiniSessions(&ds, cfg)

	if ds.Sessions == nil {
		t.Fatal("expected sessions to be populated")
	}
	if ds.Sessions.Active != 1 {
		t.Errorf("expected 1 active, got %d", ds.Sessions.Active)
	}
	if ds.Sessions.Total != 2 {
		t.Errorf("expected 2 total, got %d", ds.Sessions.Total)
	}
	if len(ds.Sessions.List) != 1 {
		t.Fatalf("expected 1 session in list, got %d", len(ds.Sessions.List))
	}

	sess := ds.Sessions.List[0]
	if sess.Name != "test-session" {
		t.Errorf("expected name test-session, got %s", sess.Name)
	}
	if sess.Repo != "github.com/test/repo" {
		t.Errorf("expected repo github.com/test/repo, got %s", sess.Repo)
	}
	if sess.Age == "" {
		t.Error("expected age to be set")
	}
}

func TestFetchMiniSessions_StatsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/volundr/stats":
			w.WriteHeader(http.StatusInternalServerError)
		case "/api/v1/volundr/sessions":
			_, _ = w.Write([]byte(`[{"id": "abc123", "name": "s1", "status": "running", "model": "m", "created_at": "` + time.Now().Format(time.RFC3339) + `"}]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)

	cfg := &config.Config{
		Listen: config.ListenConfig{Host: host, Port: port},
		Volundr: config.VolundrConfig{
			Forge: config.ForgeSettings{MaxConcurrent: 4},
		},
	}

	ds := DetailedStatus{}
	fetchMiniSessions(&ds, cfg)

	// Stats failed but sessions should still be fetched.
	if ds.Sessions == nil {
		t.Fatal("expected sessions to be populated")
	}
	if len(ds.Sessions.List) != 1 {
		t.Errorf("expected 1 session, got %d", len(ds.Sessions.List))
	}
}

func TestFetchMiniSessions_SessionsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/volundr/stats":
			_, _ = w.Write([]byte(`{"active_sessions": 1, "total_sessions": 1}`))
		case "/api/v1/volundr/sessions":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	host, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)

	cfg := &config.Config{
		Listen: config.ListenConfig{Host: host, Port: port},
		Volundr: config.VolundrConfig{
			Forge: config.ForgeSettings{MaxConcurrent: 4},
		},
	}

	ds := DetailedStatus{}
	fetchMiniSessions(&ds, cfg)

	// Stats should succeed even if sessions fail.
	if ds.Sessions == nil {
		t.Fatal("expected sessions from stats")
	}
	if ds.Sessions.Active != 1 {
		t.Errorf("expected 1 active, got %d", ds.Sessions.Active)
	}
	if len(ds.Sessions.List) != 0 {
		t.Errorf("expected 0 sessions in list, got %d", len(ds.Sessions.List))
	}
}
