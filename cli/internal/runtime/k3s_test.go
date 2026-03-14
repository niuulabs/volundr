package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
	"gopkg.in/yaml.v3"
)

func TestNewK3sRuntime(t *testing.T) {
	r := NewK3sRuntime()
	if r == nil {
		t.Fatal("expected non-nil K3sRuntime")
	}
	if r.pg != nil {
		t.Error("expected pg to be nil on new K3sRuntime")
	}
	if r.proxyRtr != nil {
		t.Error("expected proxyRtr to be nil on new K3sRuntime")
	}
}

func TestK3sRuntime_Namespace(t *testing.T) {
	r := NewK3sRuntime()

	// Default namespace.
	cfg := &config.Config{}
	ns := r.namespace(cfg)
	if ns != k3sDefaultNamespace {
		t.Errorf("expected default namespace %q, got %q", k3sDefaultNamespace, ns)
	}

	// Configured namespace.
	cfg.K3s.Namespace = "custom-ns"
	ns = r.namespace(cfg)
	if ns != "custom-ns" {
		t.Errorf("expected namespace %q, got %q", "custom-ns", ns)
	}
}

func TestResolveNamespace(t *testing.T) {
	// Default.
	cfg := &config.Config{}
	ns := resolveNamespace(cfg)
	if ns != k3sDefaultNamespace {
		t.Errorf("expected %q, got %q", k3sDefaultNamespace, ns)
	}

	// Explicit.
	cfg.K3s.Namespace = "test-ns"
	ns = resolveNamespace(cfg)
	if ns != "test-ns" {
		t.Errorf("expected %q, got %q", "test-ns", ns)
	}
}

func TestK3sRuntime_ResolveKubeconfig(t *testing.T) {
	r := NewK3sRuntime()

	// Explicit config.
	cfg := &config.Config{}
	cfg.K3s.Kubeconfig = "/custom/kubeconfig"
	kc := r.resolveKubeconfig(cfg)
	if kc != "/custom/kubeconfig" {
		t.Errorf("expected /custom/kubeconfig, got %q", kc)
	}

	// Default: volundr-managed kubeconfig in config dir.
	cfg.K3s.Kubeconfig = ""
	kc = r.resolveKubeconfig(cfg)
	if !strings.HasSuffix(kc, k3sHostKubeconfigFile) {
		t.Errorf("expected path ending with %s, got %q", k3sHostKubeconfigFile, kc)
	}
}

func TestK3sRuntime_DetectProvider(t *testing.T) {
	r := NewK3sRuntime()

	// Explicit provider.
	cfg := &config.Config{}
	cfg.K3s.Provider = "k3d"
	p := r.detectProvider(cfg)
	if p != "k3d" {
		t.Errorf("expected k3d, got %q", p)
	}

	cfg.K3s.Provider = "native"
	p = r.detectProvider(cfg)
	if p != "native" {
		t.Errorf("expected native, got %q", p)
	}

	// Auto-detect falls through; result depends on what's installed.
	cfg.K3s.Provider = "auto"
	p = r.detectProvider(cfg)
	// Just verify it returns something (k3d, native, or none).
	if p != "k3d" && p != "native" && p != "none" {
		t.Errorf("unexpected provider %q", p)
	}
}

func TestMapK8sPodPhase(t *testing.T) {
	tests := []struct {
		phase    string
		expected ServiceState
	}{
		{"Running", StateRunning},
		{"Pending", StateStarting},
		{"Succeeded", StateStopped},
		{"Failed", StateError},
		{"Unknown", StateError},
		{"", StateError},
	}

	for _, tt := range tests {
		t.Run(tt.phase, func(t *testing.T) {
			got := mapK8sPodPhase(tt.phase)
			if got != tt.expected {
				t.Errorf("mapK8sPodPhase(%q) = %q, want %q", tt.phase, got, tt.expected)
			}
		})
	}
}

func TestGenerateK3sConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "s3cr3t!@#$",
			Name:     "volundr",
		},
		K3s: config.K3sConfig{
			Kubeconfig: "/test/kubeconfig",
			Namespace:  "test-ns",
			Provider:   "k3d",
		},
	}

	configPath, err := r.generateK3sConfig(cfg)
	if err != nil {
		t.Fatalf("generateK3sConfig: %v", err)
	}

	// Verify the file was created.
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("config file not created at %s: %v", configPath, err)
	}

	// Read and parse.
	data, err := os.ReadFile(configPath) //nolint:gosec // test file path from t.TempDir() //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed k3sAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	// Verify database settings.
	if parsed.Database["host"] != "host.docker.internal" {
		t.Errorf("expected database host host.docker.internal, got %v", parsed.Database["host"])
	}
	if parsed.Database["port"] != 5433 {
		t.Errorf("expected database port 5433, got %v", parsed.Database["port"])
	}
	if parsed.Database["password"] != "s3cr3t!@#$" {
		t.Errorf("expected password preserved, got %v", parsed.Database["password"])
	}

	// Verify adapter class path.
	if parsed.PodManager["adapter"] != "volundr.adapters.outbound.direct_k8s_pod_manager.DirectK8sPodManager" {
		t.Errorf("unexpected pod_manager adapter: %v", parsed.PodManager["adapter"])
	}

	// Verify kwargs.
	pmKwargs, ok := parsed.PodManager["kwargs"].(map[string]interface{})
	if !ok {
		t.Fatal("expected pod_manager kwargs to be a map")
	}
	if pmKwargs["namespace"] != "test-ns" {
		t.Errorf("expected namespace test-ns, got %v", pmKwargs["namespace"])
	}
	if pmKwargs["kubeconfig"] != "/etc/volundr/kubeconfig" {
		t.Errorf("expected kubeconfig /etc/volundr/kubeconfig, got %v", pmKwargs["kubeconfig"])
	}
	if pmKwargs["base_path"] != "/s" {
		t.Errorf("expected base_path /s, got %v", pmKwargs["base_path"])
	}
	if pmKwargs["ingress_class"] != "traefik" {
		t.Errorf("expected ingress_class traefik, got %v", pmKwargs["ingress_class"])
	}

	// Verify other adapters use dev-local defaults.
	if parsed.Identity["adapter"] != "volundr.adapters.outbound.identity.AllowAllIdentityAdapter" {
		t.Errorf("unexpected identity adapter: %v", parsed.Identity["adapter"])
	}
	if parsed.Authorization["adapter"] != "volundr.adapters.outbound.authorization.AllowAllAuthorizationAdapter" {
		t.Errorf("unexpected authorization adapter: %v", parsed.Authorization["adapter"])
	}
}

func TestGenerateK3sConfig_DefaultKubeconfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	// Clear KUBECONFIG so auto-detect picks up ~/.kube/config.
	t.Setenv("KUBECONFIG", "")

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
	}

	configPath, err := r.generateK3sConfig(cfg)
	if err != nil {
		t.Fatalf("generateK3sConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path from t.TempDir() //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed k3sAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	// Verify kubeconfig uses the container-mounted path.
	pmKwargs, ok := parsed.PodManager["kwargs"].(map[string]interface{})
	if !ok {
		t.Fatal("expected pod_manager kwargs to be a map")
	}
	kc, ok := pmKwargs["kubeconfig"].(string)
	if !ok {
		t.Fatal("expected kubeconfig to be a string")
	}
	if kc != "/etc/volundr/kubeconfig" {
		t.Errorf("expected kubeconfig /etc/volundr/kubeconfig, got %q", kc)
	}
}

func TestK3sWriteStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
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

	// Read back state file and verify.
	stateFilePath := filepath.Join(volundrDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // test file path
	if err != nil {
		t.Fatalf("read state file: %v", err)
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		t.Fatalf("parse state file: %v", err)
	}

	// Should have proxy, postgres, and k3s-cluster.
	// API won't be there since apiCmd is nil.
	expectedNames := map[string]bool{
		"proxy":       false,
		"postgres":    false,
		"k3s-cluster": false,
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

func TestK3sRuntime_Status_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "k3s" {
		t.Errorf("expected runtime 'k3s', got %q", status.Runtime)
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

func TestK3sRuntime_Status_PIDFileNoStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("12345"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	r := NewK3sRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if status.Runtime != "k3s" {
		t.Errorf("expected runtime 'k3s', got %q", status.Runtime)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestK3sRuntime_Status_WithStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("12345"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: 8080},
		{Name: "api", State: StateRunning, Port: 18080},
		{Name: "k3s-cluster", State: StateRunning},
	}
	stateData, _ := json.MarshalIndent(services, "", "  ")
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), stateData, 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	r := NewK3sRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	// Services from state file + any k8s pods (which will be 0 since kubectl isn't available).
	if len(status.Services) < 3 {
		t.Fatalf("expected at least 3 services, got %d", len(status.Services))
	}

	found := map[string]bool{}
	for _, svc := range status.Services {
		found[svc.Name] = true
	}

	for _, name := range []string{"proxy", "api", "k3s-cluster"} {
		if !found[name] {
			t.Errorf("expected service %q in status", name)
		}
	}
}

func TestK3sRuntime_Status_CorruptStateFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	pidPath := filepath.Join(volundrDir, PIDFile)
	if err := os.WriteFile(pidPath, []byte("12345"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}

	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("bad-json"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	r := NewK3sRuntime()
	status, err := r.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}

	if len(status.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(status.Services))
	}

	if status.Services[0].State != StateRunning {
		t.Errorf("expected state running, got %q", status.Services[0].State)
	}
}

func TestK3sRuntime_WriteStateFile_ExternalDB(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
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

	// Should not have postgres for external DB.
	for _, svc := range services {
		if svc.Name == "postgres" {
			t.Error("did not expect postgres service for external DB mode")
		}
	}

	// But should have proxy, api, and k3s-cluster.
	expected := map[string]bool{"proxy": false, "api": false, "k3s-cluster": false}
	for _, svc := range services {
		if _, ok := expected[svc.Name]; ok {
			expected[svc.Name] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("expected service %q in state file", name)
		}
	}
}

func TestHostKubeconfigPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	path := hostKubeconfigPath()
	expected := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if path != expected {
		t.Errorf("expected %q, got %q", expected, path)
	}
}

func TestRenderK3sComposeTemplate(t *testing.T) {
	data := k3sComposeData{
		APIImage:        "ghcr.io/niuulabs/volundr-api:latest",
		ContainerName:   "volundr-k3s-api",
		APIPort:         18080,
		DBHost:          "host.docker.internal",
		DBPort:          5433,
		DBUser:          "volundr",
		DBPassword:      "secret",
		DBName:          "volundr",
		AnthropicAPIKey: "sk-test",
		ConfigPath:      "/home/user/.volundr/k3s-config.yaml",
		KubeconfigPath:  "/home/user/.volundr/k3d-kubeconfig.yaml",
		StorageDir:      "/home/user/.volundr",
		ClusterName:     "volundr",
	}

	var buf bytes.Buffer
	if err := k3sComposeTemplate.Execute(&buf, data); err != nil {
		t.Fatalf("render k3s compose template: %v", err)
	}

	result := buf.String()

	checks := []string{
		`image: ghcr.io/niuulabs/volundr-api:latest`,
		`container_name: volundr-k3s-api`,
		`"127.0.0.1:18080:8080"`,
		`DATABASE__HOST: "host.docker.internal"`,
		`KUBECONFIG: "/etc/volundr/kubeconfig"`,
		`ANTHROPIC_API_KEY: "sk-test"`,
		`k3d-kubeconfig.yaml:/etc/volundr/kubeconfig:ro`,
		`k3s-config.yaml:/etc/volundr/config.yaml:ro`,
		`k3d-volundr`,
		`external: true`,
	}

	for _, check := range checks {
		if !strings.Contains(result, check) {
			t.Errorf("expected k3s compose output to contain %q, got:\n%s", check, result)
		}
	}
}

func TestRenderK3sComposeTemplate_WithoutAnthropicKey(t *testing.T) {
	data := k3sComposeData{
		APIImage:        "ghcr.io/niuulabs/volundr-api:latest",
		ContainerName:   "volundr-k3s-api",
		APIPort:         18080,
		DBHost:          "host.docker.internal",
		DBPort:          5433,
		DBUser:          "volundr",
		DBPassword:      "secret",
		DBName:          "volundr",
		AnthropicAPIKey: "",
		ConfigPath:      "/home/user/.volundr/k3s-config.yaml",
		KubeconfigPath:  "/home/user/.volundr/k3d-kubeconfig.yaml",
		StorageDir:      "/home/user/.volundr",
		ClusterName:     "volundr",
	}

	var buf bytes.Buffer
	if err := k3sComposeTemplate.Execute(&buf, data); err != nil {
		t.Fatalf("render k3s compose template: %v", err)
	}

	result := buf.String()

	if strings.Contains(result, "ANTHROPIC_API_KEY") {
		t.Error("expected no ANTHROPIC_API_KEY when key is empty")
	}
}

func TestGenerateK3sConfig_WithGit(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
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
					{Name: "main", BaseURL: "https://github.com", Token: "ghp_test"},
				},
			},
		},
	}

	configPath, err := r.generateK3sConfig(cfg)
	if err != nil {
		t.Fatalf("generateK3sConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed k3sAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if parsed.Git == nil {
		t.Fatal("expected git config to be present")
	}
}

func TestGenerateK3sConfig_WithLocalMounts(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
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
			AllowRootMount:  true,
			AllowedPrefixes: []string{"/home"},
			DefaultReadOnly: false,
		},
	}

	configPath, err := r.generateK3sConfig(cfg)
	if err != nil {
		t.Fatalf("generateK3sConfig: %v", err)
	}

	data, err := os.ReadFile(configPath) //nolint:gosec // test file path from t.TempDir()
	if err != nil {
		t.Fatalf("read config file: %v", err)
	}

	var parsed k3sAPIConfig
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}

	if parsed.LocalMounts == nil {
		t.Fatal("expected local_mounts config to be present")
	}

	if parsed.LocalMounts["enabled"] != true {
		t.Error("expected local_mounts enabled to be true")
	}
}

func TestK3sRuntime_Logs_HostService(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	logsDir := filepath.Join(volundrDir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		t.Fatalf("create logs dir: %v", err)
	}

	// Write test log files.
	if err := os.WriteFile(filepath.Join(logsDir, "api.log"), []byte("api log content\n"), 0o600); err != nil {
		t.Fatalf("write api log: %v", err)
	}
	if err := os.WriteFile(filepath.Join(logsDir, "postgres.log"), []byte("postgres log content\n"), 0o600); err != nil {
		t.Fatalf("write postgres log: %v", err)
	}

	r := NewK3sRuntime()

	// Test api logs.
	reader, err := r.Logs(context.Background(), "api", false)
	if err != nil {
		t.Fatalf("Logs(api): %v", err)
	}
	data := make([]byte, 1024)
	n, _ := reader.Read(data)
	_ = reader.Close()
	if string(data[:n]) != "api log content\n" {
		t.Errorf("expected api log content, got %q", string(data[:n]))
	}

	// Test postgres logs.
	reader, err = r.Logs(context.Background(), "postgres", false)
	if err != nil {
		t.Fatalf("Logs(postgres): %v", err)
	}
	n, _ = reader.Read(data)
	_ = reader.Close()
	if string(data[:n]) != "postgres log content\n" {
		t.Errorf("expected postgres log content, got %q", string(data[:n]))
	}
}

func TestK3sRuntime_Logs_HostServiceMissing(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
	_, err := r.Logs(context.Background(), "api", false)
	if err == nil {
		t.Fatal("expected error for missing log file")
	}
}

func TestK3sRuntime_Down_Cleanup(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir) // ensure kubectl/docker not found

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	// Create PID and state files.
	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	// Create a k3s compose file.
	composePath := filepath.Join(volundrDir, k3sComposeFileName)
	if err := os.WriteFile(composePath, []byte("services:\n  api:\n    image: test\n"), 0o600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	r := NewK3sRuntime()
	// Down will error on kubectl/docker commands but should still clean up files.
	_ = r.Down(context.Background())

	// Verify compose file was cleaned up.
	if _, err := os.Stat(composePath); !os.IsNotExist(err) {
		t.Error("expected compose file to be removed")
	}

	// PID and state files should be cleaned up.
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, StateFile)); !os.IsNotExist(err) {
		t.Error("expected state file to be removed")
	}
}

func TestK3sRuntime_WriteK3dKubeconfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir) // ensure k3d not found

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()

	// Write a mock host kubeconfig.
	hostKC := `apiVersion: v1
clusters:
- cluster:
    server: https://127.0.0.1:46443
  name: k3d-volundr
contexts:
- context:
    cluster: k3d-volundr
  name: k3d-volundr
current-context: k3d-volundr
`
	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if err := os.WriteFile(kcPath, []byte(hostKC), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	kubeconfigPath, err := r.writeK3dKubeconfig(volundrDir)
	if err != nil {
		t.Fatalf("writeK3dKubeconfig: %v", err)
	}

	// Read the written kubeconfig.
	data, err := os.ReadFile(kubeconfigPath) //nolint:gosec // test path
	if err != nil {
		t.Fatalf("read kubeconfig: %v", err)
	}

	result := string(data)

	// The localhost address should be replaced with the k3d server DNS name.
	if strings.Contains(result, "https://127.0.0.1:") {
		t.Error("expected localhost address to be replaced")
	}

	if !strings.Contains(result, "https://k3d-volundr-server-0:6443") {
		t.Errorf("expected k3d server DNS name, got:\n%s", result)
	}
}

func TestK3sRuntime_WriteK3dKubeconfig_0000(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()

	// Write a kubeconfig with 0.0.0.0 address.
	hostKC := `apiVersion: v1
clusters:
- cluster:
    server: https://0.0.0.0:6550
  name: k3d-volundr
`
	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if err := os.WriteFile(kcPath, []byte(hostKC), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	kubeconfigPath, err := r.writeK3dKubeconfig(volundrDir)
	if err != nil {
		t.Fatalf("writeK3dKubeconfig: %v", err)
	}

	data, err := os.ReadFile(kubeconfigPath) //nolint:gosec // test path
	if err != nil {
		t.Fatalf("read kubeconfig: %v", err)
	}

	if !strings.Contains(string(data), "https://k3d-volundr-server-0:6443") {
		t.Errorf("expected 0.0.0.0 to be replaced with k3d server DNS, got:\n%s", string(data))
	}
}

func TestK3sRuntime_WriteK3dKubeconfig_Localhost(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()

	hostKC := `apiVersion: v1
clusters:
- cluster:
    server: https://localhost:6550
  name: k3d-volundr
`
	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if err := os.WriteFile(kcPath, []byte(hostKC), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	kubeconfigPath, err := r.writeK3dKubeconfig(volundrDir)
	if err != nil {
		t.Fatalf("writeK3dKubeconfig: %v", err)
	}

	data, err := os.ReadFile(kubeconfigPath) //nolint:gosec // test path
	if err != nil {
		t.Fatalf("read kubeconfig: %v", err)
	}

	if !strings.Contains(string(data), "https://k3d-volundr-server-0:6443") {
		t.Errorf("expected localhost to be replaced, got:\n%s", string(data))
	}
}

func TestK3sRuntime_WriteK3dKubeconfig_NoHostKC(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir) // no k3d available

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()

	// No host kubeconfig and no k3d available => error.
	_, err := r.writeK3dKubeconfig(volundrDir)
	if err == nil {
		t.Fatal("expected error when no kubeconfig and no k3d")
	}
}

func TestK3sRuntime_DetectProvider_ExplicitNative(t *testing.T) {
	r := NewK3sRuntime()
	cfg := &config.Config{}
	cfg.K3s.Provider = "native"
	p := r.detectProvider(cfg)
	if p != "native" {
		t.Errorf("expected native, got %q", p)
	}
}

func TestK3sRuntime_DetectProvider_EmptyAutoDetect(t *testing.T) {
	r := NewK3sRuntime()
	cfg := &config.Config{}
	cfg.K3s.Provider = ""

	// With PATH set to empty dir, no k3d/k3s should be found.
	tmpDir := t.TempDir()
	t.Setenv("PATH", tmpDir)

	p := r.detectProvider(cfg)
	if p != "none" {
		t.Errorf("expected 'none' when no providers available, got %q", p)
	}
}

func TestK3sRuntime_SaveConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	cfgDir := filepath.Join(tmpDir, config.DefaultConfigDir)
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	r := NewK3sRuntime()
	cfg := &config.Config{
		Runtime: "k3s",
		Listen: config.ListenConfig{
			Host: "127.0.0.1",
			Port: 8080,
		},
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
	}

	// saveConfig should not error even if config path is writable.
	r.saveConfig(cfg)

	// Verify config file was written.
	configPath := filepath.Join(cfgDir, config.DefaultConfigFile)
	if _, err := os.Stat(configPath); err != nil {
		t.Errorf("expected config file to be written: %v", err)
	}
}

func TestK3sRuntime_EnsureNamespace_Exists(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t)

	r := NewK3sRuntime()
	err := r.ensureNamespace("test-ns")
	if err != nil {
		t.Fatalf("ensureNamespace: %v", err)
	}
}

func TestK3sRuntime_EnsureClusterRunning_K3d(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, `MOCK_RESPONSE=[{"name":"volundr"}]`)

	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if err := os.WriteFile(kcPath, []byte("apiVersion: v1\nclusters: []\n"), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	r := NewK3sRuntime()
	cfg := &config.Config{}
	cfg.K3s.Provider = "k3d"

	err := r.ensureClusterRunning(cfg)
	if err != nil {
		t.Fatalf("ensureClusterRunning: %v", err)
	}
}

func TestK3sRuntime_EnsureClusterRunning_Native(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=node1 Ready")

	r := NewK3sRuntime()
	cfg := &config.Config{}
	cfg.K3s.Provider = "native"

	err := r.ensureClusterRunning(cfg)
	if err != nil {
		t.Fatalf("ensureClusterRunning: %v", err)
	}
}

func TestK3sRuntime_EnsureClusterRunning_NoProvider(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	t.Setenv("PATH", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExecFail(t)

	r := NewK3sRuntime()
	cfg := &config.Config{}
	cfg.K3s.Provider = ""

	err := r.ensureClusterRunning(cfg)
	if err == nil {
		t.Fatal("expected error when no provider available")
	}
}

func TestK3sRuntime_Logs_KubeService(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=pod log output")

	r := NewK3sRuntime()
	reader, err := r.Logs(context.Background(), "skuld", false)
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

func TestK3sRuntime_Logs_KubeServiceFollow(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=follow output")

	r := NewK3sRuntime()
	reader, err := r.Logs(context.Background(), "skuld", true)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	_ = reader.Close()
}

func TestK3sRuntime_Down_WithMock(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	composePath := filepath.Join(volundrDir, k3sComposeFileName)
	if err := os.WriteFile(composePath, []byte("services:\n  api:\n    image: test\n"), 0o600); err != nil {
		t.Fatalf("write compose file: %v", err)
	}

	if err := os.WriteFile(filepath.Join(volundrDir, PIDFile), []byte("99999"), 0o600); err != nil {
		t.Fatalf("write PID file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(volundrDir, StateFile), []byte("[]"), 0o600); err != nil {
		t.Fatalf("write state file: %v", err)
	}

	cfgContent := "runtime: k3s\nlisten:\n  host: 127.0.0.1\n  port: 8080\ndatabase:\n  mode: embedded\n  port: 5433\n  user: volundr\n  password: test\n  name: volundr\n"
	if err := os.WriteFile(filepath.Join(volundrDir, "config.yaml"), []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=ok")

	r := NewK3sRuntime()
	err := r.Down(context.Background())
	if err != nil {
		t.Fatalf("Down: %v", err)
	}

	if _, err := os.Stat(composePath); !os.IsNotExist(err) {
		t.Error("expected compose file to be removed")
	}
	if _, err := os.Stat(filepath.Join(volundrDir, PIDFile)); !os.IsNotExist(err) {
		t.Error("expected PID file to be removed")
	}
}

func TestK3sRuntime_EnsureK8sSecrets_WithTokens(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t)

	r := NewK3sRuntime()
	cfg := &config.Config{
		Anthropic: config.AnthropicConfig{APIKey: "sk-test"},
		Git: config.GitConfig{
			GitHub: config.GitHubConfig{ //nolint:gosec // G101: test fixture, not real credentials
				Enabled:    true,
				CloneToken: "ghp_clone_test",
			},
		},
	}

	err := r.ensureK8sSecrets(cfg, "test-ns")
	if err != nil {
		t.Fatalf("ensureK8sSecrets: %v", err)
	}
}

func TestK3sRuntime_EnsureK8sSecrets_FallbackToken(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t)

	r := NewK3sRuntime()
	cfg := &config.Config{
		Git: config.GitConfig{
			GitHub: config.GitHubConfig{
				Enabled: true,
				Instances: []config.GitHubInstanceConfig{
					{Name: "main", Token: "ghp_instance_token"}, //nolint:gosec // test fixture
				},
			},
		},
	}

	err := r.ensureK8sSecrets(cfg, "test-ns")
	if err != nil {
		t.Fatalf("ensureK8sSecrets: %v", err)
	}
}

func TestK3sRuntime_EnsureK8sSecrets_NoSecrets(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t)

	r := NewK3sRuntime()
	cfg := &config.Config{}

	err := r.ensureK8sSecrets(cfg, "test-ns")
	if err != nil {
		t.Fatalf("ensureK8sSecrets: %v", err)
	}
}

func TestK3sRuntime_WriteHostKubeconfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExec(t, "MOCK_RESPONSE=apiVersion: v1\nclusters: []\n")

	r := NewK3sRuntime()
	err := r.writeHostKubeconfig()
	if err != nil {
		t.Fatalf("writeHostKubeconfig: %v", err)
	}

	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if _, err := os.Stat(kcPath); err != nil {
		t.Fatalf("kubeconfig not written: %v", err)
	}
}

func TestK3sRuntime_StartAPIContainer(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	kcPath := filepath.Join(volundrDir, k3sHostKubeconfigFile)
	if err := os.WriteFile(kcPath, []byte("apiVersion: v1\nclusters:\n- cluster:\n    server: https://127.0.0.1:6443\n"), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	k3sCfgPath := filepath.Join(volundrDir, k3sConfigFileName)
	if err := os.WriteFile(k3sCfgPath, []byte("database:\n  host: localhost\n"), 0o600); err != nil {
		t.Fatalf("write k3s config: %v", err)
	}

	withMockExec(t)

	r := NewK3sRuntime()
	cfg := &config.Config{
		Database: config.DatabaseConfig{
			Mode:     "embedded",
			Host:     "localhost",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
	}

	err := r.startAPIContainer(context.Background(), cfg)
	if err != nil {
		t.Fatalf("startAPIContainer: %v", err)
	}

	composePath := filepath.Join(volundrDir, k3sComposeFileName)
	if _, err := os.Stat(composePath); err != nil {
		t.Fatalf("compose file not written: %v", err)
	}
}

func TestK3sRuntime_QueryK8sPodStates_Success(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	podListJSON := `{"items":[{"metadata":{"name":"skuld-abc","labels":{"app.kubernetes.io/name":"skuld"}},"status":{"phase":"Running"}},{"metadata":{"name":"code-server-xyz","labels":{}},"status":{"phase":"Pending"}}]}`
	withMockExec(t, "MOCK_RESPONSE="+podListJSON)

	r := NewK3sRuntime()
	services := r.queryK8sPodStates()

	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}

	if services[0].Name != "skuld-abc" {
		t.Errorf("expected first pod name 'skuld-abc', got %q", services[0].Name)
	}
	if services[0].State != StateRunning {
		t.Errorf("expected first pod running, got %q", services[0].State)
	}
}

func TestK3sRuntime_QueryK8sPodStates_Failure(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	volundrDir := filepath.Join(tmpDir, ".volundr")
	if err := os.MkdirAll(volundrDir, 0o700); err != nil {
		t.Fatalf("create config dir: %v", err)
	}

	withMockExecFail(t)

	r := NewK3sRuntime()
	services := r.queryK8sPodStates()

	if services != nil {
		t.Errorf("expected nil services on failure, got %v", services)
	}
}

func TestNewRuntime_K3s(t *testing.T) {
	rt := NewRuntime("k3s")
	if _, ok := rt.(*K3sRuntime); !ok {
		t.Errorf("expected *K3sRuntime, got %T", rt)
	}
}
