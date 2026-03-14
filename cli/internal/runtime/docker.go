package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/proxy"
	"gopkg.in/yaml.v3"
)

const (
	// Docker Compose project name.
	dockerProject = "volundr"
	// Generated compose file name.
	composeFileName = "docker-compose.volundr.yaml"
	// Generated API config file name.
	dockerConfigFileName = "docker-config.yaml"
	// Mount point for storage inside the API container.
	containerStoragePath = "/volundr-storage"
)

// composeTemplate is the Docker Compose template for the API service.
var composeTemplate = template.Must(template.New("compose").Parse(`services:
  api:
    image: {{.APIImage}}
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
    volumes:
      - "{{.ConfigPath}}:/etc/volundr/config.yaml:ro"
      - "{{.StorageDir}}:/volundr-storage"
      - "/var/run/docker.sock:/var/run/docker.sock"
    networks:
      - volundr-net

networks:
  volundr-net:
    external: true
`))

// composeData holds the template data for the compose file.
type composeData struct {
	APIImage        string
	APIPort         int
	DBHost          string
	DBPort          int
	DBUser          string
	DBPassword      string
	DBName          string
	AnthropicAPIKey string
	ConfigPath      string
	StorageDir      string
}

// dockerAPIConfig represents the Python API config file structure for Docker mode.
type dockerAPIConfig struct {
	Database            map[string]interface{}   `yaml:"database"`
	PodManager          map[string]interface{}   `yaml:"pod_manager"`
	CredentialStore     map[string]interface{}   `yaml:"credential_store"`
	Storage             map[string]interface{}   `yaml:"storage"`
	SecretInjection     map[string]interface{}   `yaml:"secret_injection"`
	Git                 map[string]interface{}   `yaml:"git,omitempty"`
	Identity            map[string]interface{}   `yaml:"identity"`
	Authorization       map[string]interface{}   `yaml:"authorization"`
	Gateway             map[string]interface{}   `yaml:"gateway"`
	ResourceProvider    map[string]interface{}   `yaml:"resource_provider,omitempty"`
	LocalMounts         map[string]interface{}   `yaml:"local_mounts,omitempty"`
	SessionContributors []map[string]interface{} `yaml:"session_contributors,omitempty"`
}

// dockerAPIInternalPort is the host port the API container binds to.
// The Go reverse proxy listens on the user-configured port and forwards
// /api/* here, while serving the embedded web UI at /.
const dockerAPIInternalPort = 18080

// DockerRuntime manages the Volundr stack using Docker containers.
type DockerRuntime struct {
	pg       postgresProvider
	proxyRtr *proxy.Router
}

// NewDockerRuntime creates a new DockerRuntime.
func NewDockerRuntime() *DockerRuntime {
	return &DockerRuntime{}
}

// Init verifies Docker is available and pulls required images.
func (r *DockerRuntime) Init(ctx context.Context, cfg *config.Config) error {
	// Verify docker CLI is available.
	if out, err := execCommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}").CombinedOutput(); err != nil {
		return fmt.Errorf("docker is not available: %w\n%s", err, out)
	}

	// Verify docker compose is available.
	if out, err := execCommandContext(ctx, "docker", "compose", "version", "--short").CombinedOutput(); err != nil {
		return fmt.Errorf("docker compose is not available: %w\n%s", err, out)
	}

	// Ensure required images are available (pull if not present locally).
	apiImage := dockerImageOrDefault(cfg.Docker.APIImage, "ghcr.io/niuulabs/volundr-api:latest")
	if err := ensureImage(apiImage); err != nil {
		return err
	}

	return nil
}

// Up starts all services in Docker mode.
func (r *DockerRuntime) Up(ctx context.Context, cfg *config.Config) error {
	if err := CheckNotRunning(); err != nil {
		return err
	}

	// Start embedded PostgreSQL on the host if configured.
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

	// Create the Docker network if it doesn't exist.
	network := dockerImageOrDefault(cfg.Docker.Network, "volundr-net")
	fmt.Print("  Docker network ... ")
	if err := r.ensureNetwork(network); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create docker network: %w", err)
	}
	fmt.Println("ok")

	// Generate Docker-mode config for the API container.
	fmt.Print("  API config    ... ")
	if _, err := r.generateDockerConfig(cfg); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("generate docker config: %w", err)
	}
	fmt.Println("ok")

	// Generate and write the compose file.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	composePath := filepath.Join(cfgDir, composeFileName)
	data := r.buildComposeData(cfg)

	composeContent, err := renderComposeTemplate(&data)
	if err != nil {
		return fmt.Errorf("render compose template: %w", err)
	}

	if err := os.WriteFile(composePath, []byte(composeContent), 0o600); err != nil {
		return fmt.Errorf("write compose file: %w", err)
	}

	// Start the API container via docker compose.
	fmt.Print("  Volundr API   ... ")
	out, err := execCommandContext(ctx, //nolint:gosec // arguments from trusted internal config
		"docker", "compose",
		"-f", composePath,
		"-p", dockerProject,
		"up", "-d",
	).CombinedOutput()
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("docker compose up: %w\n%s", err, out)
	}
	fmt.Printf("started (port %d)\n", dockerAPIInternalPort)

	// Start the reverse proxy (serves embedded web UI + proxies /api/*).
	fmt.Print("  Proxy         ... ")
	apiURL := fmt.Sprintf("http://127.0.0.1:%d", dockerAPIInternalPort)
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
	services := r.buildServiceStatuses(cfg)
	if err := WriteStateFile(services); err != nil {
		return fmt.Errorf("write state file: %w", err)
	}

	return nil
}

// Down stops all Docker services and cleans up.
func (r *DockerRuntime) Down(ctx context.Context) error {
	var errs []string

	// Stop containers via docker compose.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		errs = append(errs, fmt.Sprintf("get config dir: %v", err))
	} else {
		composePath := filepath.Join(cfgDir, composeFileName)
		if _, statErr := os.Stat(composePath); statErr == nil {
			if out, err := execCommandContext(ctx, //nolint:gosec // arguments are from trusted internal config
				"docker", "compose",
				"-f", composePath,
				"-p", dockerProject,
				"down",
			).CombinedOutput(); err != nil {
				errs = append(errs, fmt.Sprintf("docker compose down: %v\n%s", err, out))
			}
			_ = os.Remove(composePath)
		} else {
			// Fallback: try project-only down.
			if out, err := execCommandContext(ctx,
				"docker", "compose",
				"-p", dockerProject,
				"down",
			).CombinedOutput(); err != nil {
				errs = append(errs, fmt.Sprintf("docker compose down: %v\n%s", err, out))
			}
		}
	}

	// Remove the Docker network.
	// Try to load config for network name; fall back to default.
	networkName := "volundr-net"
	if loadedCfg, loadErr := config.Load(); loadErr == nil && loadedCfg.Docker.Network != "" {
		networkName = loadedCfg.Docker.Network
	}
	if out, err := execCommandContext(ctx, "docker", "network", "rm", networkName).CombinedOutput(); err != nil {
		// Ignore errors if network doesn't exist.
		if !strings.Contains(string(out), "not found") {
			errs = append(errs, fmt.Sprintf("remove docker network: %v", err))
		}
	}

	// Stop embedded PostgreSQL if running.
	if r.pg != nil {
		if err := r.pg.Stop(); err != nil {
			errs = append(errs, fmt.Sprintf("stop postgres: %v", err))
		}
	}

	// Clean up PID and state files.
	_ = RemovePIDFile()
	_ = RemoveStateFile()

	if len(errs) > 0 {
		return fmt.Errorf("errors during shutdown: %s", strings.Join(errs, "; "))
	}

	return nil
}

// Status returns the state of each service by inspecting Docker containers.
func (r *DockerRuntime) Status(ctx context.Context) (*StackStatus, error) {
	status := &StackStatus{
		Runtime: "docker",
	}

	// Inspect the API container.
	out, err := execCommandContext(ctx,
		"docker", "inspect",
		"--format", "{{.State.Status}}",
		dockerProject+"-api-1",
	).CombinedOutput()
	if err != nil {
		status.Services = []ServiceStatus{
			{Name: "api", State: StateStopped},
		}
		return status, nil //nolint:nilerr // container not found means service is stopped
	}

	containerState := strings.TrimSpace(string(out))
	apiStatus := ServiceStatus{
		Name:  "api",
		State: mapContainerState(containerState),
	}
	status.Services = []ServiceStatus{apiStatus}

	// If we have a state file, merge in additional services (e.g. postgres).
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return status, nil //nolint:nilerr // return partial status when config dir is unavailable
	}

	stateFilePath := filepath.Join(cfgDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		return status, nil //nolint:nilerr // return partial status when state file is missing
	}

	var savedServices []ServiceStatus
	if err := json.Unmarshal(data, &savedServices); err != nil {
		return status, nil //nolint:nilerr // return partial status when state file is corrupt
	}

	// Add non-api services from state file (e.g. postgres).
	for _, svc := range savedServices {
		if svc.Name != "api" {
			status.Services = append(status.Services, svc)
		}
	}

	return status, nil
}

// Logs streams logs for a Docker service.
func (r *DockerRuntime) Logs(ctx context.Context, service string, follow bool) (io.ReadCloser, error) {
	args := []string{"logs"}
	if follow {
		args = append(args, "-f")
	}
	args = append(args, dockerProject+"-"+service+"-1")

	cmd := execCommandContext(ctx, "docker", args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("get stdout pipe: %w", err)
	}

	cmd.Stderr = cmd.Stdout // merge stderr into stdout

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start docker logs: %w", err)
	}

	return &cmdReadCloser{cmd: cmd, ReadCloser: stdout}, nil
}

// cmdReadCloser wraps a ReadCloser and waits for the command to finish on Close.
type cmdReadCloser struct {
	cmd *exec.Cmd
	io.ReadCloser
}

func (c *cmdReadCloser) Close() error {
	err := c.ReadCloser.Close()
	_ = c.cmd.Wait()
	return err
}

// ensureNetwork creates the Docker network if it doesn't already exist.
func (r *DockerRuntime) ensureNetwork(network string) error {
	ctx := context.Background()
	// Check if network exists.
	if err := execCommandContext(ctx, "docker", "network", "inspect", network).Run(); err == nil { //nolint:gosec // network name from trusted config
		return nil
	}

	// Create the network.
	out, err := execCommandContext(ctx, "docker", "network", "create", network).CombinedOutput() //nolint:gosec // network name from trusted config
	if err != nil {
		return fmt.Errorf("create network %s: %w\n%s", network, err, out)
	}
	return nil
}

// ensureImage checks if a Docker image exists locally, and pulls it if not.
func ensureImage(image string) error {
	// Check if image exists locally.
	if err := execCommandContext(context.Background(), "docker", "image", "inspect", image).Run(); err == nil { //nolint:gosec // image name from trusted config
		fmt.Printf("  %s ... ok (local)\n", image)
		return nil
	}

	fmt.Printf("  Pulling %s ...\n", image)
	if out, err := execCommandContext(context.Background(), "docker", "pull", image).CombinedOutput(); err != nil { //nolint:gosec // image name from trusted config
		return fmt.Errorf("pull image %s: %w\n%s", image, err, out)
	}
	fmt.Printf("  %s ... ok\n", image)
	return nil
}

// dockerImageOrDefault returns the image if non-empty, otherwise the default.
func dockerImageOrDefault(image, defaultImage string) string {
	if image != "" {
		return image
	}
	return defaultImage
}

// buildComposeData creates template data from config.
func (r *DockerRuntime) buildComposeData(cfg *config.Config) composeData {
	dbHost := cfg.Database.Host
	if cfg.Database.Mode == "embedded" {
		dbHost = "host.docker.internal"
	}

	cfgDir, _ := config.ConfigDir()

	return composeData{
		APIImage:        dockerImageOrDefault(cfg.Docker.APIImage, "ghcr.io/niuulabs/volundr-api:latest"),
		APIPort:         dockerAPIInternalPort,
		DBHost:          dbHost,
		DBPort:          cfg.Database.Port,
		DBUser:          cfg.Database.User,
		DBPassword:      cfg.Database.Password,
		DBName:          cfg.Database.Name,
		AnthropicAPIKey: cfg.Anthropic.APIKey,
		ConfigPath:      filepath.Join(cfgDir, dockerConfigFileName),
		StorageDir:      cfgDir,
	}
}

// generateDockerConfig creates a config.yaml for the Python API in Docker mode.
// It returns the path to the generated file.
func (r *DockerRuntime) generateDockerConfig(cfg *config.Config) (string, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return "", fmt.Errorf("get config dir: %w", err)
	}

	dbHost := cfg.Database.Host
	if cfg.Database.Mode == "embedded" {
		dbHost = "host.docker.internal"
	}

	apiCfg := dockerAPIConfig{
		Database: map[string]interface{}{
			"host":     dbHost,
			"port":     cfg.Database.Port,
			"user":     cfg.Database.User,
			"password": cfg.Database.Password,
			"name":     cfg.Database.Name,
		},
		PodManager: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.docker_pod_manager.DockerPodManager",
			"kwargs": map[string]interface{}{
				"network":           dockerImageOrDefault(cfg.Docker.Network, "volundr-net"),
				"skuld_image":       dockerImageOrDefault(cfg.Docker.SkuldImage, "ghcr.io/niuulabs/skuld:latest"),
				"code_server_image": dockerImageOrDefault(cfg.Docker.CodeServerImage, "ghcr.io/niuulabs/code-server:latest"),
				"ttyd_image":        dockerImageOrDefault(cfg.Docker.TtydImage, "ghcr.io/niuulabs/ttyd:latest"),
				"compose_dir":       containerStoragePath + "/sessions",
				"gateway_domain":    "",
				"db_host":           dbHost,
				"db_port":           cfg.Database.Port,
				"db_user":           cfg.Database.User,
				"db_password":       cfg.Database.Password,
				"db_name":           cfg.Database.Name,
			},
		},
		CredentialStore: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.file_credential_store.FileCredentialStore",
			"kwargs": map[string]interface{}{
				"base_dir": containerStoragePath + "/user-credentials",
			},
		},
		Storage: map[string]interface{}{
			"adapter": "volundr.adapters.outbound.local_storage_adapter.LocalStorageAdapter",
			"kwargs": map[string]interface{}{
				"base_dir": containerStoragePath,
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

	// Wire up resource provider (static defaults for local dev).
	apiCfg.ResourceProvider = map[string]interface{}{
		"adapter": "volundr.adapters.outbound.static_resource_provider.StaticResourceProvider",
	}

	// Wire up session contributors.
	// LocalMountContributor is auto-wired by Python main.py from local_mounts config.
	apiCfg.SessionContributors = []map[string]interface{}{
		{"adapter": "volundr.adapters.outbound.contributors.git.GitContributor"},
		{"adapter": "volundr.adapters.outbound.contributors.resource.ResourceContributor"},
	}

	data, err := yaml.Marshal(&apiCfg)
	if err != nil {
		return "", fmt.Errorf("marshal docker config: %w", err)
	}

	configPath := filepath.Join(cfgDir, dockerConfigFileName)
	if err := os.WriteFile(configPath, data, 0o600); err != nil {
		return "", fmt.Errorf("write docker config: %w", err)
	}

	return configPath, nil
}

// buildServiceStatuses creates the service status list for the state file.
func (r *DockerRuntime) buildServiceStatuses(cfg *config.Config) []ServiceStatus {
	services := []ServiceStatus{
		{Name: "api", State: StateRunning, Port: cfg.Listen.Port},
	}

	if cfg.Database.Mode == "embedded" {
		services = append(services, ServiceStatus{
			Name:  "postgres",
			State: StateRunning,
			Port:  cfg.Database.Port,
		})
	}

	return services
}

// renderComposeTemplate renders the compose template with the given data.
func renderComposeTemplate(data *composeData) (string, error) {
	var buf bytes.Buffer
	if err := composeTemplate.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// mapContainerState maps a Docker container state string to a ServiceState.
func mapContainerState(dockerState string) ServiceState {
	switch dockerState {
	case "running":
		return StateRunning
	case "created", "restarting":
		return StateStarting
	case "exited", "dead", "removing":
		return StateStopped
	default:
		return StateError
	}
}
