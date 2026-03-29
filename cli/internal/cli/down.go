package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var downCmd = &cobra.Command{
	Use:   "down",
	Short: "Stop the Volundr stack",
	Long:  `Gracefully stops all running Volundr services.`,
	RunE:  runDown,
}

func runDown(_ *cobra.Command, _ []string) error {
	fmt.Println("Stopping Volundr...")

	cfg, err := config.Load()
	if err != nil {
		// Config not available — fall back to PID-based shutdown.
		if pidErr := runtime.DownFromPID(); pidErr != nil {
			return fmt.Errorf("stop: %w", pidErr)
		}
		fmt.Println("Stopped.")
		return nil
	}

	ctx := context.Background()
	rt := runtime.NewRuntime(cfg.Runtime)

	// Signal the running process via PID file (best effort).
	// This triggers the signal handler in the `up` process for graceful shutdown
	// of in-process resources (API subprocess, embedded postgres).
	_ = runtime.DownFromPID()

	// Perform runtime-specific cleanup for any resources that survive the
	// main process (Docker containers, Kubernetes pods, compose stacks).
	if err := rt.Down(ctx); err != nil {
		return fmt.Errorf("stop: %w", err)
	}

	fmt.Println("Stopped.")
	return nil
}
