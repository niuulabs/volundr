package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestCheckPIDFile_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()

	pid, running := checkPIDFile(tmpDir)
	if running {
		t.Error("expected not running when no PID file")
	}
	if pid != 0 {
		t.Errorf("expected pid 0, got %d", pid)
	}
}

func TestCheckPIDFile_InvalidPID(t *testing.T) {
	tmpDir := t.TempDir()

	pidPath := filepath.Join(tmpDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("not-a-number"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	pid, running := checkPIDFile(tmpDir)
	if running {
		t.Error("expected not running for invalid PID")
	}
	if pid != 0 {
		t.Errorf("expected pid 0, got %d", pid)
	}
}

func TestCheckPIDFile_StalePID(t *testing.T) {
	tmpDir := t.TempDir()

	pidPath := filepath.Join(tmpDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("999999999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	pid, running := checkPIDFile(tmpDir)
	if running {
		t.Error("expected not running for stale PID")
	}
	if pid != 0 {
		t.Errorf("expected pid 0, got %d", pid)
	}
}

func TestCheckPIDFile_RunningProcess(t *testing.T) {
	tmpDir := t.TempDir()

	pidPath := filepath.Join(tmpDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	pid, running := checkPIDFile(tmpDir)
	if !running {
		t.Error("expected running for own PID")
	}
	if pid != os.Getpid() {
		t.Errorf("expected pid %d, got %d", os.Getpid(), pid)
	}
}

func TestLocalRuntime_RichStatus_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	r := NewLocalRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "local" {
		t.Errorf("expected mode 'local', got %q", rs.Mode)
	}

	if rs.Server.Status != "stopped" {
		t.Errorf("expected server status 'stopped', got %q", rs.Server.Status)
	}

	if rs.Database.Status != "stopped" {
		t.Errorf("expected database status 'stopped', got %q", rs.Database.Status)
	}

	if rs.Sessions.Max != config.DefaultMaxSessions {
		t.Errorf("expected max sessions %d, got %d", config.DefaultMaxSessions, rs.Sessions.Max)
	}

	if rs.Sessions.Active != 0 {
		t.Errorf("expected 0 active sessions, got %d", rs.Sessions.Active)
	}
}

func TestLocalRuntime_RichStatus_Running(t *testing.T) {
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

	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	r := NewLocalRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "local" {
		t.Errorf("expected mode 'local', got %q", rs.Mode)
	}

	if rs.Server.Status != "running" {
		t.Errorf("expected server status 'running', got %q", rs.Server.Status)
	}

	if rs.Server.Address != "127.0.0.1:8080" {
		t.Errorf("expected address '127.0.0.1:8080', got %q", rs.Server.Address)
	}

	if rs.Server.PID != os.Getpid() {
		t.Errorf("expected PID %d, got %d", os.Getpid(), rs.Server.PID)
	}

	if rs.WebUI != "http://127.0.0.1:8080" {
		t.Errorf("expected web UI 'http://127.0.0.1:8080', got %q", rs.WebUI)
	}

	if rs.Database.Status != "running" {
		t.Errorf("expected database status 'running', got %q", rs.Database.Status)
	}

	if rs.Database.Port != 5433 {
		t.Errorf("expected database port 5433, got %d", rs.Database.Port)
	}
}

func TestLocalRuntime_RichStatus_ExternalDB(t *testing.T) {
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

	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "external",
			Host: "db.example.com",
			Port: 5432,
		},
	}

	r := NewLocalRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Database.Detail != "external PostgreSQL at db.example.com:5432" {
		t.Errorf("unexpected database detail: %q", rs.Database.Detail)
	}
}

func TestRichStatus_JSONSerialization(t *testing.T) {
	rs := &RichStatus{
		Mode: "local",
		Server: ComponentStatus{
			Status:  "running",
			Address: "127.0.0.1:8080",
			PID:     12345,
		},
		WebUI: "http://127.0.0.1:8080",
		Database: ComponentStatus{
			Status: "running",
			Detail: "embedded PostgreSQL on port 5433",
			Port:   5433,
		},
		Sessions: SessionSummary{
			Active: 2,
			Max:    4,
			List: []SessionInfo{
				{
					ID:     "a1b2c3d4",
					Name:   "fix-auth-bug",
					Status: "running",
					Model:  "claude-sonnet-4",
					Repo:   "github.com/org/api",
				},
			},
		},
	}

	data, err := json.Marshal(rs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded RichStatus
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Mode != "local" {
		t.Errorf("expected mode 'local', got %q", decoded.Mode)
	}
	if decoded.Server.PID != 12345 {
		t.Errorf("expected PID 12345, got %d", decoded.Server.PID)
	}
	if decoded.Sessions.Active != 2 {
		t.Errorf("expected 2 active, got %d", decoded.Sessions.Active)
	}
	if len(decoded.Sessions.List) != 1 {
		t.Fatalf("expected 1 session in list, got %d", len(decoded.Sessions.List))
	}
	if decoded.Sessions.List[0].ID != "a1b2c3d4" {
		t.Errorf("expected session ID 'a1b2c3d4', got %q", decoded.Sessions.List[0].ID)
	}
	// Tyr and Cluster should be nil.
	if decoded.Tyr != nil {
		t.Error("expected nil Tyr")
	}
	if decoded.Cluster != nil {
		t.Error("expected nil Cluster")
	}
}

func TestDockerRuntime_RichStatus_Stopped(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	cfg := &config.Config{
		Runtime: "docker",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	r := NewDockerRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "docker" {
		t.Errorf("expected mode 'docker', got %q", rs.Mode)
	}

	if rs.Server.Status != "stopped" {
		t.Errorf("expected server status 'stopped', got %q", rs.Server.Status)
	}

	if rs.Sessions.Max != config.DefaultMaxSessions {
		t.Errorf("expected max sessions %d, got %d", config.DefaultMaxSessions, rs.Sessions.Max)
	}
}

func TestK3sRuntime_RichStatus_Stopped(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Mock exec so docker inspect fails (simulates no running container).
	withMockExecFail(t)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	cfg := &config.Config{
		Runtime: "k3s",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
		K3s: config.K3sConfig{
			Namespace: "volundr",
		},
	}

	r := NewK3sRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "k3s" {
		t.Errorf("expected mode 'k3s', got %q", rs.Mode)
	}

	if rs.Server.Status != "stopped" {
		t.Errorf("expected server status 'stopped', got %q", rs.Server.Status)
	}

	if rs.Sessions.Max != config.DefaultMaxSessions {
		t.Errorf("expected max sessions %d, got %d", config.DefaultMaxSessions, rs.Sessions.Max)
	}
}

func TestLocalRuntime_RichStatus_WithSessions(t *testing.T) {
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

	// Start a fake API server that returns sessions.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/sessions" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id": "aaaa-bbbb-cccc-dddd", "name": "test-session", "model": "claude-sonnet-4", "status": "running", "created_at": "2026-03-29T10:00:00Z", "source": {"type": "git", "repo": "github.com/org/repo"}},
			{"id": "eeee-ffff-0000-1111", "name": "stopped-session", "model": "claude-sonnet-4", "status": "stopped", "created_at": "2026-03-29T09:00:00Z", "source": {"type": "git", "repo": "github.com/org/other"}}
		]`))
	}))
	defer server.Close()

	// Parse the server address to use as listen config.
	// server.URL is like "http://127.0.0.1:PORT"
	addr := server.Listener.Addr().String()
	host, portStr, _ := splitHostPort(addr)
	port, _ := strconv.Atoi(portStr)

	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: host,
			Port: port,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	r := NewLocalRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Sessions.Active != 1 {
		t.Errorf("expected 1 active session, got %d", rs.Sessions.Active)
	}

	if len(rs.Sessions.List) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(rs.Sessions.List))
	}

	if rs.Sessions.List[0].Name != "test-session" {
		t.Errorf("expected name 'test-session', got %q", rs.Sessions.List[0].Name)
	}

	if rs.Sessions.List[0].Repo != "github.com/org/repo" {
		t.Errorf("expected repo 'github.com/org/repo', got %q", rs.Sessions.List[0].Repo)
	}
}

// splitHostPort splits a host:port string. Simple version for tests.
func splitHostPort(hostport string) (string, string, error) {
	colon := len(hostport) - 1
	for colon >= 0 && hostport[colon] != ':' {
		colon--
	}
	if colon < 0 {
		return hostport, "", nil
	}
	return hostport[:colon], hostport[colon+1:], nil
}

func TestDatabaseStatus_Embedded(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}
	cs := databaseStatus(cfg)
	if cs.Status != "running" {
		t.Errorf("expected 'running', got %q", cs.Status)
	}
	if cs.Port != 5433 {
		t.Errorf("expected port 5433, got %d", cs.Port)
	}
	if cs.Detail != "embedded PostgreSQL on port 5433" {
		t.Errorf("unexpected detail: %q", cs.Detail)
	}
}

func TestDatabaseStatus_External(t *testing.T) {
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode: "external",
			Host: "db.example.com",
			Port: 5432,
		},
	}
	cs := databaseStatus(cfg)
	if cs.Status != "running" {
		t.Errorf("expected 'running', got %q", cs.Status)
	}
	if cs.Detail != "external PostgreSQL at db.example.com:5432" {
		t.Errorf("unexpected detail: %q", cs.Detail)
	}
}

func TestBuildSessionSummary_Unreachable(t *testing.T) {
	summary := buildSessionSummary(context.Background(), "127.0.0.1:1", config.DefaultMaxSessions)
	if summary.Active != 0 {
		t.Errorf("expected 0 active, got %d", summary.Active)
	}
	if summary.Max != config.DefaultMaxSessions {
		t.Errorf("expected max %d, got %d", config.DefaultMaxSessions, summary.Max)
	}
	if len(summary.List) != 0 {
		t.Errorf("expected empty list, got %d", len(summary.List))
	}
}

func TestBuildSessionSummary_WithServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id": "aaaa-bbbb", "name": "s1", "model": "m1", "status": "running", "created_at": "", "source": {"type": "git", "repo": "r1"}},
			{"id": "cccc-dddd", "name": "s2", "model": "m2", "status": "stopped", "created_at": "", "source": {"type": "git", "repo": "r2"}}
		]`))
	}))
	defer server.Close()

	addr := server.Listener.Addr().String()
	summary := buildSessionSummary(context.Background(), addr, config.DefaultMaxSessions)
	if summary.Active != 1 {
		t.Errorf("expected 1 active, got %d", summary.Active)
	}
	if len(summary.List) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(summary.List))
	}
}

func TestDockerRuntime_RichStatus_Running(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Mock docker inspect to return "running".
	withMockExec(t, "MOCK_RESPONSE=running")

	cfg := &config.Config{
		Runtime: "docker",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	r := NewDockerRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "docker" {
		t.Errorf("expected mode 'docker', got %q", rs.Mode)
	}

	if rs.Server.Status != "running" {
		t.Errorf("expected server status 'running', got %q", rs.Server.Status)
	}

	if rs.WebUI != "http://127.0.0.1:8080" {
		t.Errorf("expected web UI, got %q", rs.WebUI)
	}

	if rs.Database.Status != "running" {
		t.Errorf("expected database running, got %q", rs.Database.Status)
	}
}

func TestK3sRuntime_RichStatus_Running(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Mock commands: docker inspect returns "running", k3d cluster list returns cluster info,
	// kubectl returns pod list.
	mockCmds := `docker:::running|||k3d:::[{"name":"volundr","serversRunning":1}]|||kubectl:::{"items":[]}`
	withMockExec(t, "MOCK_COMMANDS="+mockCmds)

	cfg := &config.Config{
		Runtime: "k3s",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
		K3s: config.K3sConfig{
			Namespace: "volundr",
		},
	}

	r := NewK3sRuntime()
	rs, err := r.RichStatus(context.Background(), cfg)
	if err != nil {
		t.Fatalf("RichStatus: %v", err)
	}

	if rs.Mode != "k3s" {
		t.Errorf("expected mode 'k3s', got %q", rs.Mode)
	}

	if rs.Server.Status != "running" {
		t.Errorf("expected server status 'running', got %q", rs.Server.Status)
	}

	if rs.Cluster == nil {
		t.Fatal("expected non-nil Cluster")
	}

	if rs.Cluster.Status != "running" {
		t.Errorf("expected cluster status 'running', got %q", rs.Cluster.Status)
	}

	if rs.Database.Status != "running" {
		t.Errorf("expected database running, got %q", rs.Database.Status)
	}
}

func TestRichStatus_K3s_JSONSerialization(t *testing.T) {
	rs := &RichStatus{
		Mode: "k3s",
		Server: ComponentStatus{
			Status: "running",
			Detail: "Docker container volundr-k3s-api",
		},
		Cluster: &ClusterStatus{
			Name:   "k3d-volundr",
			Status: "running",
		},
		Database: ComponentStatus{
			Status: "running",
			Port:   5433,
		},
		Proxy: "http://127.0.0.1:8080",
		Sessions: SessionSummary{
			Active: 1,
			Max:    4,
		},
		Pods: []PodStatus{
			{Name: "session-abc-skuld", Ready: "3/3", Status: "Running", Age: "12m"},
		},
	}

	data, err := json.Marshal(rs)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded RichStatus
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Mode != "k3s" {
		t.Errorf("expected mode 'k3s', got %q", decoded.Mode)
	}
	if decoded.Cluster == nil {
		t.Fatal("expected non-nil Cluster")
	}
	if decoded.Cluster.Name != "k3d-volundr" {
		t.Errorf("expected cluster name 'k3d-volundr', got %q", decoded.Cluster.Name)
	}
	if len(decoded.Pods) != 1 {
		t.Fatalf("expected 1 pod, got %d", len(decoded.Pods))
	}
	if decoded.Pods[0].Name != "session-abc-skuld" {
		t.Errorf("expected pod name 'session-abc-skuld', got %q", decoded.Pods[0].Name)
	}
}
