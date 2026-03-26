// Package cli implements the cobra CLI commands for niuu.
package cli

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
)

var (
	homeFlag string

	// Global flags for remote/TUI mode.
	cfgServer  string
	cfgToken   string
	cfgFile    string
	cfgContext string
)

var rootCmd = &cobra.Command{
	Use:   "niuu",
	Short: "niuu — The Development Platform",
	Long: `niuu is the unified CLI for the Niuu development platform.

It provides access to all platform tools through namespaced subcommands:

  niuu volundr ...   Manage the Volundr development stack
  niuu tyr ...       Tyr saga coordinator (coming soon)

Shared commands (auth, config, context) are top-level:

  niuu login         Authenticate with OIDC
  niuu context ...   Manage cluster contexts
  niuu config ...    Manage CLI configuration

Run without arguments to launch the full TUI, or use subcommands
for specific operations.`,
	SilenceUsage:  true,
	SilenceErrors: true,
	PersistentPreRun: func(_ *cobra.Command, _ []string) {
		// --home flag takes precedence over NIUU_HOME / VOLUNDR_HOME env var.
		if homeFlag != "" {
			_ = os.Setenv(config.EnvHome, homeFlag)
		}
	},
	RunE: func(_ *cobra.Command, _ []string) error {
		// No subcommand given — launch the TUI.
		return runTUI()
	},
}

func init() {
	// Local runtime flags.
	rootCmd.PersistentFlags().StringVar(&homeFlag, "home", "", "config directory (default ~/.niuu, env NIUU_HOME)")

	// Remote/TUI flags.
	rootCmd.PersistentFlags().StringVar(&cfgServer, "server", "", "API server URL (default: from config)")
	rootCmd.PersistentFlags().StringVar(&cfgToken, "token", "", "Authentication token (default: from config)")
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "Config file path (default: ~/.config/niuu/config.yaml)")
	rootCmd.PersistentFlags().StringVar(&cfgContext, "context", "", "Context name to use (default: auto-select if only one exists)")

	// Output flags.
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "Output results as JSON for piping to jq")

	// Tool namespaces.
	rootCmd.AddCommand(volundrCmd)
	rootCmd.AddCommand(tyrCmd)

	// Shared top-level commands.
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(tuiCmd)
	rootCmd.AddCommand(configCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
	rootCmd.AddCommand(contextCmd)

	// Forge (macOS session runner).
	rootCmd.AddCommand(serveCmd)
}

// Execute runs the root command.
func Execute() error {
	return rootCmd.Execute()
}
