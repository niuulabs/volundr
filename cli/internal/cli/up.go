package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/preflight"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var (
	runtimeFlag string
	noWebFlag   bool
)

var upCmd = &cobra.Command{
	Use:   "up",
	Short: "Start the Volundr stack",
	Long:  `Starts all services (PostgreSQL, API, proxy) based on the configured runtime.`,
	RunE:  runUp,
}

func init() {
	upCmd.Flags().StringVar(&runtimeFlag, "runtime", "", "Override runtime (local, docker, k3s)")
	upCmd.Flags().BoolVar(&noWebFlag, "no-web", false, "Disable the embedded web UI")
}

func runUp(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config (run 'volundr init' first): %w", err)
	}

	if runtimeFlag != "" {
		cfg.Runtime = runtimeFlag
	}

	if noWebFlag {
		f := false
		cfg.Web = &f
	}

	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	// Load credentials and inject API key into config if available.
	machineKey := machinePassphrase()
	creds, err := config.LoadCredentials(machineKey)
	if err == nil && creds.AnthropicAPIKey != "" && cfg.Anthropic.APIKey == "" {
		cfg.Anthropic.APIKey = creds.AnthropicAPIKey
	}

	// Run preflight validation for local runtime.
	if cfg.Runtime == "local" {
		if err := runUpPreflight(cfg); err != nil {
			return err
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle signals for graceful shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("\nStarting Volundr (runtime: %s)...\n", cfg.Runtime)

	rt := runtime.NewRuntime(cfg.Runtime)

	if err := rt.Up(ctx, cfg); err != nil {
		// Best-effort cleanup on failure.
		_ = rt.Down(ctx)
		return err
	}

	scheme := "http"
	if cfg.TLS.Mode != "off" {
		scheme = "https"
	}
	fmt.Printf("\nVolundr is running at %s://%s:%d\n", scheme, cfg.Listen.Host, cfg.Listen.Port)
	fmt.Println("Press Ctrl+C to stop.")

	// Wait for signal.
	sig := <-sigCh
	fmt.Printf("\nReceived %v, shutting down...\n", sig)

	if err := rt.Down(ctx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}

	fmt.Println("Stopped.")
	return nil
}

// runUpPreflight validates prerequisites before starting the server.
// Hard failures (port, claude binary) return errors; soft issues (API key) print warnings.
func runUpPreflight(cfg *config.Config) error {
	// Hard failure: claude binary must be available.
	claudeResult := preflight.CheckBinary("claude")
	if !claudeResult.OK {
		return fmt.Errorf("%s\n\n%s", claudeResult.Message, preflight.BinaryRemediation("claude"))
	}

	// Hard failure: configured port must be available.
	portResult := preflight.CheckPortAvailable(cfg.Listen.Host, cfg.Listen.Port)
	if !portResult.OK {
		return fmt.Errorf("%s\n\n%s", portResult.Message, preflight.PortRemediation(cfg.Listen.Host, cfg.Listen.Port))
	}

	// Hard failure: workspace directory must be writable.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}
	dirResult := preflight.CheckDirWritable(cfgDir)
	if !dirResult.OK {
		return fmt.Errorf("%s", dirResult.Message)
	}

	// Soft warning: API key.
	credsPath, _ := config.CredentialsPath()
	apiKeyResult := preflight.CheckAPIKey(cfg.Anthropic.APIKey, credsPath)
	if !apiKeyResult.OK {
		fmt.Printf("\n%s\n", preflight.APIKeyRemediation())
	}

	return nil
}
