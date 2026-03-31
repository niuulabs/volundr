package cli

import (
	"github.com/spf13/cobra"
)

var volundrCmd = &cobra.Command{
	Use:   "volundr",
	Short: "Manage the Volundr development stack",
	Long: `Volundr stack lifecycle commands.

Use these subcommands to initialize, start, stop, and manage your
self-hosted Volundr development environment and coding sessions.`,
}

func init() {
	volundrCmd.AddCommand(initCmd)
	volundrCmd.AddCommand(upCmd)
	volundrCmd.AddCommand(downCmd)
	volundrCmd.AddCommand(statusCmd)
	volundrCmd.AddCommand(sessionsCmd)
}
