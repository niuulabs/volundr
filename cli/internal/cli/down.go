package cli

import (
	"fmt"

	"github.com/spf13/cobra"

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

	// TODO: load config and use runtime.NewRuntime(cfg.Runtime).Down() for runtime-specific cleanup
	if err := runtime.DownFromPID(); err != nil {
		return fmt.Errorf("stop: %w", err)
	}

	fmt.Println("Stopped.")
	return nil
}
