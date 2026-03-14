package runtime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
	"gopkg.in/yaml.v3"
)

func TestRenderComposeTemplate_WithAnthropicKey(t *testing.T) {
	data := composeData{ //nolint:gosec // test fixture, not real credentials
		APIImage:        "ghcr.io/niuulabs/volundr-api:latest",
		APIPort:         18080,
		DBHost:          "host.docker.internal",
		DBPort:          5433,
		DBUser:          "volundr",
		DBPassword:      "secret",
		DBName:          "volundr",
		AnthropicAPIKey: "sk-ant-test-key",
		ConfigPath:      "/home/user/.volundr/docker-config.yaml",
		StorageDir:      "/home/user/.volundr",
	}

	result, err := renderComposeTemplate(&data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	// Verify key parts of the rendered template.
	checks := []string{
		`image: ghcr.io/niuulabs/volundr-api:latest`,
		`"127.0.0.1:18080:8080"`,
		`DATABASE__HOST: "host.docker.internal"`,
		`DATABASE__PORT: "5433"`,
		`DATABASE__USER: "volundr"`,
		`DATABASE__PASSWORD: "secret"`,
		`DATABASE__NAME: "volundr"`,
		`ANTHROPIC_API_KEY: "sk-ant-test-key"`,
		`volundr-net`,
		`external: true`,
		`/home/user/.volundr/docker-config.yaml:/etc/volundr/config.yaml:ro`,
		`/home/user/.volundr:/volundr-storage`,
		`/var/run/docker.sock:/var/run/docker.sock`,
	}

	for _, check := range checks {
		if !strings.Contains(result, check) {
			t.Errorf("expected compose output to contain %q, got:\n%s", check, result)
		}
	}
}

func TestRenderComposeTemplate_WithoutAnthropicKey(t *testing.T) {
	data := composeData{
		APIImage:        "ghcr.io/niuulabs/volundr-api:v1.0.0",
		APIPort:         18080,
		DBHost:          "db.example.com",
		DBPort:          5432,
		DBUser:          "user",
		DBPassword:      "pass",
		DBName:          "mydb",
		AnthropicAPIKey: "",
		ConfigPath:      "/home/user/.volundr/docker-config.yaml",
		StorageDir:      "/home/user/.volundr",
	}

	result, err := renderComposeTemplate(&data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	if strings.Contains(result, "ANTHROPIC_API_KEY") {
		t.Errorf("expected no ANTHROPIC_API_KEY when key is empty, got:\n%s", result)
	}

	if !strings.Contains(result, "image: ghcr.io/niuulabs/volundr-api:v1.0.0") {
		t.Errorf("expected custom API image, got:\n%s", result)
	}

	if !strings.Contains(result, `"127.0.0.1:18080:8080"`) {
		t.Errorf("expected port mapping '127.0.0.1:18080:8080', got:\n%s", result)
	}

	if !strings.Contains(result, `DATABASE__HOST: "db.example.com"`) {
		t.Errorf("expected external DB host, got:\n%s", result)
	}

	if !strings.Contains(result, `/home/user/.volundr/docker-config.yaml:/etc/volundr/config.yaml:ro`) {
		t.Errorf("expected config volume mount, got:\n%s", result)
	}
}

func TestMapContainerState(t *testing.T) {
	tests := []struct {
		input    string
		expected ServiceState
	}{
		{"running", StateRunning},
		{"created", StateStarting},
		{"restarting", StateStarting},
		{"exited", StateStopped},
		{"dead", StateStopped},
		{"removing", StateStopped},
		{"paused", StateError},
		{"unknown", StateError},
		{"", StateError},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := mapContainerState(tt.input)
			if got != tt.expected {
				t.Errorf("mapContainerState(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestBuildComposeData_EmbeddedMode(t *testing.T) {
	r := NewDockerRuntime()

	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "testpass",
			Name:     "volundr",
		},
		Anthropic: config.AnthropicConfig{APIKey: "sk-test"},
	}

	// Verify the runtime is properly created.
	if r.pg != nil {
		t.Error("expected pg to be nil on new DockerRuntime")
	}

	data := r.buildComposeData(cfg)

	if data.DBHost != "host.docker.internal" {
		t.Errorf("expected DBHost to be host.docker.internal for embedded mode, got %q", data.DBHost)
	}

	if data.ConfigPath == "" {
		t.Error("expected ConfigPath to be set")
	}

	if !strings.HasSuffix(data.ConfigPath, dockerConfigFileName) {
		t.Errorf("expected ConfigPath to end with %q, got %q", dockerConfigFileName, data.ConfigPath)
	}

	if data.StorageDir == "" {
		t.Error("expected StorageDir to be set")
	}

	result, err := renderComposeTemplate(&data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	if !strings.Contains(result, "host.docker.internal") {
		t.Error("expected host.docker.internal for embedded mode DB host")
	}
}

func TestGenerateDockerConfig(t *testing.T) {
	// Use a temp dir to avoid writing to the real config dir.
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	// Create the config dir so ConfigDir() returns a valid path.
	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "s3cr3t!@#$",
			Name:     "volundr",
		},
	}

	configPath, err := r.generateDockerConfig(cfg)
	if err != nil {
		t.Fatalf("generateDockerConfig: %v", err)
	}

	// Verify the file was created.
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("config file not created at %s: %v", configPath, err)
	}

	// Read and parse the generated config.
	data, err := os.ReadFile(configPath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed dockerAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	// Verify database settings.
	if parsed.Database["host"] != "host.docker.internal" {
		t.Errorf("expected database host to be host.docker.internal, got %v", parsed.Database["host"])
	}
	if parsed.Database["port"] != 5433 {
		t.Errorf("expected database port to be 5433, got %v", parsed.Database["port"])
	}
	if parsed.Database["password"] != "s3cr3t!@#$" {
		t.Errorf("expected database password to be preserved exactly, got %v", parsed.Database["password"])
	}

	// Verify adapter class paths.
	if parsed.PodManager["adapter"] != "volundr.adapters.outbound.docker_pod_manager.DockerPodManager" {
		t.Errorf("unexpected pod_manager adapter: %v", parsed.PodManager["adapter"])
	}
	if parsed.CredentialStore["adapter"] != "volundr.adapters.outbound.file_credential_store.FileCredentialStore" {
		t.Errorf("unexpected credential_store adapter: %v", parsed.CredentialStore["adapter"])
	}
	if parsed.Storage["adapter"] != "volundr.adapters.outbound.local_storage_adapter.LocalStorageAdapter" {
		t.Errorf("unexpected storage adapter: %v", parsed.Storage["adapter"])
	}
	if parsed.SecretInjection["adapter"] != "volundr.adapters.outbound.memory_secret_injection.InMemorySecretInjectionAdapter" {
		t.Errorf("unexpected secret_injection adapter: %v", parsed.SecretInjection["adapter"])
	}
	if parsed.Identity["adapter"] != "volundr.adapters.outbound.identity.AllowAllIdentityAdapter" {
		t.Errorf("unexpected identity adapter: %v", parsed.Identity["adapter"])
	}
	if parsed.Authorization["adapter"] != "volundr.adapters.outbound.authorization.AllowAllAuthorizationAdapter" {
		t.Errorf("unexpected authorization adapter: %v", parsed.Authorization["adapter"])
	}
	if parsed.Gateway["adapter"] != "volundr.adapters.outbound.k8s_gateway.InMemoryGatewayAdapter" {
		t.Errorf("unexpected gateway adapter: %v", parsed.Gateway["adapter"])
	}

	// Verify container paths in kwargs.
	pmKwargs, ok := parsed.PodManager["kwargs"].(map[string]interface{})
	if !ok {
		t.Fatal("expected pod_manager kwargs to be a map")
	}
	if pmKwargs["compose_dir"] != "/volundr-storage/sessions" {
		t.Errorf("expected pod_manager compose_dir to use container path, got %v", pmKwargs["compose_dir"])
	}
	if pmKwargs["network"] != "volundr-net" {
		t.Errorf("expected pod_manager network to be volundr-net, got %v", pmKwargs["network"])
	}

	csKwargs, ok := parsed.CredentialStore["kwargs"].(map[string]interface{})
	if !ok {
		t.Fatal("expected credential_store kwargs to be a map")
	}
	if csKwargs["base_dir"] != "/volundr-storage/user-credentials" {
		t.Errorf("expected credential_store base_dir to use container path, got %v", csKwargs["base_dir"])
	}

	stKwargs, ok := parsed.Storage["kwargs"].(map[string]interface{})
	if !ok {
		t.Fatal("expected storage kwargs to be a map")
	}
	if stKwargs["base_dir"] != "/volundr-storage" {
		t.Errorf("expected storage base_dir to use container path, got %v", stKwargs["base_dir"])
	}
}

func TestDockerImageOrDefault(t *testing.T) {
	tests := []struct {
		name     string
		image    string
		def      string
		expected string
	}{
		{"empty uses default", "", "default:latest", "default:latest"},
		{"custom image", "custom:v1", "default:latest", "custom:v1"},
		{"non-empty overrides", "my-image", "other-image", "my-image"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := dockerImageOrDefault(tt.image, tt.def)
			if got != tt.expected {
				t.Errorf("dockerImageOrDefault(%q, %q) = %q, want %q", tt.image, tt.def, got, tt.expected)
			}
		})
	}
}

func TestBuildServiceStatuses_Embedded(t *testing.T) {
	r := NewDockerRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode: "embedded",
			Port: 5433,
		},
	}

	services := r.buildServiceStatuses(cfg)

	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}

	if services[0].Name != "api" {
		t.Errorf("expected first service 'api', got %q", services[0].Name)
	}
	if services[0].State != StateRunning {
		t.Errorf("expected api state running, got %q", services[0].State)
	}
	if services[0].Port != 8080 {
		t.Errorf("expected api port 8080, got %d", services[0].Port)
	}

	if services[1].Name != "postgres" {
		t.Errorf("expected second service 'postgres', got %q", services[1].Name)
	}
	if services[1].Port != 5433 {
		t.Errorf("expected postgres port 5433, got %d", services[1].Port)
	}
}

func TestBuildServiceStatuses_ExternalDB(t *testing.T) {
	r := NewDockerRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 9090},
		Database: config.DatabaseConfig{
			Mode: "external",
			Port: 5432,
		},
	}

	services := r.buildServiceStatuses(cfg)

	if len(services) != 1 {
		t.Fatalf("expected 1 service (no postgres), got %d", len(services))
	}

	if services[0].Name != "api" {
		t.Errorf("expected service 'api', got %q", services[0].Name)
	}
	if services[0].Port != 9090 {
		t.Errorf("expected port 9090, got %d", services[0].Port)
	}
}

func TestBuildComposeData_ExternalMode(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	cfg := &config.Config{
		Listen: config.ListenConfig{Port: 8080},
		Database: config.DatabaseConfig{
			Mode:     "external",
			Host:     "db.example.com",
			Port:     5432,
			User:     "myuser",
			Password: "mypass",
			Name:     "mydb",
		},
		Docker: config.DockerConfig{
			APIImage: "custom-api:v2",
		},
		Anthropic: config.AnthropicConfig{APIKey: "sk-test"},
	}

	data := r.buildComposeData(cfg)

	if data.DBHost != "db.example.com" {
		t.Errorf("expected DBHost 'db.example.com' for external mode, got %q", data.DBHost)
	}

	if data.APIImage != "custom-api:v2" {
		t.Errorf("expected custom API image, got %q", data.APIImage)
	}

	if data.APIPort != dockerAPIInternalPort {
		t.Errorf("expected API port %d, got %d", dockerAPIInternalPort, data.APIPort)
	}

	if data.AnthropicAPIKey != "sk-test" {
		t.Errorf("expected Anthropic key, got %q", data.AnthropicAPIKey)
	}
}

func TestNewDockerRuntime(t *testing.T) {
	r := NewDockerRuntime()
	if r == nil {
		t.Fatal("expected non-nil DockerRuntime")
	}
	if r.pg != nil {
		t.Error("expected pg to be nil on new DockerRuntime")
	}
	if r.proxyRtr != nil {
		t.Error("expected proxyRtr to be nil on new DockerRuntime")
	}
}

func TestGenerateDockerConfig_WithGit(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "secret",
			Name:     "volundr",
		},
		Git: config.GitConfig{
			GitHub: config.GitHubConfig{
				Enabled: true,
				Instances: []config.GitHubInstanceConfig{
					{
						Name:    "main",
						BaseURL: "https://github.com",
						Token:   "ghp_test",
					},
				},
			},
		},
	}

	configPath, err := r.generateDockerConfig(cfg)
	if err != nil {
		t.Fatalf("generateDockerConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed dockerAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if parsed.Git == nil {
		t.Fatal("expected git config to be present")
	}

	gh, ok := parsed.Git["github"]
	if !ok {
		t.Fatal("expected github key in git config")
	}

	ghMap, ok := gh.(map[string]interface{})
	if !ok {
		t.Fatal("expected github to be a map")
	}

	if ghMap["enabled"] != true {
		t.Error("expected github enabled to be true")
	}
}

func TestGenerateDockerConfig_WithLocalMounts(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "secret",
			Name:     "volundr",
		},
		LocalMounts: config.LocalMountsConfig{
			Enabled:         true,
			AllowRootMount:  false,
			AllowedPrefixes: []string{"/home/user"},
			DefaultReadOnly: true,
		},
	}

	configPath, err := r.generateDockerConfig(cfg)
	if err != nil {
		t.Fatalf("generateDockerConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed dockerAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if parsed.LocalMounts == nil {
		t.Fatal("expected local_mounts config to be present")
	}

	if parsed.LocalMounts["enabled"] != true {
		t.Error("expected local_mounts enabled to be true")
	}
	if parsed.LocalMounts["default_read_only"] != true {
		t.Error("expected default_read_only to be true")
	}
}

func TestDockerRuntime_Status_NoDocker(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	// Ensure docker command can't be found.
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "docker" {
		t.Errorf("expected runtime 'docker', got %q", status.Runtime)
	}

	// Without docker, the container inspect will fail, so status should be stopped.
	if len(status.Services) < 1 {
		t.Fatalf("expected at least 1 service, got %d", len(status.Services))
	}

	if status.Services[0].Name != "api" {
		t.Errorf("expected service 'api', got %q", status.Services[0].Name)
	}

	if status.Services[0].State != StateStopped {
		t.Errorf("expected state stopped when docker unavailable, got %q", status.Services[0].State)
	}
}

func TestDockerRuntime_Status_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a state file with postgres.
	services := []ServiceStatus{
		{Name: "api", State: StateRunning, Port: 18080},
		{Name: "postgres", State: StateRunning, Port: 5433},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	r := NewDockerRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	// Docker inspect will fail, so api will be stopped.
	// State file won't be merged because docker inspect failed.
	if status.Services[0].State != StateStopped {
		t.Errorf("expected api stopped when docker unavailable, got %q", status.Services[0].State)
	}
}

func TestDockerRuntime_Init_NoDocker(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	r := NewDockerRuntime()
	cfg := &config.Config{}

	err := r.Init(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error when docker is not available")
	}

	if !strings.Contains(err.Error(), "docker is not available") {
		t.Errorf("expected 'docker is not available' error, got: %v", err)
	}
}

func TestDockerRuntime_Down_NoComposeFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	// Down should handle errors gracefully (docker not available).
	err := r.Down(context.Background())
	// Will get errors since docker isn't available, but won't panic.
	if err != nil {
		// The errors are collected but expected since docker isn't available.
		if !strings.Contains(err.Error(), "docker compose down") {
			t.Errorf("expected docker compose error, got: %v", err)
		}
	}
}

func TestDockerRuntime_Down_WithComposeFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Create a compose file.
	composePath := filepath.Join(volundrDir, composeFileName)
	if err := os.WriteFile(composePath, []byte("services:\n  api:\n    image: test\n"), 0o600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	// Also create PID and state files.
	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	r := NewDockerRuntime()
	_ = r.Down(context.Background())

	// Verify compose file was cleaned up.
	if _, err := os.Stat(composePath); !os.IsNotExist(err) {
		t.Error("expected compose file to be removed")
	}

	// PID and state files should also be cleaned up.
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}

func TestDockerRuntime_Init_Success(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	withMockExec(t, "MOCK_RESPONSE=1.0.0")

	r := NewDockerRuntime()
	cfg := &config.Config{}

	err := r.Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
}

func TestDockerRuntime_EnsureNetwork_Exists(t *testing.T) {
	withMockExec(t)

	r := NewDockerRuntime()
	err := r.ensureNetwork("test-net")
	if err != nil {
		t.Fatalf("ensureNetwork: %v", err)
	}
}

func TestEnsureImage_Exists(t *testing.T) {
	withMockExec(t)

	err := ensureImage("test-image:latest")
	if err != nil {
		t.Fatalf("ensureImage: %v", err)
	}
}

func TestEnsureImage_NeedssPull(t *testing.T) {
	// First call (inspect) fails, second call (pull) succeeds.
	// We can't easily differentiate in the mock, so just test that it runs without error.
	withMockExec(t)
	err := ensureImage("test-image:latest")
	if err != nil {
		t.Fatalf("ensureImage: %v", err)
	}
}

func TestDockerRuntime_Status_ContainerRunning(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=running")

	r := NewDockerRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "docker" {
		t.Errorf("expected runtime 'docker', got %q", status.Runtime)
	}

	if len(status.Services) < 1 {
		t.Fatalf("expected at least 1 service, got %d", len(status.Services))
	}

	if status.Services[0].Name != "api" {
		t.Errorf("expected service 'api', got %q", status.Services[0].Name)
	}

	if status.Services[0].State != StateRunning {
		// The mock may not be intercepting correctly if a prior test
		// modified env. Check if the state is "error" because docker
		// returned unexpected output.
		t.Logf("service: %+v", status.Services[0])
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestDockerRuntime_Status_WithStateFileMerge(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a state file with postgres.
	services := []ServiceStatus{
		{Name: "api", State: StateRunning, Port: 18080},
		{Name: "postgres", State: StateRunning, Port: 5433},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	// Mock docker inspect to return "running".
	withMockExec(t, "MOCK_RESPONSE=running")

	r := NewDockerRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	// Should have api from docker inspect + postgres from state file.
	if len(status.Services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(status.Services))
	}

	found := map[string]bool{}
	for _, svc := range status.Services {
		found[svc.Name] = true
	}

	if !found["api"] {
		t.Error("expected api service")
	}
	if !found["postgres"] {
		t.Error("expected postgres service")
	}
}

func TestDockerRuntime_Status_CorruptStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Write a corrupt state file.
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("not-json"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=running")

	r := NewDockerRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	// Should still have api from docker inspect, but state file couldn't be parsed.
	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service (corrupt state file), got %d", len(status.Services))
	}

	if status.Services[0].Name != "api" {
		t.Errorf("expected service 'api', got %q", status.Services[0].Name)
	}
}

func TestDockerRuntime_Logs_NoFollow(t *testing.T) {
	withMockExec(t, "MOCK_RESPONSE=test log output")

	r := NewDockerRuntime()
	reader, err := r.Logs(context.Background(), "api", false)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}

	data := make([]byte, 1024)
	n, _ := reader.Read(data)
	_ = reader.Close()

	if n == 0 {
		t.Error("expected some log output")
	}
}

func TestDockerRuntime_Logs_Follow(t *testing.T) {
	withMockExec(t, "MOCK_RESPONSE=test log output")

	r := NewDockerRuntime()
	reader, err := r.Logs(context.Background(), "api", true)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	_ = reader.Close()
}

func TestDockerRuntime_Down_SuccessWithMock(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Create compose file.
	composePath := filepath.Join(volundrDir, composeFileName)
	if err := os.WriteFile(composePath, []byte("services:\n  api:\n    image: test\n"), 0o600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	// Create PID and state files.
	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	// Also write a config.yaml so config.Load() works for network name.
	cfgContent := "runtime: docker\nlisten:\n  host: 127.0.0.1\n  port: 8080\ndatabase:\n  mode: embedded\n  port: 5433\n  user: volundr\n  password: test\n  name: volundr\n"
	if err := os.WriteFile(filepath.Join(volundrDir, "config.yaml"), []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=ok")

	r := NewDockerRuntime()
	err := r.Down(context.Background())
	if err != nil {
		t.Fatalf("Down: %v", err)
	}

	// Verify cleanup.
	if _, err := os.Stat(composePath); !os.IsNotExist(err) {
		t.Error("expected compose file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}

func TestDockerRuntime_EnsureNetwork_Create(t *testing.T) {
	// First call (inspect) fails, second call (create) succeeds.
	// With mock exec, both succeed. We can test the success path.
	withMockExec(t)

	r := NewDockerRuntime()
	err := r.ensureNetwork("test-network")
	if err != nil {
		t.Fatalf("ensureNetwork: %v", err)
	}
}

func TestGenerateDockerConfig_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewDockerRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "external",
			Host:     "db.example.com",
			Port:     5432,
			User:     "myuser",
			Password: "mypass",
			Name:     "mydb",
		},
	}

	configPath, err := r.generateDockerConfig(cfg)
	if err != nil {
		t.Fatalf("generateDockerConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed dockerAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	// External mode should use the configured host, not host.docker.internal.
	if parsed.Database["host"] != "db.example.com" {
		t.Errorf("expected database host to be db.example.com, got %v", parsed.Database["host"])
	}
}
