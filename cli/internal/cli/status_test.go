package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
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

func TestRunStatus_WithConfig_NoPID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a valid config file.
	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
			User: "volundr",
			Name: "volundr",
		},
	}
	if err := cfg.SaveTo(filepath.Join(tmpDir, "config.yaml")); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	// Should succeed showing stopped status.
	if err := runStatus(nil, nil); err != nil {
		t.Fatalf("runStatus: %v", err)
	}
}

func TestRunStatus_WithConfig_JSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a valid config file.
	cfg := &config.Config{
		Runtime: "local",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
			User: "volundr",
			Name: "volundr",
		},
	}
	if err := cfg.SaveTo(filepath.Join(tmpDir, "config.yaml")); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	r, w, _ := os.Pipe()
	old := os.Stdout
	os.Stdout = w

	err := runStatus(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatus JSON: %v", err)
	}

	// Verify it's valid JSON.
	var rs runtime.RichStatus
	if err := json.NewDecoder(r).Decode(&rs); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}

	if rs.Mode != "local" {
		t.Errorf("expected mode 'local', got %q", rs.Mode)
	}

	if rs.Server.Status != "stopped" {
		t.Errorf("expected server status 'stopped', got %q", rs.Server.Status)
	}
}

func TestRunStatusFallback_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatusFallback(); err != nil {
		t.Fatalf("runStatusFallback: %v", err)
	}
}

func TestRunStatusFallback_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a PID file with our own PID.
	pidFile := tmpDir + "/volundr.pid"
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d", os.Getpid())), 0o600); err != nil {
		t.Fatalf("write pid file: %v", err)
	}

	// Write a state file with services.
	stateFile := tmpDir + "/state.json"
	stateData := `[{"name":"api","state":"running","port":8081},{"name":"postgres","state":"running","port":5433}]`
	if err := os.WriteFile(stateFile, []byte(stateData), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runStatusFallback(); err != nil {
		t.Fatalf("runStatusFallback: %v", err)
	}
}

func TestRunStatusFallback_JSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := runStatusFallback()

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runStatusFallback JSON: %v", err)
	}
}

func TestFormatAge(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty string", "", ""},
		{"invalid timestamp", "not-a-date", "not-a-date"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatAge(tt.input)
			if result != tt.expected {
				t.Errorf("formatAge(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestFormatAge_Recent(t *testing.T) {
	// Use a recent RFC3339 timestamp.
	result := formatAge("2020-01-01T00:00:00Z")
	// Should be something like "NNd" (many days ago).
	if result == "" || result == "2020-01-01T00:00:00Z" {
		t.Errorf("expected formatted age, got %q", result)
	}
}

func TestFormatAge_RFC3339Nano(t *testing.T) {
	result := formatAge("2020-01-01T00:00:00.000000000Z")
	if result == "" || result == "2020-01-01T00:00:00.000000000Z" {
		t.Errorf("expected formatted age, got %q", result)
	}
}

func TestFormatAge_NoTimezone(t *testing.T) {
	result := formatAge("2020-01-01T00:00:00")
	if result == "" || result == "2020-01-01T00:00:00" {
		t.Errorf("expected formatted age, got %q", result)
	}
}

func TestFormatAge_Minutes(t *testing.T) {
	// 5 minutes ago.
	ts := time.Now().Add(-5 * time.Minute).UTC().Format(time.RFC3339)
	result := formatAge(ts)
	if result != "5m" {
		t.Errorf("expected '5m', got %q", result)
	}
}

func TestFormatAge_Hours(t *testing.T) {
	// 3 hours ago.
	ts := time.Now().Add(-3 * time.Hour).UTC().Format(time.RFC3339)
	result := formatAge(ts)
	if result != "3h" {
		t.Errorf("expected '3h', got %q", result)
	}
}

func TestFormatAge_Seconds(t *testing.T) {
	// 30 seconds ago.
	ts := time.Now().Add(-30 * time.Second).UTC().Format(time.RFC3339)
	result := formatAge(ts)
	if result != "30s" {
		t.Errorf("expected '30s', got %q", result)
	}
}

func TestFormatAge_WithZSuffix(t *testing.T) {
	result := formatAge("2020-01-01T00:00:00Z")
	if result == "" || result == "2020-01-01T00:00:00Z" {
		t.Errorf("expected formatted age, got %q", result)
	}
	// Very old, should be days.
	if len(result) < 2 || result[len(result)-1] != 'd' {
		t.Errorf("expected days format, got %q", result)
	}
}

func TestTruncateName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"short", "short"},
		{"exactly15chars!", "exactly15chars!"},
		{"this-is-a-very-long-session-name", "this-is-a-ve..."},
	}

	for _, tt := range tests {
		result := truncateName(tt.input)
		if result != tt.expected {
			t.Errorf("truncateName(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestPrintRichStatus_Stopped(t *testing.T) {
	rs := &runtime.RichStatus{
		Mode:     "local",
		Server:   runtime.ComponentStatus{Status: "stopped"},
		Database: runtime.ComponentStatus{Status: "stopped"},
		Sessions: runtime.SessionSummary{Max: 4},
	}

	// Should not panic.
	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	printRichStatus(rs)

	_ = w.Close()
	os.Stdout = old
}

func TestPrintRichStatus_Running(t *testing.T) {
	rs := &runtime.RichStatus{
		Mode: "local",
		Server: runtime.ComponentStatus{
			Status:  "running",
			Address: "127.0.0.1:8080",
			PID:     12345,
		},
		WebUI: "http://127.0.0.1:8080",
		Database: runtime.ComponentStatus{
			Status: "running",
			Detail: "embedded PostgreSQL on port 5433",
			Port:   5433,
		},
		Sessions: runtime.SessionSummary{
			Active: 2,
			Max:    4,
			List: []runtime.SessionInfo{
				{ID: "a1b2c3d4", Name: "fix-auth-bug", Status: "running", Model: "claude-sonnet-4", Repo: "github.com/org/api"},
				{ID: "e5f6g7h8", Name: "add-tests", Status: "stopped", Model: "claude-sonnet-4", Repo: "github.com/org/web"},
			},
		},
	}

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	printRichStatus(rs)

	_ = w.Close()
	os.Stdout = old
}

func TestPrintRichStatus_K3sWithPods(t *testing.T) {
	rs := &runtime.RichStatus{
		Mode: "k3s",
		Server: runtime.ComponentStatus{
			Status: "running",
			Detail: "Docker container volundr-k3s-api",
		},
		Cluster: &runtime.ClusterStatus{Name: "k3d-volundr", Status: "running"},
		Database: runtime.ComponentStatus{
			Status: "running",
			Detail: "embedded PostgreSQL on port 5433",
		},
		Proxy: "http://127.0.0.1:8080",
		Sessions: runtime.SessionSummary{
			Active: 1,
			Max:    4,
		},
		Pods: []runtime.PodStatus{
			{Name: "session-a1b2c3-skuld", Ready: "3/3", Status: "Running"},
			{Name: "tyr-7f8d9e-abc", Ready: "1/1", Status: "Running"},
		},
	}

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	printRichStatus(rs)

	_ = w.Close()
	os.Stdout = old
}

func TestPrintRichStatus_WithTyr(t *testing.T) {
	rs := &runtime.RichStatus{
		Mode: "local",
		Server: runtime.ComponentStatus{
			Status:  "running",
			Address: "127.0.0.1:8080",
			PID:     12345,
		},
		Tyr: &runtime.ComponentStatus{
			Status:  "running",
			Address: "127.0.0.1:8081",
			PID:     12346,
		},
		Database: runtime.ComponentStatus{Status: "stopped"},
		Sessions: runtime.SessionSummary{Max: 4},
	}

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	printRichStatus(rs)

	_ = w.Close()
	os.Stdout = old
}
