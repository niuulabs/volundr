package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
	"gopkg.in/yaml.v3"
)

func TestRenderComposeTemplate_WithAnthropicKey(t *testing.T) {
	data := composeData{
		APIImage:        "ghcr.io/niuu/volundr-api:latest",
		APIPort:         18080,
		DBHost:          "host.docker.internal",
		DBPort:          5433,
		DBUser:          "volundr",
		DBPassword:      "secret",
		DBName:          "volundr",
		AnthropicAPIKey: "sk-ant-test-key",
		GithubToken:     "ghp_test123",
		ConfigPath:      "/home/user/.volundr/docker-config.yaml",
		StorageDir:      "/home/user/.volundr",
	}

	result, err := renderComposeTemplate(data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	// Verify key parts of the rendered template.
	checks := []string{
		`image: ghcr.io/niuu/volundr-api:latest`,
		`"127.0.0.1:18080:8080"`,
		`DATABASE__HOST: "host.docker.internal"`,
		`DATABASE__PORT: "5433"`,
		`DATABASE__USER: "volundr"`,
		`DATABASE__PASSWORD: "secret"`,
		`DATABASE__NAME: "volundr"`,
		`ANTHROPIC_API_KEY: "sk-ant-test-key"`,
		`GITHUB_TOKEN: "ghp_test123"`,
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
		APIImage:        "ghcr.io/niuu/volundr-api:v1.0.0",
		APIPort:         18080,
		DBHost:          "db.example.com",
		DBPort:          5432,
		DBUser:          "user",
		DBPassword:      "pass",
		DBName:          "mydb",
		AnthropicAPIKey: "",
		GithubToken:     "",
		ConfigPath:      "/home/user/.volundr/docker-config.yaml",
		StorageDir:      "/home/user/.volundr",
	}

	result, err := renderComposeTemplate(data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	if strings.Contains(result, "ANTHROPIC_API_KEY") {
		t.Errorf("expected no ANTHROPIC_API_KEY when key is empty, got:\n%s", result)
	}

	if strings.Contains(result, "GITHUB_TOKEN") {
		t.Errorf("expected no GITHUB_TOKEN when token is empty, got:\n%s", result)
	}

	if !strings.Contains(result, "image: ghcr.io/niuu/volundr-api:v1.0.0") {
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

func TestRenderComposeTemplate_WithGithubTokenOnly(t *testing.T) {
	data := composeData{
		APIImage:        "ghcr.io/niuu/volundr-api:latest",
		APIPort:         18080,
		DBHost:          "host.docker.internal",
		DBPort:          5433,
		DBUser:          "volundr",
		DBPassword:      "secret",
		DBName:          "volundr",
		AnthropicAPIKey: "",
		GithubToken:     "ghp_onlytoken",
		ConfigPath:      "/home/user/.volundr/docker-config.yaml",
		StorageDir:      "/home/user/.volundr",
	}

	result, err := renderComposeTemplate(data)
	if err != nil {
		t.Fatalf("renderComposeTemplate: %v", err)
	}

	if strings.Contains(result, "ANTHROPIC_API_KEY") {
		t.Errorf("expected no ANTHROPIC_API_KEY when key is empty, got:\n%s", result)
	}

	if !strings.Contains(result, `GITHUB_TOKEN: "ghp_onlytoken"`) {
		t.Errorf("expected GITHUB_TOKEN in output, got:\n%s", result)
	}
}

func TestBuildComposeData_IncludesGithubToken(t *testing.T) {
	r := NewDockerRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "testpass",
			Name:     "volundr",
		},
		Anthropic: config.AnthropicConfig{APIKey: "sk-test"},
		Git: config.GitConfig{
			GitHub: config.GitHubConfig{
				CloneToken: "ghp_clone_token",
			},
		},
	}

	data := r.buildComposeData(cfg)

	if data.GithubToken != "ghp_clone_token" {
		t.Errorf("expected GithubToken to be ghp_clone_token, got %q", data.GithubToken)
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

	result, err := renderComposeTemplate(data)
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
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
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
	data, err := os.ReadFile(configPath)
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

func TestGenerateDockerConfig_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
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

	data, err := os.ReadFile(configPath)
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
