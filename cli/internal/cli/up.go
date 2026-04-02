package cli

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/forge"
	"github.com/niuulabs/volundr/cli/internal/preflight"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var (
	modeFlag string
	noWeb    bool
)

var upCmd = &cobra.Command{
	Use:   "up",
	Short: "Start the Volundr stack",
	Long: `Starts Volundr in the configured mode.

Modes:
  mini   Lightweight session runner (Forge). No Python, no Kubernetes.
         Manages Claude Code sessions as local processes on macOS.
  k3s    Full Volundr stack on k3s/k3d with PostgreSQL and all services.

Example:
  niuu volundr up                # Start with configured mode (default: mini)
  niuu volundr up --mode mini    # Start in mini mode (Forge)
  niuu volundr up --mode k3s     # Start full k3s stack
  niuu volundr up --no-web       # Mini mode without web UI`,
	RunE: runUp,
}

func init() {
	upCmd.Flags().StringVar(&modeFlag, "mode", "", "Override mode (mini, k3s)")
	upCmd.Flags().BoolVar(&noWeb, "no-web", false, "Skip web UI (mini mode only)")
}

func runUp(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config (run 'niuu volundr init' first): %w", err)
	}

	if modeFlag != "" {
		cfg.Volundr.Mode = modeFlag
	}
	if noWeb {
		cfg.Volundr.Web = false
	}

	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	// Load credentials and inject API key into config if available.
	machineKey := machinePassphrase()
	creds, err := config.LoadCredentials(machineKey)
	if err != nil {
		legacyKey := legacyMachinePassphrase()
		creds, err = config.LoadCredentials(legacyKey)
		if err == nil {
			fmt.Println("Warning: credentials were encrypted with the legacy passphrase.")
			fmt.Println("Run 'niuu volundr init' to re-encrypt with the new key.")
		}
	}
	if err == nil && creds.AnthropicAPIKey != "" && cfg.Anthropic.APIKey == "" {
		cfg.Anthropic.APIKey = creds.AnthropicAPIKey
	}

	switch cfg.Volundr.Mode {
	case "mini":
		return runMiniMode(cfg)
	case "k3s":
		return runK3sMode(cfg)
	default:
		return fmt.Errorf("unknown mode %q", cfg.Volundr.Mode)
	}
}

func runMiniMode(cfg *config.Config) error {
	if err := runUpPreflightChecks(cfg); err != nil {
		return err
	}

	forgeCfg, err := buildForgeConfig(cfg)
	if err != nil {
		return fmt.Errorf("build forge config: %w", err)
	}

	srv, err := forge.NewServer(forgeCfg)
	if err != nil {
		return err
	}

	fmt.Printf("\nStarting Volundr (mode: mini)...\n")
	return srv.Run(context.Background())
}

// runUpPreflightChecks validates mini-mode prerequisites before starting.
// Returns an error for hard failures; prints warnings for soft issues.
func runUpPreflightChecks(cfg *config.Config) error {
	claudeBin := claudeBinaryName(cfg)

	// Hard failure: claude binary must be available.
	cr := preflight.CheckBinary(claudeBin)
	if !cr.OK {
		return fmt.Errorf("%s\n\n%s", cr.Message, installInstructions("claude"))
	}

	// Hard failure: listen port must be available.
	fs := cfg.Volundr.Forge
	host, portStr, err := net.SplitHostPort(fs.Listen)
	if err != nil {
		return fmt.Errorf("invalid forge listen address %q: %w", fs.Listen, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return fmt.Errorf("invalid forge listen port %q: %w", portStr, err)
	}
	pr := preflight.CheckPortAvailable(host, port)
	if !pr.OK {
		return fmt.Errorf("%s\n\nAnother process is using this port.\nEither stop that process or change the port in ~/.niuu/config.yaml:\n  volundr:\n    forge:\n      listen: \"%s:%d\"",
			pr.Message, host, port+1)
	}

	// Hard failure: workspace directory must be writable.
	workspace := expandHome(fs.Workspace)
	dr := preflight.CheckDirWritable(workspace)
	if !dr.OK {
		return fmt.Errorf("%s\n\nEnsure the directory exists and is writable, or change it in ~/.niuu/config.yaml:\n  volundr:\n    forge:\n      workspace: /path/to/workspaces",
			dr.Message)
	}

	// Soft warning: API key.
	ar := preflight.CheckAPIKeySet(cfg.Anthropic.APIKey)
	if !ar.OK {
		fmt.Printf("Warning: %s\n", ar.Message)
		fmt.Println("  Set it via 'niuu volundr init' or the ANTHROPIC_API_KEY environment variable.")
		fmt.Println()
	}

	return nil
}

func runK3sMode(cfg *config.Config) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("\nStarting Volundr (mode: k3s)...\n")

	rt := runtime.NewRuntime("k3s")

	if err := rt.Up(ctx, cfg); err != nil {
		_ = rt.Down(ctx)
		return err
	}

	scheme := "http"
	if cfg.TLS.Mode != "off" {
		scheme = "https"
	}
	fmt.Printf("\nVolundr is running at %s://%s:%d\n", scheme, cfg.Listen.Host, cfg.Listen.Port)
	fmt.Println("Press Ctrl+C to stop.")

	sig := <-sigCh
	fmt.Printf("\nReceived %v, shutting down...\n", sig)

	if err := rt.Down(ctx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}

	fmt.Println("Stopped.")
	return nil
}

// buildForgeConfig converts the main config's forge settings into a forge.Config.
func buildForgeConfig(cfg *config.Config) (*forge.Config, error) {
	fs := cfg.Volundr.Forge

	host, portStr, err := net.SplitHostPort(fs.Listen)
	if err != nil {
		return nil, fmt.Errorf("invalid forge listen address %q: %w", fs.Listen, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, fmt.Errorf("invalid forge listen port %q: %w", portStr, err)
	}

	workspace := expandHome(fs.Workspace)

	forgeCfg := forge.DefaultForgeConfig()
	forgeCfg.Listen.Host = host
	forgeCfg.Listen.Port = port
	forgeCfg.Listen.ReadHeaderTimeout = fs.ReadHeaderTimeout
	forgeCfg.Listen.ShutdownTimeout = fs.ShutdownTimeout
	forgeCfg.Forge.WorkspacesDir = workspace
	forgeCfg.Forge.MaxConcurrent = fs.MaxConcurrent
	forgeCfg.Forge.StopTimeout = fs.StopTimeout

	if fs.ClaudeBinary != "" {
		forgeCfg.Forge.ClaudeBinary = fs.ClaudeBinary
	}
	if fs.SDKPortStart > 0 {
		forgeCfg.Forge.SDKPortStart = fs.SDKPortStart
	}
	if len(fs.Xcode.SearchPaths) > 0 {
		forgeCfg.Forge.Xcode.SearchPaths = fs.Xcode.SearchPaths
	}
	if fs.Xcode.DefaultVersion != "" {
		forgeCfg.Forge.Xcode.DefaultVersion = fs.Xcode.DefaultVersion
	}

	forgeCfg.Web = cfg.Volundr.Web

	forgeCfg.Auth.Mode = fs.Auth.Mode
	forgeCfg.Auth.Tokens = make([]forge.PATEntry, len(fs.Auth.Tokens))
	for i, t := range fs.Auth.Tokens {
		forgeCfg.Auth.Tokens[i] = forge.PATEntry{Name: t.Name, Token: t.Token}
	}

	// Anthropic key from the top-level config.
	forgeCfg.Anthropic.APIKey = cfg.Anthropic.APIKey

	// Linear tracker settings for issue search.
	forgeCfg.LinearAPIKey = cfg.Linear.APIKey
	forgeCfg.LinearTeamID = cfg.Linear.TeamID

	// GitHub instances for repo listing.
	for _, inst := range cfg.Git.GitHub.Instances {
		forgeCfg.GitHub = append(forgeCfg.GitHub, forge.GitHubInstance{
			Name:     inst.Name,
			BaseURL:  inst.BaseURL,
			Token:    inst.Token,
			TokenEnv: inst.TokenEnv,
			Orgs:     inst.Orgs,
		})
	}
	// Also check env var as fallback.
	if forgeCfg.LinearAPIKey == "" {
		forgeCfg.LinearAPIKey = os.Getenv("LINEAR_API_KEY")
	}

	// Local mounts and AI models.
	forgeCfg.LocalMounts = cfg.LocalMounts.Enabled
	for _, m := range cfg.AIModels {
		forgeCfg.AIModels = append(forgeCfg.AIModels, forge.AIModelEntry{ID: m.ID, Name: m.Name})
	}

	return forgeCfg, nil
}

// claudeBinaryName returns the configured claude binary name, defaulting to "claude".
func claudeBinaryName(cfg *config.Config) string {
	if cfg.Volundr.Forge.ClaudeBinary != "" {
		return cfg.Volundr.Forge.ClaudeBinary
	}
	return "claude"
}

// expandHome replaces a leading ~/ with the user's home directory.
func expandHome(path string) string {
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return filepath.Join(home, path[2:])
}
