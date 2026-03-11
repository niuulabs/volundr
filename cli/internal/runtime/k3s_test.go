package runtime

import (
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
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
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
	data, err := os.ReadFile(configPath)
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
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
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

	data, err := os.ReadFile(configPath)
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
	data, err := os.ReadFile(stateFilePath)
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

func TestNewRuntime_K3s(t *testing.T) {
	rt := NewRuntime("k3s")
	if _, ok := rt.(*K3sRuntime); !ok {
		t.Errorf("expected *K3sRuntime, got %T", rt)
	}
}
