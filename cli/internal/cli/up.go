package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
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
