package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"text/template"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/proxy"
	"gopkg.in/yaml.v3"
)

const (
	// K3s config file name for API configuration.
	k3sConfigFileName = "k3s-config.yaml"
	// Default Kubernetes namespace for Volundr.
	k3sDefaultNamespace = "volundr"
	// K3d cluster name.
	k3sClusterName = "volundr"
	// HTTP port exposed by the k3d load balancer.
	k3sLoadBalancerHTTPPort = "80:80@loadbalancer"
	// HTTPS port exposed by the k3d load balancer.
	k3sLoadBalancerHTTPSPort = "443:443@loadbalancer"
	// Host port the API listens on in k3s mode.
	k3sAPIInternalPort = 18080
)

// k3sComposeFileName is the generated compose file name for k3s mode.
const k3sComposeFileName = "docker-compose.k3s.yaml"

// k3sContainerName is the API container name in k3s mode.
const k3sContainerName = "volundr-k3s-api"

// k3sHostKubeconfigFile is the kubeconfig file for host-side kubectl/helm.
// Written to ~/.volundr/ so we never touch ~/.kube/config.
const k3sHostKubeconfigFile = "kubeconfig.yaml"

// k3sNodeStoragePath is the path inside k3d nodes where host storage is mounted.
// Used with hostPath volumes so pods can access the volundr storage directory.
const k3sNodeStoragePath = "/volundr-storage"

// k3sDockerKubeconfigFile is the kubeconfig rewritten for Docker network access.
const k3sDockerKubeconfigFile = "k3d-kubeconfig.yaml"

// k3sComposeTemplate is the Docker Compose template for the API in k3s mode.
// It mounts the kubeconfig so the API can talk to the k3d cluster.
var k3sComposeTemplate = template.Must(template.New("k3s-compose").Parse(`services:
  api:
    image: {{.APIImage}}
    container_name: {{.ContainerName}}
    ports:
      - "127.0.0.1:{{.APIPort}}:8080"
    environment:
      DATABASE__HOST: "{{.DBHost}}"
      DATABASE__PORT: "{{.DBPort}}"
      DATABASE__USER: "{{.DBUser}}"
      DATABASE__PASSWORD: "{{.DBPassword}}"
      DATABASE__NAME: "{{.DBName}}"
{{- if .AnthropicAPIKey}}
      ANTHROPIC_API_KEY: "{{.AnthropicAPIKey}}"
{{- end}}
      KUBECONFIG: "/etc/volundr/kubeconfig"
    volumes:
      - "{{.ConfigPath}}:/etc/volundr/config.yaml:ro"
      - "{{.KubeconfigPath}}:/etc/volundr/kubeconfig:ro"
      - "{{.StorageDir}}:/volundr-storage"
{{- if .ExtraHosts}}
    extra_hosts:
{{- range .ExtraHosts}}
      - "{{.}}"
{{- end}}
{{- end}}
    networks:
      - k3d-{{.ClusterName}}

networks:
  k3d-{{.ClusterName}}:
    external: true
`))

// k3sComposeData holds the template data for the k3s compose file.
type k3sComposeData struct {
	APIImage        string
	ContainerName   string
	APIPort         int
	DBHost          string
	DBPort          int
	DBUser          string
	DBPassword      string
	DBName          string
	AnthropicAPIKey string
	ConfigPath      string
	KubeconfigPath  string
	StorageDir      string
	ClusterName     string
	ExtraHosts      []string
}

// k3sAPIConfig represents the Python API config file structure for k3s mode.
type k3sAPIConfig struct {
	Database            map[string]interface{}   `yaml:"database"`
	PodManager          map[string]interface{}   `yaml:"pod_manager"`
	CredentialStore     map[string]interface{}   `yaml:"credential_store"`
	Storage             map[string]interface{}   `yaml:"storage"`
	SecretInjection     map[string]interface{}   `yaml:"secret_injection"`
	Identity            map[string]interface{}   `yaml:"identity"`
	Authorization       map[string]interface{}   `yaml:"authorization"`
	Gateway             map[string]interface{}   `yaml:"gateway"`
	ResourceProvider    map[string]interface{}   `yaml:"resource_provider,omitempty"`
	Git                 map[string]interface{}   `yaml:"git,omitempty"`
	LocalMounts         map[string]interface{}   `yaml:"local_mounts,omitempty"`
	SessionContributors []map[string]interface{} `yaml:"session_contributors,omitempty"`
}

// K3sRuntime manages the Volundr stack using k3s/k3d for Kubernetes
// workloads with a Docker container for the API and embedded PostgreSQL.
type K3sRuntime struct {
	pg       postgresProvider
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
		if err := r.initK3d(ctx, cfg); err != nil {
			return err
		}
	case "native":
		if err := r.initNativeK3s(cfg); err != nil {
			return err
		}
	default:
		if err := r.offerInstallation(ctx, cfg); err != nil {
			return err
		}
	}

	// Verify kubectl is available.
	fmt.Print("  kubectl         ... ")
	if _, err := execCommandContext(ctx, "kubectl", "version", "--client").CombinedOutput(); err != nil {
		fmt.Println("not found")
		return fmt.Errorf("kubectl is required but not installed. Install it from https://kubernetes.io/docs/tasks/tools/")
	}
	fmt.Println("ok")

	// Verify helm is available, offer to install if not.
	fmt.Print("  Helm            ... ")
	if _, err := execCommandContext(ctx, "helm", "version", "--short").CombinedOutput(); err != nil {
		fmt.Println("not found")
		if err := r.offerInstallHelm(); err != nil {
			return err
		}
	} else {
		fmt.Println("ok")
	}

	// Create the volundr namespace.
	namespace := r.namespace(cfg)
	fmt.Printf("  Namespace       ... ")
	if err := r.ensureNamespace(namespace); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create namespace: %w", err)
	}
	fmt.Println("ok")

	// Create Kubernetes secrets for session pods.
	if err := r.ensureK8sSecrets(cfg, namespace); err != nil {
		return fmt.Errorf("create k8s secrets: %w", err)
	}

	// Test embedded postgres if in embedded mode.
	if cfg.Database.Mode == "embedded" {
		fmt.Println("  Downloading PostgreSQL binary...")
		pg := newPostgres(cfg)
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
		r.pg = newPostgres(cfg)
		if err := r.pg.Start(ctx); err != nil {
			fmt.Println("failed")
			return fmt.Errorf("start embedded postgres: %w", err)
		}
		fmt.Printf("started (port %d, data: %s)\n", cfg.Database.Port, cfg.Database.DataDir)

		// Run migrations.
		fmt.Print("  Migrations    ... ")
		applied, source, err := runMigrationsAuto(ctx, r.pg)
		if err != nil {
			fmt.Println("failed")
			return fmt.Errorf("run migrations: %w", err)
		}
		if source != "" {
			fmt.Printf("applied (%d migrations, source: %s)\n", applied, source)
		} else {
			fmt.Println("skipped (no migrations found)")
		}
	}

	// Ensure k3s/k3d cluster is running.
	fmt.Print("  K3s cluster   ... ")
	if err := r.ensureClusterRunning(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("ensure cluster running: %w", err)
	}
	fmt.Println("ok")

	// Ensure Kubernetes secrets are up to date.
	namespace := r.namespace(cfg)
	if err := r.ensureK8sSecrets(cfg, namespace); err != nil {
		return fmt.Errorf("create k8s secrets: %w", err)
	}

	// Ensure storage directories are accessible by the container user.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}
	if err := ensureContainerStorageDirs(cfgDir); err != nil {
		return fmt.Errorf("ensure container storage dirs: %w", err)
	}

	// Generate k3s-mode config for the Python API.
	fmt.Print("  API config    ... ")
	if _, err := r.generateK3sConfig(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("generate k3s config: %w", err)
	}
	fmt.Println("ok")

	// Start the API in a Docker container connected to the k3d network.
	fmt.Print("  Volundr API   ... ")
	if err := r.startAPIContainer(ctx, cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("start API container: %w", err)
	}
	fmt.Printf("started (port %d)\n", k3sAPIInternalPort)

	// Start the reverse proxy.
	fmt.Print("  Proxy         ... ")
	apiURL := fmt.Sprintf("http://127.0.0.1:%d", k3sAPIInternalPort)
	rtr, err := proxy.NewRouter(apiURL)
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create proxy: %w", err)
	}
	// Route /s/ paths to the k3d ingress (Traefik on port 80).
	if err := rtr.SetSessionBackend("http://127.0.0.1:80"); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("set session backend: %w", err)
	}
	// Rewrite Docker-internal endpoint hostnames in API responses so
	// the browser gets URLs it can resolve (using the request Host header).
	rtr.AddRewriteHost(fmt.Sprintf("k3d-%s-serverlb", k3sClusterName))
	configureWeb(rtr, cfg)
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

	// Delete session pods/resources in the namespace (by label).
	kcPath := hostKubeconfigPath()
	if out, err := execCommandContext(context.Background(), //nolint:gosec // arguments from trusted internal config
		"kubectl", "delete", "all",
		"--selector", "app.kubernetes.io/managed-by=volundr",
		"--namespace", namespace,
		"--kubeconfig", kcPath,
	).CombinedOutput(); err != nil {
		outStr := string(out)
		if !strings.Contains(outStr, "not found") && !strings.Contains(outStr, "No resources found") {
			errs = append(errs, fmt.Sprintf("delete session resources: %v\n%s", err, outStr))
		}
	}

	// Stop API container via docker compose.
	if cfgDir, dirErr := config.ConfigDir(); dirErr == nil {
		composePath := filepath.Join(cfgDir, k3sComposeFileName)
		if _, statErr := os.Stat(composePath); statErr == nil {
			if out, composeErr := execCommand( //nolint:gosec // arguments from trusted internal config
				"docker", "compose",
				"-f", composePath,
				"-p", "volundr-k3s",
				"down",
			).CombinedOutput(); composeErr != nil {
				errs = append(errs, fmt.Sprintf("docker compose down: %v\n%s", composeErr, out))
			}
			_ = os.Remove(composePath)
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
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning},
		}
		return status, nil //nolint:nilerr // return partial status when state file is missing
	}

	var services []ServiceStatus //nolint:prealloc // populated by json.Unmarshal, capacity unknown
	if err := json.Unmarshal(data, &services); err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning},
		}
		return status, nil //nolint:nilerr // return partial status when state file is corrupt
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
		f, err := os.Open(logPath) //nolint:gosec // path derived from trusted config directory
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

	args := []string{"logs", "--namespace", namespace, "--kubeconfig", hostKubeconfigPath()}
	if follow {
		args = append(args, "-f")
	}

	// Use label selector to find pods for the service.
	args = append(args, "-l", fmt.Sprintf("app.kubernetes.io/name=%s", service))

	cmd := execCommand("kubectl", args...) //nolint:gosec // arguments from trusted internal config
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
	if err := execCommandContext(context.Background(), "k3d", "version").Run(); err == nil {
		return "k3d"
	}

	// Check if native k3s is available (Linux only).
	if runtime.GOOS == "linux" {
		if err := execCommandContext(context.Background(), "k3s", "--version").Run(); err == nil {
			return "native"
		}
	}

	return "none"
}

// initK3d sets up k3d.
func (r *K3sRuntime) initK3d(ctx context.Context, cfg *config.Config) error {
	fmt.Print("  k3d            ... ")

	// Check if k3d is installed.
	if out, err := execCommandContext(ctx, "k3d", "version").CombinedOutput(); err != nil {
		fmt.Println("not found")
		return fmt.Errorf("k3d is not installed: %w\n%s", err, out)
	}
	fmt.Println("ok")

	// Check if cluster already exists.
	fmt.Print("  k3d cluster    ... ")
	out, err := execCommandContext(ctx, "k3d", "cluster", "list", "-o", "json").CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("list k3d clusters: %w\n%s", err, out)
	}

	if strings.Contains(string(out), k3sClusterName) {
		fmt.Println("exists")
		// Cluster exists — still prompt for local mounts config if not
		// yet configured (the k3d node volumes can't change, but the
		// config flag is needed for the API to show mount options).
		if !cfg.LocalMounts.Enabled {
			r.promptK3dLocalMountPrefixes(cfg)
		}
		return nil
	}

	// Create the cluster — do NOT update ~/.kube/config.
	// Mount the volundr storage dir into k3d nodes so pods can use hostPath volumes.
	fmt.Print("creating ... ")
	cfgDir, err := config.ConfigDir()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("get config dir: %w", err)
	}
	storageVolume := cfgDir + ":" + k3sNodeStoragePath
	createArgs := []string{
		"cluster", "create", k3sClusterName,
		"-p", k3sLoadBalancerHTTPPort,
		"-p", k3sLoadBalancerHTTPSPort,
		"--kubeconfig-update-default=false",
		"--volume", storageVolume,
	}

	// Ask the user if they want local folder mounts and which root path
	// to bind-mount into the k3d node.
	for _, prefix := range r.promptK3dLocalMountPrefixes(cfg) {
		createArgs = append(createArgs, "--volume", prefix+":"+prefix)
	}

	fmt.Print("  Creating k3d cluster ... ")

	createOut, err := execCommandContext(ctx, //nolint:gosec // arguments from trusted internal config
		"k3d", createArgs...,
	).CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create k3d cluster: %w\n%s", err, createOut)
	}
	fmt.Println("ok")

	// Write the kubeconfig to the volundr config directory.
	if err := r.writeHostKubeconfig(); err != nil {
		return fmt.Errorf("write kubeconfig: %w", err)
	}

	return nil
}

// initNativeK3s verifies native k3s is running and optionally enables
// local folder mounts (no volume dance needed — host paths are directly
// accessible on native k3s).
func (r *K3sRuntime) initNativeK3s(cfg *config.Config) error {
	fmt.Print("  k3s            ... ")

	// For native k3s, copy the default kubeconfig to the volundr config dir.
	defaultKC := "/etc/rancher/k3s/k3s.yaml"
	if env := os.Getenv("KUBECONFIG"); env != "" {
		defaultKC = env
	}
	kcPath := hostKubeconfigPath()
	if data, err := os.ReadFile(defaultKC); err == nil { //nolint:gosec // path from known kubeconfig location or KUBECONFIG env
		if writeErr := os.WriteFile(kcPath, data, 0o644); writeErr != nil { //nolint:gosec // kubeconfig must be readable by container user
			return fmt.Errorf("write kubeconfig: %w", writeErr)
		}
	}

	out, err := execCommand("kubectl", "get", "nodes", "--kubeconfig", kcPath).CombinedOutput() //nolint:gosec // kubeconfig path from trusted config
	if err != nil {
		fmt.Println("not reachable")
		return fmt.Errorf("k3s cluster not reachable. Ensure k3s is running: %w\n%s", err, out)
	}
	fmt.Println("ok")

	// Offer to enable local folder mounts if not already configured.
	if !cfg.LocalMounts.Enabled {
		r.promptEnableLocalMounts(cfg)
	}

	return nil
}

// PromptK3dLocalMountPrefixes asks the user which host paths to mount
// into the k3d node during cluster creation. K3d runs k3s inside Docker,
// so host directories must be explicitly bind-mounted into the node
// before pods can use them via hostPath volumes.
//
// Returns the list of prefixes to mount, or nil if the user declines.
// Persists the choice back to config.
func (r *K3sRuntime) promptK3dLocalMountPrefixes(cfg *config.Config) []string {
	// If already fully configured, use as-is.
	if cfg.LocalMounts.Enabled && len(cfg.LocalMounts.AllowedPrefixes) > 0 {
		return cfg.LocalMounts.AllowedPrefixes
	}

	fmt.Println()
	fmt.Println("  Local folder mounts let sessions access directories from this machine.")
	fmt.Println("  Since k3d runs Kubernetes inside Docker, host directories must be")
	fmt.Println("  mounted into the k3d node at cluster creation time.")
	fmt.Println()

	if !promptYesNo("  Enable local folder mounts?") {
		return nil
	}

	home, _ := os.UserHomeDir()
	fmt.Println()
	fmt.Println("  Enter the root path that sessions are allowed to mount.")
	fmt.Println("  Any subdirectory under this path will be mountable.")
	fmt.Println()
	if home != "" {
		fmt.Printf("  Root path [%s]: ", home)
	} else {
		fmt.Print("  Root path: ")
	}

	reader := stdinBufReader
	answer, _ := reader.ReadString('\n')
	answer = strings.TrimSpace(answer)

	if answer == "" {
		answer = home
	}
	if answer == "" {
		return nil
	}

	// Persist to config.
	cfg.LocalMounts.Enabled = true
	cfg.LocalMounts.AllowedPrefixes = []string{answer}
	r.saveConfig(cfg)

	return []string{answer}
}

// promptEnableLocalMounts offers to enable local folder mounts on native
// k3s, where host paths are directly accessible without extra volume
// mounting. Only sets the enabled flag in config.
func (r *K3sRuntime) promptEnableLocalMounts(cfg *config.Config) {
	fmt.Println()
	fmt.Println("  Local folder mounts let sessions access directories from this machine.")
	fmt.Println()

	if !promptYesNo("  Enable local folder mounts?") {
		return
	}

	cfg.LocalMounts.Enabled = true
	r.saveConfig(cfg)
}

// saveConfig persists the current config back to disk.
func (r *K3sRuntime) saveConfig(cfg *config.Config) {
	if cfgPath, err := config.ConfigPath(); err == nil {
		_ = cfg.SaveTo(cfgPath)
	}
}

// promptYesNo asks the user a yes/no question and returns true for yes.
func promptYesNo(prompt string) bool {
	fmt.Printf("%s [y/N]: ", prompt)
	reader := stdinBufReader
	answer, _ := reader.ReadString('\n')
	answer = strings.TrimSpace(strings.ToLower(answer))
	return answer == "y" || answer == "yes"
}

// offerInstallation offers to install k3d (and k3s on Linux) interactively.
func (r *K3sRuntime) offerInstallation(ctx context.Context, cfg *config.Config) error {
	fmt.Println("  No k3s provider found.")
	fmt.Println()

	switch runtime.GOOS {
	case "darwin":
		return r.offerInstallK3dDarwin(ctx, cfg)
	case "linux":
		return r.offerInstallLinux(ctx, cfg)
	default:
		return fmt.Errorf(
			"unsupported platform %q for k3s runtime. Install k3d manually: https://k3d.io",
			runtime.GOOS,
		)
	}
}

// offerInstallK3dDarwin offers to install k3d via Homebrew on macOS.
func (r *K3sRuntime) offerInstallK3dDarwin(ctx context.Context, cfg *config.Config) error {
	// Check if Homebrew is available.
	if _, err := execCommandContext(ctx, "brew", "--version").CombinedOutput(); err != nil {
		fmt.Println("  Homebrew is not installed. Install k3d manually:")
		fmt.Println("    curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash")
		if !promptYesNo("  Run the install script now?") {
			return fmt.Errorf("k3d is required. Install it and run 'volundr init' again")
		}
		return r.installK3dScript(ctx)
	}

	if !promptYesNo("  Install k3d via Homebrew? (brew install k3d)") {
		return fmt.Errorf("k3d is required. Install it and run 'volundr init' again")
	}

	fmt.Print("  Installing k3d  ... ")
	out, err := execCommandContext(ctx, "brew", "install", "k3d").CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("brew install k3d: %w\n%s", err, out)
	}
	fmt.Println("ok")

	// Now init the k3d cluster.
	return r.initK3d(ctx, cfg)
}

// offerInstallLinux offers k3d or native k3s installation on Linux.
func (r *K3sRuntime) offerInstallLinux(ctx context.Context, cfg *config.Config) error {
	fmt.Println("  Available options:")
	fmt.Println("    1) k3d  - k3s in Docker (recommended if Docker is available)")
	fmt.Println("    2) k3s  - native k3s (requires root, full GPU support)")
	fmt.Println()
	fmt.Print("  Choose [1/2]: ")

	reader := stdinBufReader
	choice, _ := reader.ReadString('\n')
	choice = strings.TrimSpace(choice)

	switch choice {
	case "1", "k3d", "":
		return r.offerInstallK3dLinux(ctx, cfg)
	case "2", "k3s":
		return r.offerInstallNativeK3s(ctx, cfg)
	default:
		return fmt.Errorf("invalid choice. Run 'volundr init' again")
	}
}

// offerInstallK3dLinux installs k3d via the install script on Linux.
func (r *K3sRuntime) offerInstallK3dLinux(ctx context.Context, cfg *config.Config) error {
	if !promptYesNo("  Install k3d? (curl install script)") {
		return fmt.Errorf("k3d is required. Install it and run 'volundr init' again")
	}
	if err := r.installK3dScript(ctx); err != nil {
		return err
	}
	return r.initK3d(ctx, cfg)
}

// installK3dScript installs k3d using the official install script.
func (r *K3sRuntime) installK3dScript(ctx context.Context) error {
	fmt.Print("  Installing k3d  ... ")
	cmd := execCommandContext(ctx, "bash", "-c",
		"curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("install k3d: %w\n%s", err, out)
	}
	fmt.Println("ok")
	return nil
}

// offerInstallNativeK3s installs k3s using the official install script.
func (r *K3sRuntime) offerInstallNativeK3s(ctx context.Context, cfg *config.Config) error {
	if !promptYesNo("  Install k3s? (requires sudo, curl install script)") {
		return fmt.Errorf("k3s is required. Install it and run 'volundr init' again")
	}

	fmt.Print("  Installing k3s  ... ")
	cmd := execCommandContext(ctx, "bash", "-c",
		"curl -sfL https://get.k3s.io | sh -",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("install k3s: %w\n%s", err, out)
	}
	fmt.Println("ok")

	return r.initNativeK3s(cfg)
}

// offerInstallHelm offers to install Helm interactively.
func (r *K3sRuntime) offerInstallHelm() error {
	ctx := context.Background()
	if runtime.GOOS == "darwin" {
		if _, err := execCommandContext(ctx, "brew", "--version").CombinedOutput(); err == nil {
			if !promptYesNo("  Install Helm via Homebrew? (brew install helm)") {
				return fmt.Errorf("helm is required. Install: https://helm.sh/docs/intro/install/")
			}
			fmt.Print("  Installing Helm ... ")
			out, err := execCommandContext(ctx, "brew", "install", "helm").CombinedOutput()
			if err != nil {
				fmt.Println("failed")
				return fmt.Errorf("brew install helm: %w\n%s", err, out)
			}
			fmt.Println("ok")
			return nil
		}
	}

	// Fallback: use the official install script.
	if !promptYesNo("  Install Helm? (official install script)") {
		return fmt.Errorf("helm is required. Install: https://helm.sh/docs/intro/install/")
	}

	fmt.Print("  Installing Helm ... ")
	cmd := execCommandContext(ctx, "bash", "-c",
		"curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("install helm: %w\n%s", err, out)
	}
	fmt.Println("ok")
	return nil
}

// ensureNamespace creates the Kubernetes namespace if it doesn't exist.
func (r *K3sRuntime) ensureNamespace(namespace string) error {
	kcPath := hostKubeconfigPath()

	// Check if namespace exists.
	if err := execCommand("kubectl", "get", "namespace", namespace, "--kubeconfig", kcPath).Run(); err == nil { //nolint:gosec // arguments from trusted internal config
		return nil
	}

	out, err := execCommand("kubectl", "create", "namespace", namespace, "--kubeconfig", kcPath).CombinedOutput() //nolint:gosec // arguments from trusted internal config
	if err != nil {
		// Ignore "already exists" errors.
		if strings.Contains(string(out), "already exists") {
			return nil
		}
		return fmt.Errorf("create namespace %s: %w\n%s", namespace, err, out)
	}

	return nil
}

// ensureK8sSecrets creates or updates the required Kubernetes secrets
// in the session namespace (anthropic-api-key, github-token).
func (r *K3sRuntime) ensureK8sSecrets(cfg *config.Config, namespace string) error {
	kcPath := r.resolveKubeconfig(cfg)

	// Create anthropic-api-key secret if API key is configured.
	if cfg.Anthropic.APIKey != "" {
		fmt.Print("  Secret: anthropic-api-key ... ")
		if err := r.upsertSecret(kcPath, namespace, "anthropic-api-key",
			map[string]string{"api-key": cfg.Anthropic.APIKey},
		); err != nil {
			fmt.Println("failed")
			return fmt.Errorf("create anthropic-api-key secret: %w", err)
		}
		fmt.Println("ok")
	}

	// Create github-token secret if a clone token is configured.
	cloneToken := cfg.Git.GitHub.CloneToken
	if cloneToken == "" && len(cfg.Git.GitHub.Instances) > 0 {
		// Fall back to the first instance's token.
		cloneToken = cfg.Git.GitHub.Instances[0].Token
	}
	if cloneToken != "" {
		fmt.Print("  Secret: github-token      ... ")
		if err := r.upsertSecret(kcPath, namespace, "github-token",
			map[string]string{"token": cloneToken},
		); err != nil {
			fmt.Println("failed")
			return fmt.Errorf("create github-token secret: %w", err)
		}
		fmt.Println("ok")
	}

	return nil
}

// upsertSecret creates or replaces a Kubernetes Opaque secret.
func (r *K3sRuntime) upsertSecret(kubeconfig, namespace, name string, data map[string]string) error {
	// Delete existing secret (ignore errors if it doesn't exist).
	_ = execCommand( //nolint:gosec // arguments from trusted internal config
		"kubectl", "delete", "secret", name,
		"--namespace", namespace,
		"--kubeconfig", kubeconfig,
		"--ignore-not-found",
	).Run()

	args := make([]string, 0, 8+len(data))
	args = append(args,
		"create", "secret", "generic", name,
		"--namespace", namespace,
		"--kubeconfig", kubeconfig,
	)
	for k, v := range data {
		args = append(args, fmt.Sprintf("--from-literal=%s=%s", k, v))
	}

	out, err := execCommand("kubectl", args...).CombinedOutput() //nolint:gosec // arguments from trusted internal config
	if err != nil {
		return fmt.Errorf("kubectl create secret: %w\n%s", err, out)
	}

	return nil
}

// ensureClusterRunning makes sure the k3s/k3d cluster is up.
func (r *K3sRuntime) ensureClusterRunning(cfg *config.Config) error {
	ctx := context.Background()
	provider := r.detectProvider(cfg)

	switch provider {
	case "k3d":
		// Check if cluster is running.
		out, err := execCommandContext(ctx, "k3d", "cluster", "list", "-o", "json").CombinedOutput()
		if err != nil {
			return fmt.Errorf("list k3d clusters: %w\n%s", err, out)
		}

		// If cluster exists but isn't running, start it.
		if strings.Contains(string(out), k3sClusterName) {
			// Try to start it (no-op if already running).
			startOut, err := execCommandContext(ctx, "k3d", "cluster", "start", k3sClusterName).CombinedOutput()
			if err != nil {
				return fmt.Errorf("start k3d cluster: %w\n%s", err, startOut)
			}
			// Refresh the host kubeconfig (port may change after restart).
			if err := r.writeHostKubeconfig(); err != nil {
				return fmt.Errorf("refresh kubeconfig: %w", err)
			}
			return nil
		}

		return fmt.Errorf("k3d cluster %q not found. Run 'volundr init' first", k3sClusterName)

	case "native":
		// Check if nodes are ready.
		out, err := execCommandContext(ctx, "kubectl", "get", "nodes", "--kubeconfig", hostKubeconfigPath()).CombinedOutput() //nolint:gosec // kubeconfig path from trusted config
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

	dbHost := cfg.Database.Host
	if cfg.Database.Mode == "embedded" {
		dbHost = "host.docker.internal"
	}

	// The API runs inside a Docker container where the kubeconfig is
	// mounted at /etc/volundr/kubeconfig (see k3sComposeTemplate).
	// Use the container path, not the host path.
	const containerKubeconfigPath = "/etc/volundr/kubeconfig"

	apiCfg := k3sAPIConfig{
		Database: map[string]interface{}{
			"host":     dbHost,
			"port":     cfg.Database.Port,
			"user":     cfg.Database.User,
			"password": cfg.Database.Password,
			"name":     cfg.Database.Name,
		},
		PodManager: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.direct_k8s_pod_manager.DirectK8sPodManager",
			"kwargs": map[string]interface{}{
				"namespace":       namespace,
				"kubeconfig":      containerKubeconfigPath,
				"base_path":       "/s",
				"ingress_class":   "traefik",
				"ingress_backend": fmt.Sprintf("k3d-%s-serverlb", k3sClusterName),
				"storage_path":    k3sNodeStoragePath,
				"skuld_image":     cfg.Docker.SkuldImage,
				"reh_image":       cfg.Docker.RehImage,
				"devrunner_image": cfg.Docker.TtydImage,
				"db_host":         "host.k3d.internal",
				"db_port":         cfg.Database.Port,
				"db_user":         cfg.Database.User,
				"db_password":     cfg.Database.Password,
				"db_name":         cfg.Database.Name,
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
				"base_dir": k3sNodeStoragePath + "/data",
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

	// Add git provider config if enabled.
	if cfg.Git.GitHub.Enabled && len(cfg.Git.GitHub.Instances) > 0 {
		apiCfg.Git = buildGitConfig(cfg)
	}

	// Pass through local_mounts config if enabled.
	if cfg.LocalMounts.Enabled {
		apiCfg.LocalMounts = map[string]interface{}{
			"enabled":           cfg.LocalMounts.Enabled,
			"allow_root_mount":  cfg.LocalMounts.AllowRootMount,
			"allowed_prefixes":  cfg.LocalMounts.AllowedPrefixes,
			"default_read_only": cfg.LocalMounts.DefaultReadOnly,
		}
	}

	// Wire up resource provider — use K8sResourceProvider for real cluster data.
	apiCfg.ResourceProvider = map[string]interface{}{
		"adapter": "volundr.adapters.outbound.k8s_resource_provider.K8sResourceProvider",
		"kwargs": map[string]interface{}{
			"namespace":  namespace,
			"kubeconfig": containerKubeconfigPath,
		},
	}

	// Wire up session contributors.
	// LocalMountContributor is auto-wired by Python main.py from local_mounts config.
	apiCfg.SessionContributors = []map[string]interface{}{
		{"adapter": "volundr.adapters.outbound.contributors.storage.StorageContributor"},
		{"adapter": "volundr.adapters.outbound.contributors.git.GitContributor"},
		{"adapter": "volundr.adapters.outbound.contributors.resource.ResourceContributor"},
	}

	data, err := yaml.Marshal(&apiCfg)
	if err != nil {
		return "", fmt.Errorf("marshal k3s config: %w", err)
	}

	configPath := filepath.Join(cfgDir, k3sConfigFileName)
	if err := os.WriteFile(configPath, data, 0o644); err != nil { //nolint:gosec // config must be readable by container user
		return "", fmt.Errorf("write k3s config: %w", err)
	}

	return configPath, nil
}

// startAPIContainer starts the Python API in a Docker container
// connected to the k3d network so it can reach the cluster.
func (r *K3sRuntime) startAPIContainer(_ context.Context, cfg *config.Config) error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	// Resolve kubeconfig — for k3d we need the internal k3d kubeconfig
	// that uses the Docker network DNS name instead of localhost.
	kubeconfigPath, err := r.writeK3dKubeconfig(cfgDir)
	if err != nil {
		return fmt.Errorf("write k3d kubeconfig: %w", err)
	}

	dbHost := cfg.Database.Host
	if cfg.Database.Mode == "embedded" {
		dbHost = "host.docker.internal"
	}

	data := k3sComposeData{
		APIImage:        dockerImageOrDefault(cfg.Docker.APIImage, "ghcr.io/niuulabs/volundr:latest"),
		ContainerName:   k3sContainerName,
		APIPort:         k3sAPIInternalPort,
		DBHost:          dbHost,
		DBPort:          cfg.Database.Port,
		DBUser:          cfg.Database.User,
		DBPassword:      cfg.Database.Password,
		DBName:          cfg.Database.Name,
		AnthropicAPIKey: cfg.Anthropic.APIKey,
		ConfigPath:      filepath.Join(cfgDir, k3sConfigFileName),
		KubeconfigPath:  kubeconfigPath,
		StorageDir:      cfgDir,
		ClusterName:     k3sClusterName,
	}

	// On Linux, host.docker.internal doesn't resolve by default
	// (Docker Desktop feature only). Add extra_hosts mapping.
	if runtime.GOOS == "linux" {
		data.ExtraHosts = []string{"host.docker.internal:host-gateway"}
	}

	var buf bytes.Buffer
	if err := k3sComposeTemplate.Execute(&buf, data); err != nil {
		return fmt.Errorf("render compose template: %w", err)
	}

	composePath := filepath.Join(cfgDir, k3sComposeFileName)
	if err := os.WriteFile(composePath, buf.Bytes(), 0o644); err != nil { //nolint:gosec // compose file must be readable by container user
		return fmt.Errorf("write compose file: %w", err)
	}

	// Start the container.
	out, err := execCommand( //nolint:gosec // arguments from trusted internal config
		"docker", "compose",
		"-f", composePath,
		"-p", "volundr-k3s",
		"up", "-d",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker compose up: %w\n%s", err, out)
	}

	return nil
}

// writeHostKubeconfig fetches the k3d kubeconfig and writes it to the
// volundr config directory for use by kubectl/helm on the host.
// This avoids touching ~/.kube/config.
func (r *K3sRuntime) writeHostKubeconfig() error {
	out, err := execCommandContext(context.Background(),
		"k3d", "kubeconfig", "get", k3sClusterName,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("get k3d kubeconfig: %w\n%s", err, out)
	}

	kcPath := hostKubeconfigPath()
	if err := os.WriteFile(kcPath, out, 0o644); err != nil { //nolint:gosec // kubeconfig must be readable by container user
		return fmt.Errorf("write kubeconfig to %s: %w", kcPath, err)
	}
	fmt.Printf("  Kubeconfig     ... %s\n", kcPath)

	return nil
}

// writeK3dKubeconfig writes a kubeconfig suitable for use inside a Docker
// container on the k3d network. The API server address is rewritten to
// use the k3d server container name instead of localhost.
func (r *K3sRuntime) writeK3dKubeconfig(cfgDir string) (string, error) {
	// Read the host kubeconfig (already written during init or refreshed).
	kcPath := hostKubeconfigPath()
	data, err := os.ReadFile(kcPath) //nolint:gosec // path from trusted kubeconfig location
	if err != nil {
		// Fall back to fetching from k3d directly.
		out, fetchErr := execCommandContext(context.Background(),
			"k3d", "kubeconfig", "get", k3sClusterName,
		).CombinedOutput()
		if fetchErr != nil {
			return "", fmt.Errorf("get k3d kubeconfig: %w\n%s", fetchErr, out)
		}
		data = out
	}

	// The k3d kubeconfig points to localhost:<random-port>.
	// Replace with the k3d server container's Docker DNS name
	// so it works from inside the k3d Docker network.
	kubeconfig := string(data)
	// k3d server container is named k3d-<cluster>-server-0
	// and listens on port 6443 internally.
	serverDNS := fmt.Sprintf("https://k3d-%s-server-0:6443", k3sClusterName)
	// Replace any https://0.0.0.0:<port> or https://127.0.0.1:<port>
	// or https://localhost:<port> references.
	for _, prefix := range []string{
		"https://0.0.0.0:", "https://127.0.0.1:", "https://localhost:",
	} {
		idx := strings.Index(kubeconfig, prefix)
		if idx < 0 {
			continue
		}
		end := strings.Index(kubeconfig[idx+len(prefix):], "\n")
		if end < 0 {
			end = len(kubeconfig[idx+len(prefix):])
		}
		old := kubeconfig[idx : idx+len(prefix)+end]
		kubeconfig = strings.Replace(kubeconfig, old, serverDNS, 1)
		break
	}

	kubeconfigPath := filepath.Join(cfgDir, k3sDockerKubeconfigFile)                //nolint:gosec // path derived from trusted config directory
	if err := os.WriteFile(kubeconfigPath, []byte(kubeconfig), 0o644); err != nil { //nolint:gosec // kubeconfig must be readable by container user
		return "", fmt.Errorf("write docker kubeconfig: %w", err)
	}

	return kubeconfigPath, nil
}

// writeStateFile writes the service status to the state file.
func (r *K3sRuntime) writeStateFile(cfg *config.Config) error {
	services := []ServiceStatus{
		{Name: "proxy", State: StateRunning, Port: cfg.Listen.Port},
		{Name: "api", State: StateRunning, Port: k3sAPIInternalPort},
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

	out, err := execCommandContext(context.Background(), //nolint:gosec // arguments from trusted internal config
		"kubectl", "get", "pods",
		"--namespace", namespace,
		"--kubeconfig", hostKubeconfigPath(),
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

// hostKubeconfigPath returns the path to the volundr-managed kubeconfig
// in the config directory. This is used for all kubectl/helm commands
// so we never touch ~/.kube/config.
func hostKubeconfigPath() string {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(cfgDir, k3sHostKubeconfigFile)
}

// resolveKubeconfig returns the kubeconfig path from config or the
// volundr-managed kubeconfig in ~/.volundr/.
func (r *K3sRuntime) resolveKubeconfig(cfg *config.Config) string {
	if cfg.K3s.Kubeconfig != "" {
		return cfg.K3s.Kubeconfig
	}

	// Default to the volundr-managed kubeconfig.
	return hostKubeconfigPath()
}
