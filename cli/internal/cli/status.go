package cli

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show status of Volundr services",
	Long:  `Displays the current state of all Volundr services.`,
	RunE:  runStatus,
}

func runStatus(_ *cobra.Command, _ []string) error {
	// TODO: load config and use runtime.NewRuntime(cfg.Runtime).Status() for runtime-specific status
	status, err := runtime.StatusFromStateFile()
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}

	fmt.Printf("Runtime: %s\n\n", status.Runtime)
	fmt.Printf("%-15s %-10s %-8s %-6s %s\n", "SERVICE", "STATE", "PID", "PORT", "ERROR")
	fmt.Printf("%-15s %-10s %-8s %-6s %s\n", "-------", "-----", "---", "----", "-----")

	for _, svc := range status.Services {
		pid := ""
		if svc.PID > 0 {
			pid = fmt.Sprintf("%d", svc.PID)
		}
		port := ""
		if svc.Port > 0 {
			port = fmt.Sprintf("%d", svc.Port)
		}
		fmt.Printf("%-15s %-10s %-8s %-6s %s\n",
			svc.Name, svc.State, pid, port, svc.Error)
	}

	return nil
}
