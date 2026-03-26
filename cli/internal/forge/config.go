package forge

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"gopkg.in/yaml.v3"
)

// Config holds the forge server configuration.
type Config struct {
	Listen    ListenConfig    `yaml:"listen"`
	Forge     ForgeConfig     `yaml:"forge"`
	Auth      AuthConfig      `yaml:"auth"`
	Git       GitConfig       `yaml:"git"`
	Anthropic AnthropicConfig `yaml:"anthropic"`
}

// ListenConfig holds the listener settings.
type ListenConfig struct {
	Host              string        `yaml:"host"`
	Port              int           `yaml:"port"`
	ReadHeaderTimeout time.Duration `yaml:"read_header_timeout"`
	ShutdownTimeout   time.Duration `yaml:"shutdown_timeout"`
}

// ForgeConfig holds session runner settings.
type ForgeConfig struct {
	WorkspacesDir string        `yaml:"workspaces_dir"`
	StateFile     string        `yaml:"state_file"`
	ClaudeBinary  string        `yaml:"claude_binary"`
	MaxConcurrent int           `yaml:"max_concurrent"`
	SDKPortStart  int           `yaml:"sdk_port_start"`
	StopTimeout   time.Duration `yaml:"stop_timeout"`
	Xcode         XcodeConfig   `yaml:"xcode"`
}

// XcodeConfig holds Xcode toolchain settings.
type XcodeConfig struct {
	DefaultVersion string `yaml:"default_version"`
	// SearchPaths lists directories to scan for Xcode installations.
	// Defaults to /Applications if empty.
	SearchPaths []string `yaml:"search_paths,omitempty"`
}

// AuthConfig holds authentication settings.
type AuthConfig struct {
	Mode   string     `yaml:"mode"` // "pat" or "none"
	Tokens []PATEntry `yaml:"tokens,omitempty"`
}

// PATEntry is a named personal access token.
type PATEntry struct {
	Name  string `yaml:"name"`
	Token string `yaml:"token"`
}

// GitConfig holds git provider settings.
type GitConfig struct {
	GitHub GitHubConfig `yaml:"github,omitempty"`
}

// GitHubConfig holds GitHub-specific settings.
type GitHubConfig struct {
	Token    string `yaml:"token,omitempty"`
	TokenEnv string `yaml:"token_env,omitempty"`
}

// AnthropicConfig holds Anthropic API settings.
type AnthropicConfig struct {
	APIKey    string `yaml:"api_key,omitempty"`
	APIKeyEnv string `yaml:"api_key_env,omitempty"`
}

// DefaultForgeConfig returns a Config with sensible defaults for macOS.
func DefaultForgeConfig() *Config {
	home, _ := os.UserHomeDir()
	volundrDir := filepath.Join(home, ".niuu")

	cfg := &Config{
		Listen: ListenConfig{
			Host:              "127.0.0.1",
			Port:              8080,
			ReadHeaderTimeout: 10 * time.Second,
			ShutdownTimeout:   10 * time.Second,
		},
		Forge: ForgeConfig{
			WorkspacesDir: filepath.Join(volundrDir, "workspaces"),
			StateFile:     filepath.Join(volundrDir, "forge-state.json"),
			ClaudeBinary:  "claude",
			MaxConcurrent: 4,
			SDKPortStart:  9100,
			StopTimeout:   10 * time.Second,
			Xcode: XcodeConfig{
				SearchPaths: []string{"/Applications"},
			},
		},
		Auth: AuthConfig{
			Mode: "none",
		},
		Anthropic: AnthropicConfig{
			APIKeyEnv: "ANTHROPIC_API_KEY",
		},
	}

	return cfg
}

// LoadForgeConfig reads the forge config from the given path.
func LoadForgeConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path) //nolint:gosec // path from CLI flag or default config location
	if err != nil {
		return nil, fmt.Errorf("read forge config %s: %w", path, err)
	}

	cfg := DefaultForgeConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse forge config %s: %w", path, err)
	}

	return cfg, nil
}

// Validate checks the config for correctness.
func (c *Config) Validate() error {
	if c.Listen.Port < 1 || c.Listen.Port > 65535 {
		return fmt.Errorf("invalid listen port %d: must be 1-65535", c.Listen.Port)
	}

	if c.Forge.MaxConcurrent < 1 {
		return fmt.Errorf("max_concurrent must be >= 1")
	}

	if c.Auth.Mode != "pat" && c.Auth.Mode != "none" {
		return fmt.Errorf("invalid auth mode %q: must be pat or none", c.Auth.Mode)
	}

	return nil
}

// ResolveAnthropicKey returns the Anthropic API key, checking the config
// value first and falling back to the environment variable.
func (c *Config) ResolveAnthropicKey() string {
	if c.Anthropic.APIKey != "" {
		return c.Anthropic.APIKey
	}
	envVar := c.Anthropic.APIKeyEnv
	if envVar == "" {
		envVar = "ANTHROPIC_API_KEY"
	}
	return os.Getenv(envVar)
}

// ResolveGitHubToken returns the GitHub token from config or environment.
func (c *Config) ResolveGitHubToken() string {
	if c.Git.GitHub.Token != "" {
		return c.Git.GitHub.Token
	}
	envVar := c.Git.GitHub.TokenEnv
	if envVar == "" {
		envVar = "GITHUB_TOKEN"
	}
	return os.Getenv(envVar)
}

// IsMacOS returns true if the current platform is macOS.
func IsMacOS() bool {
	return runtime.GOOS == "darwin"
}
