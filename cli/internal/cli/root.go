// Package cli implements the cobra CLI commands for volundr.
package cli

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
)

var (
	homeFlag string

	// Global flags for remote/TUI mode.
	cfgServer string
	cfgToken  string
	cfgFile   string
)

var rootCmd = &cobra.Command{
	Use:   "volundr",
	Short: "Volundr — The Coding Forge",
	Long: `Volundr is a self-hosted remote development platform.

In local mode it orchestrates the entire Volundr stack (embedded PostgreSQL,
Python API, reverse proxy) as a single binary.

In remote mode it provides both a rich terminal UI (TUI) for interactive use
and direct commands for scripting and automation.

Run without arguments to launch the full TUI, or use subcommands
for specific operations.`,
	SilenceUsage:  true,
	SilenceErrors: true,
	PersistentPreRun: func(_ *cobra.Command, _ []string) {
		// --home flag takes precedence over VOLUNDR_HOME env var.
		if homeFlag != "" {
			os.Setenv(config.EnvHome, homeFlag)
		}
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		// No subcommand given — launch the TUI.
		return runTUI()
	},
}

func init() {
	// Local runtime flags.
	rootCmd.PersistentFlags().StringVar(&homeFlag, "home", "", "config directory (default ~/.volundr, env VOLUNDR_HOME)")

	// Remote/TUI flags.
	rootCmd.PersistentFlags().StringVar(&cfgServer, "server", "", "Volundr API server URL (default: from config)")
	rootCmd.PersistentFlags().StringVar(&cfgToken, "token", "", "Authentication token (default: from config)")
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "Config file path (default: ~/.config/volundr/config.yaml)")

	// Existing local commands.
	rootCmd.AddCommand(initCmd)
	rootCmd.AddCommand(upCmd)
	rootCmd.AddCommand(downCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(versionCmd)

	// Remote/TUI commands.
	rootCmd.AddCommand(tuiCmd)
	rootCmd.AddCommand(sessionsCmd)
	rootCmd.AddCommand(configCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
}

// Execute runs the root command.
func Execute() error {
	return rootCmd.Execute()
}
