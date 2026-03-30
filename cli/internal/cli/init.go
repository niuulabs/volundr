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
	"github.com/niuulabs/volundr/cli/internal/preflight"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var initModeFlag string

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "First-time setup wizard",
	Long:  `Runs the interactive setup wizard, creating ~/.niuu/ with config and credentials.`,
	RunE:  runInit,
}

func init() {
	initCmd.Flags().StringVar(&initModeFlag, "mode", "", "Set mode (mini, k3s)")
}

func runInit(_ *cobra.Command, _ []string) error {
	fmt.Println("Volundr - Self-hosted AI development environment")
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)

	// Check if already initialized — load existing config for prefill defaults.
	var existing *config.Config
	exists, err := config.Exists()
	if err != nil {
		return fmt.Errorf("check existing config: %w", err)
	}
	if exists {
		fmt.Print("Configuration already exists. Overwrite? [y/N]: ")
		answer, _ := reader.ReadString('\n')
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Println("Aborted.")
			return nil
		}
		existing, _ = config.Load()
	}

	cfg, err := config.DefaultConfig()
	if err != nil {
		return fmt.Errorf("create default config: %w", err)
	}

	// If there's an existing config, use it as the base so the user can
	// press Enter to keep their current values.
	if existing != nil {
		cfg = existing
	}

	// Apply --mode flag or prompt interactively.
	if initModeFlag != "" {
		cfg.Volundr.Mode = initModeFlag
		fmt.Printf("Mode: %s\n", cfg.Volundr.Mode)
	} else {
		fmt.Printf("Mode [mini/k3s] (%s): ", cfg.Volundr.Mode)
		modeStr, _ := reader.ReadString('\n')
		modeStr = strings.TrimSpace(modeStr)
		if modeStr != "" {
			cfg.Volundr.Mode = modeStr
		}
	}

	// Preflight checks for container runtimes.
	if cfg.Volundr.Mode == "k3s" {
		fmt.Println()
		fmt.Println("Checking prerequisites...")

		if err := checkCommand("docker", "version"); err != nil {
			return fmt.Errorf("docker is required but not found in PATH.\n\nInstall instructions:\n%s",
				installInstructions("docker"))
		}
		fmt.Println("  docker   ... ok")

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
	listenDefault := listenHostLabel(cfg.Listen.Host)
	fmt.Printf("Listen on [localhost/all/IP address] (%s): ", listenDefault)
	listenAnswer, _ := reader.ReadString('\n')
	listenAnswer = strings.TrimSpace(listenAnswer)
	switch strings.ToLower(listenAnswer) {
	case "":
		fmt.Printf("  Binding to %s\n", cfg.Listen.Host)
	case "localhost":
		cfg.Listen.Host = "127.0.0.1"
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
	if cfg.Anthropic.APIKey != "" {
		masked := maskKey(cfg.Anthropic.APIKey)
		fmt.Printf("Anthropic API key (%s): ", masked)
	} else {
		fmt.Print("Anthropic API key: ")
	}
	apiKey, _ := reader.ReadString('\n')
	apiKey = strings.TrimSpace(apiKey)
	if apiKey != "" {
		cfg.Anthropic.APIKey = apiKey
	}

	// Prompt for database mode.
	fmt.Printf("Database mode [embedded/external] (%s): ", cfg.Database.Mode)
	dbMode, _ := reader.ReadString('\n')
	dbMode = strings.TrimSpace(dbMode)
	if dbMode != "" {
		cfg.Database.Mode = dbMode
	}

	if cfg.Database.Mode == "external" {
		fmt.Printf("Database host (%s): ", defaultStr(cfg.Database.Host, "none"))
		host, _ := reader.ReadString('\n')
		host = strings.TrimSpace(host)
		if host != "" {
			cfg.Database.Host = host
		}

		fmt.Printf("Database port (%d): ", cfg.Database.Port)
		portStr, _ := reader.ReadString('\n')
		portStr = strings.TrimSpace(portStr)
		if portStr != "" {
			var port int
			if _, err := fmt.Sscanf(portStr, "%d", &port); err == nil {
				cfg.Database.Port = port
			}
		}

		fmt.Printf("Database user (%s): ", defaultStr(cfg.Database.User, "none"))
		user, _ := reader.ReadString('\n')
		user = strings.TrimSpace(user)
		if user != "" {
			cfg.Database.User = user
		}

		fmt.Printf("Database password (%s): ", defaultStr(maskKey(cfg.Database.Password), "none"))
		password, _ := reader.ReadString('\n')
		password = strings.TrimSpace(password)
		if password != "" {
			cfg.Database.Password = password
		}

		fmt.Printf("Database name (%s): ", defaultStr(cfg.Database.Name, "none"))
		name, _ := reader.ReadString('\n')
		name = strings.TrimSpace(name)
		if name != "" {
			cfg.Database.Name = name
		}
	}

	// Prompt for GitHub configuration.
	// Determine defaults from existing config if available.
	var existingGH *config.GitHubInstanceConfig
	if cfg.Git.GitHub.Enabled && len(cfg.Git.GitHub.Instances) > 0 {
		existingGH = &cfg.Git.GitHub.Instances[0]
	}

	fmt.Println()
	ghDefault := "N"
	if cfg.Git.GitHub.Enabled {
		ghDefault = "Y"
	}
	fmt.Printf("Configure GitHub access? [y/N] (%s): ", ghDefault)
	ghAnswer, _ := reader.ReadString('\n')
	ghAnswer = strings.TrimSpace(strings.ToLower(ghAnswer))
	if ghAnswer == "" {
		if cfg.Git.GitHub.Enabled {
			ghAnswer = "y"
		} else {
			ghAnswer = "n"
		}
	}
	if ghAnswer == "y" || ghAnswer == "yes" {
		cfg.Git.GitHub.Enabled = true

		// Show existing token hint.
		existingTokenHint := ""
		if existingGH != nil {
			if existingGH.TokenEnv != "" {
				existingTokenHint = existingGH.TokenEnv
			} else if existingGH.Token != "" {
				existingTokenHint = maskKey(existingGH.Token)
			}
		}
		if existingTokenHint != "" {
			fmt.Printf("GitHub token (or env var name like GITHUB_TOKEN) (%s): ", existingTokenHint)
		} else {
			fmt.Print("GitHub token (or env var name like GITHUB_TOKEN): ")
		}
		token, _ := reader.ReadString('\n')
		token = strings.TrimSpace(token)

		// Show existing orgs.
		existingOrgs := ""
		if existingGH != nil && len(existingGH.Orgs) > 0 {
			existingOrgs = strings.Join(existingGH.Orgs, ", ")
		}
		if existingOrgs != "" {
			fmt.Printf("GitHub organizations (comma-separated, optional) (%s): ", existingOrgs)
		} else {
			fmt.Print("GitHub organizations (comma-separated, optional): ")
		}
		orgsStr, _ := reader.ReadString('\n')
		orgsStr = strings.TrimSpace(orgsStr)

		// Show existing base URL.
		existingURL := "https://api.github.com"
		if existingGH != nil && existingGH.BaseURL != "" {
			existingURL = existingGH.BaseURL
		}
		fmt.Printf("GitHub API URL (%s): ", existingURL)
		baseURL, _ := reader.ReadString('\n')
		baseURL = strings.TrimSpace(baseURL)
		if baseURL == "" {
			baseURL = existingURL
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
		} else if existingGH != nil {
			// Keep existing token if user pressed Enter.
			instance.Token = existingGH.Token
			instance.TokenEnv = existingGH.TokenEnv
		}

		if orgsStr != "" {
			for _, org := range strings.Split(orgsStr, ",") {
				org = strings.TrimSpace(org)
				if org != "" {
					instance.Orgs = append(instance.Orgs, org)
				}
			}
		} else if existingGH != nil && len(existingGH.Orgs) > 0 {
			// Keep existing orgs if user pressed Enter.
			instance.Orgs = existingGH.Orgs
		}

		cfg.Git.GitHub.Instances = []config.GitHubInstanceConfig{instance}

		// Ask for the session clone token (used by skuld pods).
		// Default to the same token as the API.
		apiToken := instance.Token
		existingClone := cfg.Git.GitHub.CloneToken
		switch {
		case existingClone != "":
			fmt.Printf("GitHub token for session repo cloning (%s): ", maskKey(existingClone))
		case apiToken != "":
			fmt.Printf("GitHub token for session repo cloning (default: same as above): ")
		default:
			fmt.Print("GitHub token for session repo cloning: ")
		}
		cloneToken, _ := reader.ReadString('\n')
		cloneToken = strings.TrimSpace(cloneToken)
		if cloneToken == "" {
			if existingClone != "" {
				cloneToken = existingClone
			} else {
				cloneToken = apiToken
			}
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

	// Save credentials if an API key is configured (new or existing).
	if cfg.Anthropic.APIKey != "" {
		creds := &config.Credentials{
			AnthropicAPIKey: cfg.Anthropic.APIKey,
		}
		// Use a machine-derived key for now (no passphrase prompt in phase 1).
		machineKey := machinePassphrase()
		if err := config.SaveCredentials(creds, machineKey); err != nil {
			return fmt.Errorf("save credentials: %w", err)
		}
		fmt.Println("  credentials.enc    ... done")
	}

	// Run mini-mode preflight checks (warnings only — don't block init).
	if cfg.Volundr.Mode == "mini" {
		fmt.Println()
		fmt.Println("Preflight checks:")
		results := runInitPreflightChecks(cfg)
		fmt.Print(preflight.FormatResults(results))
	}

	// Run runtime-specific init (k3s only — mini mode needs no runtime setup).
	if cfg.Volundr.Mode == "k3s" {
		rt := runtime.NewRuntime("k3s")
		ctx := context.Background()
		if err := rt.Init(ctx, cfg); err != nil {
			return fmt.Errorf("runtime init: %w", err)
		}
	}

	fmt.Println()
	fmt.Println("Run 'niuu volundr up' to start.")

	return nil
}

// runInitPreflightChecks runs non-blocking checks after the init wizard and
// returns the results for display.
func runInitPreflightChecks(cfg *config.Config) []preflight.Result {
	return []preflight.Result{
		preflight.CheckBinary(claudeBinaryName(cfg), "--version"),
		preflight.CheckAPIKeySet(cfg.Anthropic.APIKey),
		preflight.CheckBinary("git", "--version"),
		preflight.CheckDirWritable(expandHome(cfg.Volundr.Forge.Workspace)),
	}
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
	case "claude":
		return "  npm install -g @anthropic-ai/claude-code\n\n" +
			"  Or specify a custom path in ~/.niuu/config.yaml:\n" +
			"    volundr:\n" +
			"      forge:\n" +
			"        claude_binary: /path/to/claude"
	case "git":
		switch goos {
		case "darwin":
			return "  xcode-select --install\n  or: brew install git"
		case "linux":
			return "  sudo apt install git\n  or: sudo dnf install git"
		default:
			return "  https://git-scm.com/downloads"
		}
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

// maskKey returns a masked version of a secret string, showing only the last 4
// characters. Returns "****" for short or empty strings.
func maskKey(s string) string {
	if len(s) <= 4 {
		return "****"
	}
	return "****" + s[len(s)-4:]
}

// defaultStr returns s if non-empty, otherwise the fallback.
func defaultStr(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// listenHostLabel returns a human-readable label for a listen host address.
func listenHostLabel(host string) string {
	switch host {
	case "127.0.0.1", "localhost", "":
		return "localhost"
	case "0.0.0.0":
		return "all"
	default:
		return host
	}
}

// machinePassphrase generates a deterministic passphrase from machine identity.
// In production this would use a more robust machine fingerprint.
func machinePassphrase() string {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "niuu-default"
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "/tmp"
	}
	return fmt.Sprintf("niuu-%s-%s", hostname, homeDir)
}

// legacyMachinePassphrase returns the old "volundr-" prefixed passphrase
// used before the niuu rename. Used as a fallback when loading credentials.
func legacyMachinePassphrase() string {
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
