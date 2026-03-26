package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/forge"
)

var (
	serveConfigFile string
	servePort       int
	serveHost       string
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Run the forge — a macOS-native session runner",
	Long: `Run Volundr Forge, a lightweight session runner that manages Claude Code
sessions as local processes. Exposes a Volundr-compatible REST API that Tyr
(or any Volundr client) can dispatch work to.

Designed for macOS hosts where iOS development toolchains (Xcode, simulators)
are available. No Python or Kubernetes required.

Example:
  volundr serve                          # Start with defaults
  volundr serve --config forge.yaml      # Start with custom config
  volundr serve --port 9090              # Override listen port`,
	RunE: runServe,
}

func init() {
	serveCmd.Flags().StringVarP(&serveConfigFile, "config", "c", "", "forge config file (default: ~/.volundr/forge.yaml)")
	serveCmd.Flags().IntVar(&servePort, "port", 0, "override listen port")
	serveCmd.Flags().StringVar(&serveHost, "host", "", "override listen host")
}

func runServe(_ *cobra.Command, _ []string) error {
	var cfg *forge.Config
	var err error

	if serveConfigFile != "" {
		cfg, err = forge.LoadForgeConfig(serveConfigFile)
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}
	} else {
		cfg = forge.DefaultForgeConfig()
	}

	// CLI flag overrides.
	if servePort > 0 {
		cfg.Listen.Port = servePort
	}
	if serveHost != "" {
		cfg.Listen.Host = serveHost
	}

	srv, err := forge.NewServer(cfg)
	if err != nil {
		return err
	}

	return srv.Run(context.Background())
}
