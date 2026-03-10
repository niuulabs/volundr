package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/postgres"
	"github.com/niuulabs/volundr/cli/internal/proxy"
	"gopkg.in/yaml.v3"
)

const (
	// k3sConfigFileName is the generated API config file name for k3s mode.
	k3sConfigFileName = "k3s-config.yaml"
	// k3sDefaultNamespace is the default Kubernetes namespace for Volundr.
	k3sDefaultNamespace = "volundr"
	// k3sClusterName is the k3d cluster name.
	k3sClusterName = "volundr"
	// k3sLoadBalancerHTTPPort is the HTTP port exposed by the k3d load balancer.
	k3sLoadBalancerHTTPPort = "80:80@loadbalancer"
	// k3sLoadBalancerHTTPSPort is the HTTPS port exposed by the k3d load balancer.
	k3sLoadBalancerHTTPSPort = "443:443@loadbalancer"
	// k3sHelmReleaseName is the Helm release name for the base Skuld chart.
	k3sHelmReleaseName = "skuld-base"
	// k3sHelmChart is the OCI chart reference for Skuld.
	k3sHelmChart = "oci://ghcr.io/niuulabs/charts/skuld"
	// k3sAPIInternalPort is the host port the API listens on in k3s mode.
	k3sAPIInternalPort = 18080
	// k3sAPIStartTimeout is the maximum time to wait for the API to start.
	k3sAPIStartTimeout = 30 * time.Second
	// k3sAPIHealthCheckInterval is the interval between API health checks.
	k3sAPIHealthCheckInterval = 500 * time.Millisecond
	// k3sProcessShutdownTimeout is the time to wait for graceful process shutdown.
	k3sProcessShutdownTimeout = 5 * time.Second
)

// k3sAPIConfig represents the Python API config file structure for k3s mode.
type k3sAPIConfig struct {
	Database        map[string]interface{} `yaml:"database"`
	PodManager      map[string]interface{} `yaml:"pod_manager"`
	CredentialStore map[string]interface{} `yaml:"credential_store"`
	Storage         map[string]interface{} `yaml:"storage"`
	SecretInjection map[string]interface{} `yaml:"secret_injection"`
	Identity        map[string]interface{} `yaml:"identity"`
	Authorization   map[string]interface{} `yaml:"authorization"`
	Gateway         map[string]interface{} `yaml:"gateway"`
}

// K3sRuntime manages the Volundr stack using k3s/k3d for Kubernetes
// workloads with host-side services for PostgreSQL and the API.
type K3sRuntime struct {
	pg       *postgres.EmbeddedPostgres
	apiCmd   *exec.Cmd
	proxyRtr *proxy.Router
}

// NewK3sRuntime creates a new K3sRuntime.
func NewK3sRuntime() *K3sRuntime {
	return &K3sRuntime{}
}

// Init performs first-time setup for the k3s runtime.
func (r *K3sRuntime) Init(ctx context.Context, cfg *config.Config) error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	// Create required directories.
	dirs := []string{
		filepath.Join(cfgDir, "data", "pg"),
		filepath.Join(cfgDir, "logs"),
		filepath.Join(cfgDir, "cache"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
	}

	// Detect the k3s provider.
	provider := r.detectProvider(cfg)
	fmt.Printf("  Platform: %s\n", runtime.GOOS)
	fmt.Printf("  K3s provider: %s\n", provider)

	switch provider {
	case "k3d":
		if err := r.initK3d(ctx); err != nil {
			return err
		}
	case "native":
		if err := r.initNativeK3s(); err != nil {
			return err
		}
	default:
		return r.guideInstallation()
	}

	// Verify helm is available.
	fmt.Print("  Helm            ... ")
	if out, err := exec.Command("helm", "version", "--short").CombinedOutput(); err != nil {
		fmt.Println("not found")
		return fmt.Errorf("helm is required but not found. Install: https://helm.sh/docs/intro/install/\n%s", out)
	}
	fmt.Println("ok")

	// Create the volundr namespace.
	namespace := r.namespace(cfg)
	fmt.Printf("  Namespace       ... ")
	if err := r.ensureNamespace(namespace); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create namespace: %w", err)
	}
	fmt.Println("ok")

	// Test embedded postgres if in embedded mode.
	if cfg.Database.Mode == "embedded" {
		fmt.Println("  Downloading PostgreSQL binary...")
		pg := postgres.New(cfg)
		if err := pg.Start(ctx); err != nil {
			return fmt.Errorf("test embedded postgres: %w", err)
		}
		if err := pg.Stop(); err != nil {
			return fmt.Errorf("stop test postgres: %w", err)
		}
		fmt.Println("  PostgreSQL binary    ... ok")
	}

	return nil
}

// Up starts all services in k3s mode.
func (r *K3sRuntime) Up(ctx context.Context, cfg *config.Config) error {
	if err := CheckNotRunning(); err != nil {
		return err
	}

	// Start embedded PostgreSQL if configured.
	if cfg.Database.Mode == "embedded" {
		fmt.Print("  PostgreSQL    ... ")
		r.pg = postgres.New(cfg)
		if err := r.pg.Start(ctx); err != nil {
			fmt.Println("failed")
			return fmt.Errorf("start embedded postgres: %w", err)
		}
		fmt.Printf("started (port %d, data: %s)\n", cfg.Database.Port, cfg.Database.DataDir)

		// Run migrations.
		fmt.Print("  Migrations    ... ")
		migrationsDir := findMigrationsDir()
		if migrationsDir != "" {
			applied, err := r.pg.RunMigrations(ctx, migrationsDir)
			if err != nil {
				fmt.Println("failed")
				return fmt.Errorf("run migrations: %w", err)
			}
			fmt.Printf("applied (%d migrations)\n", applied)
		} else {
			fmt.Println("skipped (no migrations directory found)")
		}
	}

	// Ensure k3s/k3d cluster is running.
	fmt.Print("  K3s cluster   ... ")
	if err := r.ensureClusterRunning(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("ensure cluster running: %w", err)
	}
	fmt.Println("ok")

	// Generate k3s-mode config for the Python API.
	fmt.Print("  API config    ... ")
	if _, err := r.generateK3sConfig(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("generate k3s config: %w", err)
	}
	fmt.Println("ok")

	// Start the Python API on the host.
	fmt.Print("  Volundr API   ... ")
	apiPort := cfg.Listen.Port + 1
	if err := r.startAPI(ctx, cfg, apiPort); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("start API: %w", err)
	}
	fmt.Printf("started (port %d)\n", apiPort)

	// Install/upgrade the skuld base Helm chart.
	fmt.Print("  Skuld chart   ... ")
	if err := r.installSkuldChart(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("install skuld chart: %w", err)
	}
	fmt.Println("ok")

	// Start the reverse proxy.
	fmt.Print("  Proxy         ... ")
	apiURL := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
	rtr, err := proxy.NewRouter(apiURL)
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create proxy: %w", err)
	}
	r.proxyRtr = rtr

	listenAddr := fmt.Sprintf("%s:%d", cfg.Listen.Host, cfg.Listen.Port)
	go func() {
		if err := rtr.ListenAndServe(ctx, listenAddr); err != nil {
			fmt.Fprintf(os.Stderr, "proxy error: %v\n", err)
		}
	}()
	fmt.Printf("started (%s)\n", listenAddr)

	// Write PID file.
	if err := WritePIDFile(); err != nil {
		return fmt.Errorf("write PID file: %w", err)
	}

	// Write state file.
	if err := r.writeStateFile(cfg); err != nil {
		return fmt.Errorf("write state file: %w", err)
	}

	return nil
}

// Down stops all services gracefully.
// It does NOT stop k3s/k3d itself.
func (r *K3sRuntime) Down(_ context.Context) error {
	var errs []string

	// Try to load config for namespace.
	namespace := k3sDefaultNamespace
	loadedCfg, loadErr := config.Load()
	if loadErr == nil {
		namespace = resolveNamespace(loadedCfg)
	}

	// Uninstall skuld Helm release.
	if out, err := exec.Command(
		"helm", "uninstall", k3sHelmReleaseName,
		"--namespace", namespace,
	).CombinedOutput(); err != nil {
		outStr := string(out)
		if !strings.Contains(outStr, "not found") {
			errs = append(errs, fmt.Sprintf("helm uninstall: %v\n%s", err, outStr))
		}
	}

	// Delete session pods/resources in the namespace (by label).
	if out, err := exec.Command(
		"kubectl", "delete", "all",
		"--selector", "app.kubernetes.io/managed-by=volundr",
		"--namespace", namespace,
	).CombinedOutput(); err != nil {
		outStr := string(out)
		if !strings.Contains(outStr, "not found") && !strings.Contains(outStr, "No resources found") {
			errs = append(errs, fmt.Sprintf("delete session resources: %v\n%s", err, outStr))
		}
	}

	// Stop API process.
	if r.apiCmd != nil && r.apiCmd.Process != nil {
		if err := r.apiCmd.Process.Signal(syscall.SIGTERM); err != nil {
			errs = append(errs, fmt.Sprintf("stop API: %v", err))
		}
		done := make(chan error, 1)
		go func() { done <- r.apiCmd.Wait() }()
		select {
		case <-done:
		case <-time.After(k3sProcessShutdownTimeout):
			_ = r.apiCmd.Process.Kill()
		}
	}

	// Stop embedded PostgreSQL.
	if r.pg != nil {
		if err := r.pg.Stop(); err != nil {
			errs = append(errs, fmt.Sprintf("stop postgres: %v", err))
		}
	}

	// Remove PID and state files.
	_ = RemovePIDFile()
	_ = RemoveStateFile()

	if len(errs) > 0 {
		return fmt.Errorf("errors during shutdown: %s", strings.Join(errs, "; "))
	}

	return nil
}

// Status returns the state of each service.
func (r *K3sRuntime) Status(_ context.Context) (*StackStatus, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return nil, fmt.Errorf("get config dir: %w", err)
	}

	status := &StackStatus{
		Runtime: "k3s",
	}

	// Check PID file.
	pidPath := filepath.Join(cfgDir, PIDFile)
	_, err = os.Stat(pidPath)
	if os.IsNotExist(err) {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateStopped},
		}
		return status, nil
	}

	// Try to load state file for detailed status.
	stateFilePath := filepath.Join(cfgDir, StateFile)
	data, err := os.ReadFile(stateFilePath)
	if err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning},
		}
		return status, nil
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning},
		}
		return status, nil
	}

	// Query k8s pod states and merge.
	k8sServices := r.queryK8sPodStates()
	services = append(services, k8sServices...)

	status.Services = services
	return status, nil
}

// Logs streams logs for a service.
func (r *K3sRuntime) Logs(_ context.Context, service string, follow bool) (io.ReadCloser, error) {
	// For host services (api, postgres), use log files.
	if service == "api" || service == "postgres" {
		cfgDir, err := config.ConfigDir()
		if err != nil {
			return nil, fmt.Errorf("get config dir: %w", err)
		}
		logPath := filepath.Join(cfgDir, "logs", service+".log")
		f, err := os.Open(logPath)
		if err != nil {
			return nil, fmt.Errorf("open log file for %s: %w", service, err)
		}
		return f, nil
	}

	// For k8s services, use kubectl logs.
	namespace := k3sDefaultNamespace
	if loadedCfg, loadErr := config.Load(); loadErr == nil {
		namespace = resolveNamespace(loadedCfg)
	}

	args := []string{"logs", "--namespace", namespace}
	if follow {
		args = append(args, "-f")
	}

	// Use label selector to find pods for the service.
	args = append(args, "-l", fmt.Sprintf("app.kubernetes.io/name=%s", service))

	cmd := exec.Command("kubectl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("get stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start kubectl logs: %w", err)
	}

	return &cmdReadCloser{cmd: cmd, ReadCloser: stdout}, nil
}

// detectProvider determines the k3s provider to use.
func (r *K3sRuntime) detectProvider(cfg *config.Config) string {
	// Check explicit config.
	if cfg.K3s.Provider != "" && cfg.K3s.Provider != "auto" {
		return cfg.K3s.Provider
	}

	// Check if k3d is available.
	if err := exec.Command("k3d", "version").Run(); err == nil {
		return "k3d"
	}

	// Check if native k3s is available (Linux only).
	if runtime.GOOS == "linux" {
		if err := exec.Command("k3s", "--version").Run(); err == nil {
			return "native"
		}
	}

	return "none"
}

// initK3d sets up k3d.
func (r *K3sRuntime) initK3d(ctx context.Context) error {
	fmt.Print("  k3d            ... ")

	// Check if k3d is installed.
	if out, err := exec.Command("k3d", "version").CombinedOutput(); err != nil {
		fmt.Println("not found")
		return fmt.Errorf("k3d is not installed: %w\n%s", err, out)
	}
	fmt.Println("ok")

	// Check if cluster already exists.
	fmt.Print("  k3d cluster    ... ")
	out, err := exec.Command("k3d", "cluster", "list", "-o", "json").CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("list k3d clusters: %w\n%s", err, out)
	}

	if strings.Contains(string(out), k3sClusterName) {
		fmt.Println("exists")
		return nil
	}

	// Create the cluster.
	fmt.Print("creating ... ")
	createOut, err := exec.CommandContext(ctx,
		"k3d", "cluster", "create", k3sClusterName,
		"-p", k3sLoadBalancerHTTPPort,
		"-p", k3sLoadBalancerHTTPSPort,
	).CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create k3d cluster: %w\n%s", err, createOut)
	}
	fmt.Println("ok")

	return nil
}

// initNativeK3s verifies native k3s is running.
func (r *K3sRuntime) initNativeK3s() error {
	fmt.Print("  k3s            ... ")

	out, err := exec.Command("kubectl", "get", "nodes").CombinedOutput()
	if err != nil {
		fmt.Println("not reachable")
		return fmt.Errorf("k3s cluster not reachable. Ensure k3s is running: %w\n%s", err, out)
	}
	fmt.Println("ok")

	return nil
}

// guideInstallation prints installation instructions.
func (r *K3sRuntime) guideInstallation() error {
	switch runtime.GOOS {
	case "darwin":
		return fmt.Errorf(
			"no k3s provider found. Install k3d:\n" +
				"  brew install k3d\n" +
				"Then run 'volundr init' again",
		)
	case "linux":
		return fmt.Errorf(
			"no k3s provider found. Install one of:\n" +
				"  k3d:    curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash\n" +
				"  k3s:    curl -sfL https://get.k3s.io | sh -\n" +
				"Then run 'volundr init' again",
		)
	default:
		return fmt.Errorf(
			"no k3s provider found. Install k3d: https://k3d.io\n" +
				"Then run 'volundr init' again",
		)
	}
}

// ensureNamespace creates the Kubernetes namespace if it doesn't exist.
func (r *K3sRuntime) ensureNamespace(namespace string) error {
	// Check if namespace exists.
	if err := exec.Command("kubectl", "get", "namespace", namespace).Run(); err == nil {
		return nil
	}

	out, err := exec.Command("kubectl", "create", "namespace", namespace).CombinedOutput()
	if err != nil {
		// Ignore "already exists" errors.
		if strings.Contains(string(out), "already exists") {
			return nil
		}
		return fmt.Errorf("create namespace %s: %w\n%s", namespace, err, out)
	}

	return nil
}

// ensureClusterRunning makes sure the k3s/k3d cluster is up.
func (r *K3sRuntime) ensureClusterRunning(cfg *config.Config) error {
	provider := r.detectProvider(cfg)

	switch provider {
	case "k3d":
		// Check if cluster is running.
		out, err := exec.Command("k3d", "cluster", "list", "-o", "json").CombinedOutput()
		if err != nil {
			return fmt.Errorf("list k3d clusters: %w\n%s", err, out)
		}

		// If cluster exists but isn't running, start it.
		if strings.Contains(string(out), k3sClusterName) {
			// Try to start it (no-op if already running).
			startOut, err := exec.Command("k3d", "cluster", "start", k3sClusterName).CombinedOutput()
			if err != nil {
				return fmt.Errorf("start k3d cluster: %w\n%s", err, startOut)
			}
			return nil
		}

		return fmt.Errorf("k3d cluster %q not found. Run 'volundr init' first", k3sClusterName)

	case "native":
		// Check if nodes are ready.
		out, err := exec.Command("kubectl", "get", "nodes").CombinedOutput()
		if err != nil {
			return fmt.Errorf("k3s cluster not reachable: %w\n%s", err, out)
		}
		return nil

	default:
		return fmt.Errorf("no k3s provider found. Run 'volundr init' first")
	}
}

// generateK3sConfig creates a config.yaml for the Python API in k3s mode.
func (r *K3sRuntime) generateK3sConfig(cfg *config.Config) (string, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return "", fmt.Errorf("get config dir: %w", err)
	}

	namespace := r.namespace(cfg)
	kubeconfig := r.resolveKubeconfig(cfg)

	apiCfg := k3sAPIConfig{
		Database: map[string]interface{}{
			"host":     "127.0.0.1",
			"port":     cfg.Database.Port,
			"user":     cfg.Database.User,
			"password": cfg.Database.Password,
			"name":     cfg.Database.Name,
		},
		PodManager: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.direct_k8s_pod_manager.DirectK8sPodManager",
			"kwargs": map[string]interface{}{
				"namespace":    namespace,
				"kubeconfig":   kubeconfig,
				"base_path":    "/s",
				"ingress_class": "traefik",
				"db_host":      "host.k3d.internal",
				"db_port":      cfg.Database.Port,
				"db_user":      cfg.Database.User,
				"db_password":  cfg.Database.Password,
				"db_name":      cfg.Database.Name,
			},
		},
		CredentialStore: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.file_credential_store.FileCredentialStore",
			"kwargs": map[string]interface{}{
				"base_dir": filepath.Join(cfgDir, "user-credentials"),
			},
		},
		Storage: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.local_storage_adapter.LocalStorageAdapter",
			"kwargs": map[string]interface{}{
				"base_dir": cfgDir,
			},
		},
		SecretInjection: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.memory_secret_injection.InMemorySecretInjectionAdapter",
		},
		Identity: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.identity.AllowAllIdentityAdapter",
		},
		Authorization: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.authorization.AllowAllAuthorizationAdapter",
		},
		Gateway: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.k8s_gateway.InMemoryGatewayAdapter",
		},
	}

	data, err := yaml.Marshal(&apiCfg)
	if err != nil {
		return "", fmt.Errorf("marshal k3s config: %w", err)
	}

	configPath := filepath.Join(cfgDir, k3sConfigFileName)
	if err := os.WriteFile(configPath, data, 0o644); err != nil {
		return "", fmt.Errorf("write k3s config: %w", err)
	}

	return configPath, nil
}

// startAPI starts the Python API process on the host.
func (r *K3sRuntime) startAPI(ctx context.Context, cfg *config.Config, port int) error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	logFile, err := os.OpenFile(
		filepath.Join(cfgDir, "logs", "api.log"),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND,
		0o644,
	)
	if err != nil {
		return fmt.Errorf("open API log file: %w", err)
	}

	configPath := filepath.Join(cfgDir, k3sConfigFileName)

	r.apiCmd = exec.CommandContext(ctx,
		"python3", "-m", "uvicorn",
		"volundr.main:app",
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
	)

	r.apiCmd.Stdout = logFile
	r.apiCmd.Stderr = logFile

	// Set environment variables.
	r.apiCmd.Env = append(os.Environ(),
		fmt.Sprintf("DATABASE__HOST=127.0.0.1"),
		fmt.Sprintf("DATABASE__PORT=%d", cfg.Database.Port),
		fmt.Sprintf("DATABASE__USER=%s", cfg.Database.User),
		fmt.Sprintf("DATABASE__PASSWORD=%s", cfg.Database.Password),
		fmt.Sprintf("DATABASE__NAME=%s", cfg.Database.Name),
		fmt.Sprintf("VOLUNDR_CONFIG=%s", configPath),
	)

	if cfg.Anthropic.APIKey != "" {
		r.apiCmd.Env = append(r.apiCmd.Env,
			fmt.Sprintf("ANTHROPIC_API_KEY=%s", cfg.Anthropic.APIKey),
		)
	}

	if err := r.apiCmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("start uvicorn: %w", err)
	}

	return nil
}

// installSkuldChart installs or upgrades the skuld Helm chart.
func (r *K3sRuntime) installSkuldChart(cfg *config.Config) error {
	namespace := r.namespace(cfg)

	out, err := exec.Command(
		"helm", "upgrade", "--install", k3sHelmReleaseName,
		k3sHelmChart,
		"--namespace", namespace,
		"--set", "gateway.enabled=false",
		"--set", "ingress.mode=path",
		"--set", "ingress.enabled=false",
		"--create-namespace",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("helm upgrade --install: %w\n%s", err, out)
	}

	return nil
}

// writeStateFile writes the service status to the state file.
func (r *K3sRuntime) writeStateFile(cfg *config.Config) error {
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: cfg.Listen.Port},
	}

	if r.apiCmd != nil && r.apiCmd.Process != nil {
		services = append(services, ServiceStatus{
			Name:  "api",
			State: StateRunning,
			PID:   r.apiCmd.Process.Pid,
			Port:  cfg.Listen.Port + 1,
		})
	}

	if cfg.Database.Mode == "embedded" {
		services = append(services, ServiceStatus{
			Name:  "postgres",
			State: StateRunning,
			Port:  cfg.Database.Port,
		})
	}

	services = append(services, ServiceStatus{
		Name:  "k3s-cluster",
		State: StateRunning,
	})

	return WriteStateFile(services)
}

// queryK8sPodStates queries Kubernetes for pod states in the volundr namespace.
func (r *K3sRuntime) queryK8sPodStates() []ServiceStatus {
	namespace := k3sDefaultNamespace
	if loadedCfg, loadErr := config.Load(); loadErr == nil {
		namespace = resolveNamespace(loadedCfg)
	}

	out, err := exec.Command(
		"kubectl", "get", "pods",
		"--namespace", namespace,
		"-o", "json",
	).CombinedOutput()
	if err != nil {
		return nil
	}

	var podList struct {
		Items []struct {
			Metadata struct {
				Name   string            `json:"name"`
				Labels map[string]string `json:"labels"`
			} `json:"metadata"`
			Status struct {
				Phase string `json:"phase"`
			} `json:"status"`
		} `json:"items"`
	}

	if err := json.Unmarshal(out, &podList); err != nil {
		return nil
	}

	var services []ServiceStatus
	for _, pod := range podList.Items {
		state := mapK8sPodPhase(pod.Status.Phase)
		services = append(services, ServiceStatus{
			Name:  pod.Metadata.Name,
			State: state,
		})
	}

	return services
}

// mapK8sPodPhase maps a Kubernetes pod phase to a ServiceState.
func mapK8sPodPhase(phase string) ServiceState {
	switch phase {
	case "Running":
		return StateRunning
	case "Pending":
		return StateStarting
	case "Succeeded":
		return StateStopped
	case "Failed":
		return StateError
	default:
		return StateError
	}
}

// namespace returns the configured namespace or the default.
func (r *K3sRuntime) namespace(cfg *config.Config) string {
	if cfg.K3s.Namespace != "" {
		return cfg.K3s.Namespace
	}
	return k3sDefaultNamespace
}

// resolveNamespace resolves the namespace from config, with default fallback.
func resolveNamespace(cfg *config.Config) string {
	if cfg.K3s.Namespace != "" {
		return cfg.K3s.Namespace
	}
	return k3sDefaultNamespace
}

// resolveKubeconfig returns the kubeconfig path from config or auto-detects it.
func (r *K3sRuntime) resolveKubeconfig(cfg *config.Config) string {
	if cfg.K3s.Kubeconfig != "" {
		return cfg.K3s.Kubeconfig
	}

	// Try standard locations.
	if env := os.Getenv("KUBECONFIG"); env != "" {
		return env
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	return filepath.Join(home, ".kube", "config")
}
