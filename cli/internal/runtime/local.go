package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/migrations"
	"github.com/niuulabs/volundr/cli/internal/proxy"
)

const (
	// APIStartTimeout is the maximum time to wait for the API to start.
	APIStartTimeout = 30 * time.Second
	// APIHealthCheckInterval is the interval between API health checks.
	APIHealthCheckInterval = 500 * time.Millisecond
)

// LocalRuntime manages the Volundr stack as local processes.
type LocalRuntime struct {
	pg       postgresProvider
	apiCmd   *exec.Cmd
	proxyRtr *proxy.Router
}

// NewLocalRuntime creates a new LocalRuntime.
func NewLocalRuntime() *LocalRuntime {
	return &LocalRuntime{}
}

// Init performs first-time setup for local runtime.
func (r *LocalRuntime) Init(ctx context.Context, cfg *config.Config) error {
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

	// Test that embedded postgres can start if in embedded mode.
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

// Up starts all services in local mode.
func (r *LocalRuntime) Up(ctx context.Context, cfg *config.Config) error {
	// Check for an already-running instance.
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

	// Start the Python API.
	fmt.Print("  Volundr API   ... ")
	apiPort := cfg.Listen.Port + 1 // API on internal port, proxy on listen port
	if err := r.startAPI(ctx, cfg, apiPort); err != nil {
		fmt.Println("failed")
		return fmt.Errorf("start API: %w", err)
	}
	fmt.Printf("started (port %d)\n", apiPort)

	// Start the reverse proxy.
	fmt.Print("  Proxy         ... ")
	apiURL := fmt.Sprintf("http://127.0.0.1:%d", apiPort)
	rtr, err := proxy.NewRouter(apiURL)
	if err != nil {
		fmt.Println("failed")
		return fmt.Errorf("create proxy: %w", err)
	}
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
func (r *LocalRuntime) Down(_ context.Context) error {
	var errs []string

	// Stop API process.
	if r.apiCmd != nil && r.apiCmd.Process != nil {
		if err := r.apiCmd.Process.Signal(syscall.SIGTERM); err != nil {
			errs = append(errs, fmt.Sprintf("stop API: %v", err))
		}
		// Wait a short time for graceful shutdown.
		done := make(chan error, 1)
		go func() { done <- r.apiCmd.Wait() }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			_ = r.apiCmd.Process.Kill()
		}
	}

	// Stop embedded PostgreSQL.
	if r.pg != nil {
		if err := r.pg.Stop(); err != nil {
			errs = append(errs, fmt.Sprintf("stop postgres: %v", err))
		}
	}

	// Remove PID file.
	_ = RemovePIDFile()
	_ = RemoveStateFile()

	if len(errs) > 0 {
		return fmt.Errorf("errors during shutdown: %s", strings.Join(errs, "; "))
	}

	return nil
}

// DownFromPID stops a running instance using the PID file.
func DownFromPID() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	pidPath := filepath.Join(cfgDir, PIDFile)
	data, err := os.ReadFile(pidPath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("no running instance found (no PID file)")
		}
		return fmt.Errorf("read PID file: %w", err)
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return fmt.Errorf("parse PID file: %w", err)
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return fmt.Errorf("find process %d: %w", pid, err)
	}

	if err := proc.Signal(syscall.SIGTERM); err != nil {
		// Process may already be dead.
		_ = os.Remove(pidPath)
		return fmt.Errorf("send SIGTERM to process %d: %w", pid, err)
	}

	// Wait for process to exit.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 50; i++ {
			if err := proc.Signal(syscall.Signal(0)); err != nil {
				close(done)
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		close(done)
	}()
	<-done

	_ = os.Remove(pidPath)

	// Clean up state file.
	stateFilePath := filepath.Join(cfgDir, StateFile)
	_ = os.Remove(stateFilePath)

	return nil
}

// Status returns the state of each service.
func (r *LocalRuntime) Status(_ context.Context) (*StackStatus, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return nil, fmt.Errorf("get config dir: %w", err)
	}

	status := &StackStatus{
		Runtime: "local",
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

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning},
		}
		return status, nil //nolint:nilerr // return partial status when state file is corrupt
	}

	status.Services = services
	return status, nil
}

// Logs streams logs for a service.
func (r *LocalRuntime) Logs(_ context.Context, service string, _ bool) (io.ReadCloser, error) {
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

// StatusFromStateFile reads status from the persisted state file.
func StatusFromStateFile() (*StackStatus, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return nil, fmt.Errorf("get config dir: %w", err)
	}

	status := &StackStatus{
		Runtime: "local",
	}

	pidPath := filepath.Join(cfgDir, PIDFile)
	pidData, err := os.ReadFile(pidPath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		if os.IsNotExist(err) {
			status.Services = []ServiceStatus{
				{Name: "volundr", State: StateStopped},
			}
			return status, nil
		}
		return nil, fmt.Errorf("read PID file: %w", err)
	}

	// Verify the process is actually running.
	pid, err := strconv.Atoi(strings.TrimSpace(string(pidData)))
	if err == nil {
		proc, findErr := os.FindProcess(pid)
		if findErr == nil {
			if sigErr := proc.Signal(syscall.Signal(0)); sigErr != nil {
				// Process is dead, clean up.
				_ = os.Remove(pidPath)
				status.Services = []ServiceStatus{
					{Name: "volundr", State: StateStopped},
				}
				return status, nil //nolint:nilerr // signal failure means process is dead, report stopped status
			}
		}
	}

	stateFilePath := filepath.Join(cfgDir, StateFile)
	data, err := os.ReadFile(stateFilePath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning, PID: pid},
		}
		return status, nil //nolint:nilerr // return partial status when state file is missing
	}

	var services []ServiceStatus
	if err := json.Unmarshal(data, &services); err != nil {
		status.Services = []ServiceStatus{
			{Name: "volundr", State: StateRunning, PID: pid},
		}
		return status, nil //nolint:nilerr // return partial status when state file is corrupt
	}

	status.Services = services
	return status, nil
}

// RichStatus returns detailed status including session info for local runtime.
func (r *LocalRuntime) RichStatus(ctx context.Context, cfg *config.Config) (*RichStatus, error) {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return nil, fmt.Errorf("get config dir: %w", err)
	}

	rs := &RichStatus{
		Mode: "local",
	}

	// Check if server is running via PID file.
	pid, running := checkPIDFile(cfgDir)
	if !running {
		rs.Server = ComponentStatus{Status: "stopped"}
		rs.Database = ComponentStatus{Status: "stopped"}
		rs.Sessions = SessionSummary{Max: effectiveMaxSessions(cfg.Sessions.MaxSessions)}
		return rs, nil
	}

	listenAddr := fmt.Sprintf("%s:%d", cfg.Listen.Host, cfg.Listen.Port)
	rs.Server = ComponentStatus{
		Status:  "running",
		Address: listenAddr,
		PID:     pid,
	}
	rs.WebUI = fmt.Sprintf("http://%s", listenAddr)

	// Database status.
	rs.Database = databaseStatus(cfg)

	// Fetch sessions from the API.
	rs.Sessions = buildSessionSummary(ctx, listenAddr, cfg.Sessions.MaxSessions)

	return rs, nil
}

func (r *LocalRuntime) startAPI(ctx context.Context, cfg *config.Config, port int) error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	logFile, err := os.OpenFile( //nolint:gosec // path derived from trusted config directory
		filepath.Join(cfgDir, "logs", "api.log"),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND,
		0o600,
	)
	if err != nil {
		return fmt.Errorf("open API log file: %w", err)
	}

	r.apiCmd = execCommandContext(ctx, //nolint:gosec // port is an integer from trusted config
		"python3", "-m", "uvicorn",
		"volundr.main:app",
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
	)

	r.apiCmd.Stdout = logFile
	r.apiCmd.Stderr = logFile

	// Set environment variables.
	r.apiCmd.Env = append(os.Environ(),
		"DATABASE__HOST=127.0.0.1",
		fmt.Sprintf("DATABASE__PORT=%d", cfg.Database.Port),
		fmt.Sprintf("DATABASE__USER=%s", cfg.Database.User),
		fmt.Sprintf("DATABASE__PASSWORD=%s", cfg.Database.Password),
		fmt.Sprintf("DATABASE__NAME=%s", cfg.Database.Name),
	)

	if cfg.Anthropic.APIKey != "" {
		r.apiCmd.Env = append(r.apiCmd.Env,
			fmt.Sprintf("ANTHROPIC_API_KEY=%s", cfg.Anthropic.APIKey),
		)
	}

	if err := r.apiCmd.Start(); err != nil {
		_ = logFile.Close()
		return fmt.Errorf("start uvicorn: %w", err)
	}

	return nil
}

func (r *LocalRuntime) writeStateFile(cfg *config.Config) error {
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

	return WriteStateFile(services)
}

// findMigrationsDir looks for the migrations directory relative to the binary.
func findMigrationsDir() string {
	// Try relative to working directory.
	candidates := []string{
		"migrations",
		"../migrations",
		"../../migrations",
	}

	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && info.IsDir() {
			abs, err := filepath.Abs(c)
			if err != nil {
				continue
			}
			return abs
		}
	}

	return ""
}

// runMigrationsAuto runs migrations using embedded SQL files if available,
// falling back to the filesystem. Returns (applied, source, error).
func runMigrationsAuto(ctx context.Context, pg postgresProvider) (applied int, source string, err error) {
	// Try embedded migrations first.
	if mfs := migrations.FS(); mfs != nil {
		applied, err := pg.RunMigrationsFS(ctx, mfs)
		return applied, "embedded", err
	}

	// Fall back to filesystem.
	dir := findMigrationsDir()
	if dir == "" {
		return 0, "", nil
	}
	applied, err = pg.RunMigrations(ctx, dir)
	return applied, dir, err
}
