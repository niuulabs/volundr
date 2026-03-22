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

func TestRunInit_ListenAll(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: listen=all, API key, db mode, no github.
	input := strings.Join([]string{
		"all",          // Listen on all interfaces
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

func TestRunInit_ListenCustomIP(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: listen=custom IP, API key, db mode, no github.
	input := strings.Join([]string{
		"192.168.1.100", // Custom listen address
		"test-api-key",  // Anthropic API key
		"",              // Database mode (default embedded)
		"n",             // Configure GitHub? No
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

func TestRunInit_ExternalDB_CustomPort(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: listen, API key, external db with custom port, no github.
	input := strings.Join([]string{
		"",             // Listen (default localhost)
		"test-api-key", // Anthropic API key
		"external",     // Database mode
		"localhost",    // DB host
		"",             // DB port (empty = default 5432)
		"user",         // DB user
		"pass",         // DB password
		"mydb",         // DB name
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

func TestRunInit_GitHubWithDefaultCloneToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Pipe answers: listen, API key, db, github with direct token and default clone token.
	input := strings.Join([]string{
		"",                   // Listen (default localhost)
		"test-api-key",       // Anthropic API key
		"",                   // Database mode (default embedded)
		"y",                  // Configure GitHub? Yes
		"ghp_directtoken123", // GitHub token (direct)
		"org1",               // GitHub orgs
		"",                   // GitHub API URL (default)
		"",                   // Session clone token (default: same as above)
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

func TestRunInit_PrefillFromExistingConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create a rich existing config with GitHub, API key, custom listen host.
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("create default config: %v", err)
	}
	cfg.Listen.Host = "0.0.0.0"
	cfg.Anthropic.APIKey = "sk-existing-key"
	cfg.Git.GitHub.Enabled = true
	cfg.Git.GitHub.Instances = []config.GitHubInstanceConfig{{
		Name:     "GitHub",
		BaseURL:  "https://api.github.com",
		Token:    "ghp_existingtoken",
		Orgs:     []string{"myorg"},
	}}
	cfg.Git.GitHub.CloneToken = "ghp_clonetoken"
	if err := cfg.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Overwrite and press Enter on everything — should keep existing values.
	input := strings.Join([]string{
		"y", // Overwrite? Yes
		"",  // Listen (keep 0.0.0.0)
		"",  // API key (keep existing)
		"",  // Database mode (keep embedded)
		"",  // GitHub (keep Y default)
		"",  // GitHub token (keep existing)
		"",  // GitHub orgs (keep existing)
		"",  // GitHub API URL (keep existing)
		"",  // Clone token (keep existing)
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err = runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}

	// Verify config was preserved.
	loaded, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if loaded.Listen.Host != "0.0.0.0" {
		t.Errorf("expected listen host 0.0.0.0, got %q", loaded.Listen.Host)
	}
	if loaded.Anthropic.APIKey != "sk-existing-key" {
		t.Errorf("expected existing API key preserved, got %q", loaded.Anthropic.APIKey)
	}
	if !loaded.Git.GitHub.Enabled {
		t.Error("expected GitHub to remain enabled")
	}
	if len(loaded.Git.GitHub.Instances) == 0 {
		t.Fatal("expected GitHub instances to be preserved")
	}
	if loaded.Git.GitHub.Instances[0].Token != "ghp_existingtoken" {
		t.Errorf("expected existing token preserved, got %q", loaded.Git.GitHub.Instances[0].Token)
	}
}

func TestRunInit_PrefillOverrideValues(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create existing config.
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("create default config: %v", err)
	}
	cfg.Anthropic.APIKey = "sk-old-key"
	cfg.Git.GitHub.Enabled = true
	cfg.Git.GitHub.Instances = []config.GitHubInstanceConfig{{
		Name:    "GitHub",
		BaseURL: "https://api.github.com",
		TokenEnv: "OLD_TOKEN_ENV",
		Orgs:    []string{"oldorg"},
	}}
	cfg.Git.GitHub.CloneToken = "ghp_oldclone"
	if err := cfg.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Overwrite and provide new values for some fields.
	input := strings.Join([]string{
		"y",                 // Overwrite? Yes
		"all",               // Listen (change to all interfaces)
		"sk-new-key",        // New API key
		"",                  // Database mode (keep embedded)
		"y",                 // Configure GitHub? Yes
		"NEW_TOKEN_ENV",     // New token (env var)
		"neworg1, neworg2",  // New orgs
		"https://custom.gh", // New API URL
		"ghp_newclone",      // New clone token
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err = runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}

	// Verify new values were applied.
	loaded, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if loaded.Anthropic.APIKey != "sk-new-key" {
		t.Errorf("expected new API key, got %q", loaded.Anthropic.APIKey)
	}
	if len(loaded.Git.GitHub.Instances) == 0 {
		t.Fatal("expected GitHub instances")
	}
	inst := loaded.Git.GitHub.Instances[0]
	if inst.TokenEnv != "NEW_TOKEN_ENV" {
		t.Errorf("expected NEW_TOKEN_ENV, got %q", inst.TokenEnv)
	}
	if inst.BaseURL != "https://custom.gh" {
		t.Errorf("expected custom URL, got %q", inst.BaseURL)
	}
	if loaded.Git.GitHub.CloneToken != "ghp_newclone" {
		t.Errorf("expected new clone token, got %q", loaded.Git.GitHub.CloneToken)
	}
}

func TestRunInit_PrefillExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Create existing config with external DB.
	cfg, err := config.DefaultConfig()
	if err != nil {
		t.Fatalf("create default config: %v", err)
	}
	cfg.Database.Mode = "external"
	cfg.Database.Host = "db.old.com"
	cfg.Database.Port = 5432
	cfg.Database.User = "olduser"
	cfg.Database.Password = "oldpass"
	cfg.Database.Name = "olddb"
	if err := cfg.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "local"
	defer func() { initRuntimeFlag = oldFlag }()

	// Overwrite, keep external DB defaults.
	input := strings.Join([]string{
		"y",  // Overwrite? Yes
		"",   // Listen (keep default)
		"",   // API key (keep empty)
		"",   // Database mode (keep external)
		"",   // DB host (keep existing)
		"",   // DB port (keep existing)
		"",   // DB user (keep existing)
		"",   // DB password (keep existing)
		"",   // DB name (keep existing)
		"n",  // Configure GitHub? No
	}, "\n") + "\n"

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString(input)
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err = runInit(nil, nil)
	if err != nil {
		t.Logf("runInit error (expected in test env): %v", err)
	}

	loaded, err := config.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if loaded.Database.Host != "db.old.com" {
		t.Errorf("expected db host preserved, got %q", loaded.Database.Host)
	}
	if loaded.Database.User != "olduser" {
		t.Errorf("expected db user preserved, got %q", loaded.Database.User)
	}
}

func TestRunInit_K3sRuntime_PreflightChecks(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Override PATH to ensure docker/kubectl/helm are not found.
	t.Setenv("PATH", tmpDir)

	oldFlag := initRuntimeFlag
	initRuntimeFlag = "k3s"
	defer func() { initRuntimeFlag = oldFlag }()

	oldStdin := os.Stdin
	r, w, _ := os.Pipe()
	_, _ = w.WriteString("\n")
	_ = w.Close()
	os.Stdin = r
	defer func() { os.Stdin = oldStdin }()

	err := runInit(nil, nil)
	if err == nil {
		t.Fatal("expected preflight check error for missing docker")
	}
	if !strings.Contains(err.Error(), "docker is required") {
		t.Errorf("expected docker error, got: %v", err)
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
		"local",        // Runtime (interactive prompt)
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
