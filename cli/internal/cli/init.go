package cli

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var initRuntimeFlag string

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "First-time setup wizard",
	Long:  `Runs the interactive setup wizard, creating ~/.volundr/ with config and credentials.`,
	RunE:  runInit,
}

func init() {
	initCmd.Flags().StringVar(&initRuntimeFlag, "runtime", "", "Set runtime (local, docker, k3s)")
}

func runInit(_ *cobra.Command, _ []string) error {
	fmt.Println("Volundr - Self-hosted Claude Code session manager")
	fmt.Println()

	// Check if already initialized.
	exists, err := config.Exists()
	if err != nil {
		return fmt.Errorf("check existing config: %w", err)
	}
	if exists {
		fmt.Print("Configuration already exists. Overwrite? [y/N]: ")
		reader := bufio.NewReader(os.Stdin)
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Println("Aborted.")
			return nil
		}
	}

	cfg, err := config.DefaultConfig()
	if err != nil {
		return fmt.Errorf("create default config: %w", err)
	}

	reader := bufio.NewReader(os.Stdin)

	// Apply --runtime flag or prompt interactively.
	if initRuntimeFlag != "" {
		cfg.Runtime = initRuntimeFlag
		fmt.Printf("Runtime: %s\n", cfg.Runtime)
	} else {
		fmt.Printf("Runtime [local/docker/k3s] (local): ")
		runtimeStr, _ := reader.ReadString('\n')
		runtimeStr = strings.TrimSpace(runtimeStr)
		if runtimeStr != "" {
			cfg.Runtime = runtimeStr
		}
	}

	// Prompt for Anthropic API key.
	fmt.Print("Anthropic API key: ")
	apiKey, _ := reader.ReadString('\n')
	apiKey = strings.TrimSpace(apiKey)
	cfg.Anthropic.APIKey = apiKey

	// Prompt for database mode.
	fmt.Printf("Database mode [embedded/external] (embedded): ")
	dbMode, _ := reader.ReadString('\n')
	dbMode = strings.TrimSpace(dbMode)
	if dbMode != "" {
		cfg.Database.Mode = dbMode
	}

	if cfg.Database.Mode == "external" {
		fmt.Print("Database host: ")
		host, _ := reader.ReadString('\n')
		cfg.Database.Host = strings.TrimSpace(host)

		fmt.Printf("Database port [5432]: ")
		portStr, _ := reader.ReadString('\n')
		portStr = strings.TrimSpace(portStr)
		if portStr != "" {
			var port int
			if _, err := fmt.Sscanf(portStr, "%d", &port); err == nil {
				cfg.Database.Port = port
			}
		} else {
			cfg.Database.Port = 5432
		}

		fmt.Print("Database user: ")
		user, _ := reader.ReadString('\n')
		cfg.Database.User = strings.TrimSpace(user)

		fmt.Print("Database password: ")
		password, _ := reader.ReadString('\n')
		cfg.Database.Password = strings.TrimSpace(password)

		fmt.Print("Database name: ")
		name, _ := reader.ReadString('\n')
		cfg.Database.Name = strings.TrimSpace(name)
	}

	// Validate.
	if err := cfg.Validate(); err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}

	// Save config.
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}
	fmt.Printf("\nCreating %s/\n", cfgDir)

	if err := cfg.Save(); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	fmt.Println("  config.yaml        ... done")

	// Save credentials if an API key was provided.
	if apiKey != "" {
		creds := &config.Credentials{
			AnthropicAPIKey: apiKey,
		}
		// Use a machine-derived key for now (no passphrase prompt in phase 1).
		machineKey := machinePassphrase()
		if err := config.SaveCredentials(creds, machineKey); err != nil {
			return fmt.Errorf("save credentials: %w", err)
		}
		fmt.Println("  credentials.enc    ... done")
	}

	// Run runtime-specific init.
	rt := runtime.NewRuntime(cfg.Runtime)
	ctx := context.Background()
	if err := rt.Init(ctx, cfg); err != nil {
		return fmt.Errorf("runtime init: %w", err)
	}

	fmt.Println()
	fmt.Println("Run 'volundr up' to start.")

	return nil
}

// machinePassphrase generates a deterministic passphrase from machine identity.
// In production this would use a more robust machine fingerprint.
func machinePassphrase() string {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "volundr-default"
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "/tmp"
	}
	return fmt.Sprintf("volundr-%s-%s", hostname, homeDir)
}
