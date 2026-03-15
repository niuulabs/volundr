package cli

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	goruntime "runtime"
	"strings"
	"unicode"

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
	fmt.Println("Volundr - Self-hosted AI development environment")
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

	// Preflight checks for container runtimes.
	if cfg.Runtime == "docker" || cfg.Runtime == "k3s" {
		fmt.Println()
		fmt.Println("Checking prerequisites...")

		if err := checkCommand("kubectl", "version", "--client"); err != nil {
			return fmt.Errorf("kubectl is required but not found in PATH.\n\nInstall instructions:\n%s",
				installInstructions("kubectl"))
		}
		fmt.Println("  kubectl  ... ok")

		if err := checkCommand("helm", "version"); err != nil {
			return fmt.Errorf("helm is required but not found in PATH.\n\nInstall instructions:\n%s",
				installInstructions("helm"))
		}
		fmt.Println("  helm     ... ok")
		fmt.Println()
	}

	// Prompt for listen host.
	fmt.Print("Listen on [localhost/all/IP address] (localhost): ")
	listenAnswer, _ := reader.ReadString('\n')
	listenAnswer = strings.TrimSpace(listenAnswer)
	switch strings.ToLower(listenAnswer) {
	case "", "localhost":
		fmt.Println("  Binding to localhost only (127.0.0.1)")
	case "all", "all interfaces":
		cfg.Listen.Host = "0.0.0.0"
		fmt.Println("  Binding to all interfaces (0.0.0.0)")
	default:
		cfg.Listen.Host = listenAnswer
		fmt.Printf("  Binding to %s\n", listenAnswer)
	}
	fmt.Println()

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

	// Prompt for GitHub configuration.
	fmt.Println()
	fmt.Print("Configure GitHub access? [y/N]: ")
	ghAnswer, _ := reader.ReadString('\n')
	ghAnswer = strings.TrimSpace(strings.ToLower(ghAnswer))
	if ghAnswer == "y" || ghAnswer == "yes" {
		cfg.Git.GitHub.Enabled = true

		fmt.Print("GitHub token (or env var name like GITHUB_TOKEN): ")
		token, _ := reader.ReadString('\n')
		token = strings.TrimSpace(token)

		fmt.Print("GitHub organizations (comma-separated, optional): ")
		orgsStr, _ := reader.ReadString('\n')
		orgsStr = strings.TrimSpace(orgsStr)

		fmt.Print("GitHub API URL (default: https://api.github.com): ")
		baseURL, _ := reader.ReadString('\n')
		baseURL = strings.TrimSpace(baseURL)
		if baseURL == "" {
			baseURL = "https://api.github.com"
		}

		instance := config.GitHubInstanceConfig{
			Name:    "GitHub",
			BaseURL: baseURL,
		}

		// If the token looks like an env var name (all caps, underscores),
		// store it as token_env; otherwise store as token.
		if token != "" {
			if isEnvVarName(token) {
				instance.TokenEnv = token
			} else {
				instance.Token = token
			}
		}

		if orgsStr != "" {
			for _, org := range strings.Split(orgsStr, ",") {
				org = strings.TrimSpace(org)
				if org != "" {
					instance.Orgs = append(instance.Orgs, org)
				}
			}
		}

		cfg.Git.GitHub.Instances = []config.GitHubInstanceConfig{instance}

		// Ask for the session clone token (used by skuld pods).
		// Default to the same token as the API.
		apiToken := instance.Token
		if apiToken != "" {
			fmt.Printf("GitHub token for session repo cloning (default: same as above): ")
		} else {
			fmt.Print("GitHub token for session repo cloning: ")
		}
		cloneToken, _ := reader.ReadString('\n')
		cloneToken = strings.TrimSpace(cloneToken)
		if cloneToken == "" {
			cloneToken = apiToken
		}
		if cloneToken != "" {
			cfg.Git.GitHub.CloneToken = cloneToken
		}
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

// isEnvVarName returns true if the string looks like an environment variable name
// (all uppercase letters, digits, and underscores).
func isEnvVarName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsUpper(r) && !unicode.IsDigit(r) && r != '_' {
			return false
		}
	}
	return true
}

// checkCommand verifies that a command is available on PATH.
func checkCommand(name string, args ...string) error {
	ctx := context.Background()
	cmd := exec.CommandContext(ctx, name, args...) //nolint:gosec // arguments are hardcoded string literals from callers
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

// installInstructions returns platform-specific install instructions for a tool.
func installInstructions(tool string) string {
	return installInstructionsForOS(tool, goruntime.GOOS, goruntime.GOARCH)
}

// installInstructionsForOS returns install instructions for a tool on the given OS/arch.
func installInstructionsForOS(tool, goos, goarch string) string {
	switch tool {
	case "kubectl":
		switch goos {
		case "darwin":
			return "  brew install kubectl\n  or: https://kubernetes.io/docs/tasks/tools/install-kubectl-macos/"
		case "linux":
			return "  curl -LO \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/" + goarch + "/kubectl\"\n" +
				"  chmod +x kubectl && sudo mv kubectl /usr/local/bin/\n" +
				"  or: https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/"
		default:
			return "  https://kubernetes.io/docs/tasks/tools/"
		}
	case "helm":
		switch goos {
		case "darwin":
			return "  brew install helm\n  or: https://helm.sh/docs/intro/install/"
		case "linux":
			return "  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash\n" +
				"  or: https://helm.sh/docs/intro/install/"
		default:
			return "  https://helm.sh/docs/intro/install/"
		}
	default:
		return ""
	}
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
