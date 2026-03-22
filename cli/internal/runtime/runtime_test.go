package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestBuildGitConfig_Disabled(t *testing.T) {
	cfg := &config.Config{}
	cfg.Git.GitHub.Enabled = false

	result := buildGitConfig(cfg)
	if _, ok := result["github"]; ok {
		t.Error("expected no 'github' key when disabled")
	}
}

func TestBuildGitConfig_EnabledWithInstances(t *testing.T) {
	cfg := &config.Config{}
	cfg.Git.GitHub.Enabled = true
	cfg.Git.GitHub.Instances = []config.GitHubInstanceConfig{
		{ //nolint:gosec // G101: test fixture, not real credentials
			Name:     "main",
			BaseURL:  "https://github.com",
			Token:    "ghp_test123",
			TokenEnv: "GITHUB_TOKEN",
			Orgs:     []string{"niuulabs", "other-org"},
		},
		{
			Name:    "enterprise",
			BaseURL: "https://github.example.com",
		},
	}

	result := buildGitConfig(cfg)
	gh, ok := result["github"]
	if !ok {
		t.Fatal("expected 'github' key in result")
	}

	ghMap, ok := gh.(map[string]interface{})
	if !ok {
		t.Fatal("expected github to be a map")
	}

	if ghMap["enabled"] != true {
		t.Error("expected github enabled to be true")
	}

	instances, ok := ghMap["instances"].([]map[string]interface{})
	if !ok {
		t.Fatal("expected instances to be a slice of maps")
	}

	if len(instances) != 2 {
		t.Fatalf("expected 2 instances, got %d", len(instances))
	}

	// First instance.
	inst := instances[0]
	if inst["name"] != "main" {
		t.Errorf("expected name 'main', got %v", inst["name"])
	}
	if inst["base_url"] != "https://github.com" {
		t.Errorf("expected base_url 'https://github.com', got %v", inst["base_url"])
	}
	if inst["token"] != "ghp_test123" {
		t.Errorf("expected token 'ghp_test123', got %v", inst["token"])
	}
	if inst["token_env"] != "GITHUB_TOKEN" {
		t.Errorf("expected token_env 'GITHUB_TOKEN', got %v", inst["token_env"])
	}
	orgs, ok := inst["orgs"].([]string)
	if !ok {
		t.Fatal("expected orgs to be a string slice")
	}
	if len(orgs) != 2 {
		t.Fatalf("expected 2 orgs, got %d", len(orgs))
	}

	// Second instance — no token/orgs.
	inst2 := instances[1]
	if inst2["name"] != "enterprise" {
		t.Errorf("expected name 'enterprise', got %v", inst2["name"])
	}
	if _, ok := inst2["token"]; ok {
		t.Error("expected no token key for enterprise instance")
	}
	if _, ok := inst2["token_env"]; ok {
		t.Error("expected no token_env key for enterprise instance")
	}
	if _, ok := inst2["orgs"]; ok {
		t.Error("expected no orgs key for enterprise instance")
	}
}

func TestBuildGitConfig_EnabledNoInstances(t *testing.T) {
	cfg := &config.Config{}
	cfg.Git.GitHub.Enabled = true
	cfg.Git.GitHub.Instances = nil

	result := buildGitConfig(cfg)
	gh, ok := result["github"]
	if !ok {
		t.Fatal("expected 'github' key in result")
	}

	ghMap, ok := gh.(map[string]interface{})
	if !ok {
		t.Fatal("expected github to be a map")
	}

	if ghMap["enabled"] != true {
		t.Error("expected github enabled to be true")
	}

	if _, ok := ghMap["instances"]; ok {
		t.Error("expected no instances key when instances is nil")
	}
}

func TestEnsureContainerStorageDirs(t *testing.T) {
	tmpDir := t.TempDir()

	err := ensureContainerStorageDirs(tmpDir)
	if err != nil {
		t.Fatalf("ensureContainerStorageDirs: %v", err)
	}

	// Verify all expected directories were created.
	expectedDirs := []string{
		filepath.Join(tmpDir, "data"),
		filepath.Join(tmpDir, "data", "workspaces"),
		filepath.Join(tmpDir, "sessions"),
		filepath.Join(tmpDir, "user-credentials"),
	}

	for _, dir := range expectedDirs {
		info, err := os.Stat(dir)
		if err != nil {
			t.Errorf("expected directory %s to exist: %v", dir, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("expected %s to be a directory", dir)
		}
	}
}

func TestEnsureContainerStorageDirs_ChmodCfgDirError(t *testing.T) {
	// Use a path that doesn't exist so Chmod fails.
	err := ensureContainerStorageDirs("/nonexistent/dir/that/does/not/exist")
	if err == nil {
		t.Fatal("expected error for non-existent config dir")
	}
	if !strings.Contains(err.Error(), "chmod config dir") {
		t.Errorf("expected 'chmod config dir' in error, got %q", err.Error())
	}
}

func TestEnsureContainerStorageDirs_MkdirError(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a file where a directory should be, so MkdirAll fails.
	dataPath := filepath.Join(tmpDir, "data")
	if err := os.WriteFile(dataPath, []byte("block"), 0o600); err != nil {
		t.Fatal(err)
	}

	err := ensureContainerStorageDirs(tmpDir)
	if err == nil {
		t.Fatal("expected error when directory creation fails")
	}
	if !strings.Contains(err.Error(), "create directory") {
		t.Errorf("expected 'create directory' in error, got %q", err.Error())
	}
}

func TestEnsureContainerStorageDirs_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()

	// Call twice — should not error on second call.
	if err := ensureContainerStorageDirs(tmpDir); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if err := ensureContainerStorageDirs(tmpDir); err != nil {
		t.Fatalf("second call: %v", err)
	}
}

func TestServiceStateConstants(t *testing.T) {
	tests := []struct {
		name     string
		state    ServiceState
		expected string
	}{
		{"running", StateRunning, "running"},
		{"stopped", StateStopped, "stopped"},
		{"error", StateError, "error"},
		{"starting", StateStarting, "starting"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.state) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, string(tt.state))
			}
		})
	}
}

func TestServiceStatusJSON(t *testing.T) {
	s := ServiceStatus{
		Name:  "api",
		State: StateRunning,
		PID:   1234,
		Port:  8080,
		Error: "test error",
	}

	if s.Name != "api" {
		t.Errorf("expected name 'api', got %q", s.Name)
	}
	if s.State != StateRunning {
		t.Errorf("expected state running, got %q", s.State)
	}
	if s.PID != 1234 {
		t.Errorf("expected PID 1234, got %d", s.PID)
	}
	if s.Port != 8080 {
		t.Errorf("expected port 8080, got %d", s.Port)
	}
	if s.Error != "test error" {
		t.Errorf("expected error 'test error', got %q", s.Error)
	}
}

func TestStackStatus(t *testing.T) {
	s := StackStatus{
		Runtime: "k3s",
		Services: []ServiceStatus{
			{Name: "api", State: StateRunning},
			{Name: "postgres", State: StateRunning},
		},
	}

	if s.Runtime != "k3s" {
		t.Errorf("expected runtime 'k3s', got %q", s.Runtime)
	}
	if len(s.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(s.Services))
	}
}
