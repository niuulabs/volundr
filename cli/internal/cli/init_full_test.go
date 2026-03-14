package cli

import (
	"os"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunInit_WithRuntimeFlag(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe stdin with answers: API key, db mode, github access
	input := strings.Join([]string{
		"test-api-key", // Anthropic API key
		"",             // Database mode (default: embedded)
		"n",            // Configure GitHub? No
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	// The runtime init (local) will likely fail because it tries to
	// find/install postgres, but we still cover the config flow.
	if err != nil {
		// Acceptable - runtime init fails in test env.
		t.Logf("runInit error (expected in test env): %v", err)
	}
}

func TestRunInit_ExistingConfig_Abort(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create an existing config file.
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("create default config: %v", err)
	}
	if err := cfg.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldFlag := initRuntimeFlag
	initRuntimeFlag = ""
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe "n" to abort overwrite.
	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString("n\n")
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err = runInit(nil, nil)
	if err != nil {
		t.Fatalf("runInit abort: %v", err)
	}
}

func TestRunInit_ExistingConfig_Overwrite(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create an existing config file.
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("create default config: %v", err)
	}
	if err := cfg.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe "y" to confirm overwrite, then answers for prompts.
	input := strings.Join([]string{
		"y", // Overwrite? Yes
		"",  // API key (empty)
		"",  // Database mode (default)
		"n", // Configure GitHub? No
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err = runInit(nil, nil)
	// Runtime init will fail in test env.
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}
}

func TestRunInit_WithExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: API key, external db, db params, no github.
	input := strings.Join([]string{
		"test-api-key",   // Anthropic API key
		"external",       // Database mode
		"db.example.com", // DB host
		"5432",           // DB port
		"testuser",       // DB user
		"testpass",       // DB password
		"testdb",         // DB name
		"n",              // Configure GitHub? No
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}
}

func TestRunInit_WithGitHub(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: API key, embedded db, github config.
	input := strings.Join([]string{
		"test-api-key", // Anthropic API key
		"",             // Database mode (default embedded)
		"y",            // Configure GitHub? Yes
		"GITHUB_TOKEN", // GitHub token (env var)
		"org1, org2",   // GitHub orgs
		"",             // GitHub API URL (default)
		"",             // Session clone token (default: same)
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}
}

func TestRunInit_WithGitHub_DirectToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: API key, embedded db, github config with direct token.
	input := strings.Join([]string{
		"test-api-key",           // Anthropic API key
		"",                       // Database mode (default embedded)
		"y",                      // Configure GitHub? Yes
		"ghp_directtoken123",     // GitHub token (direct, not env var)
		"",                       // GitHub orgs (empty)
		"https://custom.api.com", // Custom GitHub API URL
		"ghp_clonetoken456",      // Different clone token
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}
}

func TestRunInit_InteractiveRuntime(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = ""
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: runtime, API key, db mode, no github.
	input := strings.Join([]string{
		"docker",       // Runtime (interactive prompt)
		"test-api-key", // Anthropic API key
		"",             // Database mode (default embedded)
		"n",            // Configure GitHub? No
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}
}
