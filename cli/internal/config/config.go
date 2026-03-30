// Package config manages the ~/.niuu/config.yaml configuration file.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	// EnvHome is the environment variable that overrides the config directory.
	EnvHome = "NIUU_HOME"
	// LegacyEnvHome is the deprecated environment variable (checked as fallback).
	LegacyEnvHome = "VOLUNDR_HOME"
	// DefaultConfigDir is the default directory for niuu configuration.
	DefaultConfigDir = ".niuu"
	// LegacyConfigDir is the deprecated directory (checked as fallback).
	LegacyConfigDir = ".volundr"
	// DefaultConfigFile is the default config file name.
	DefaultConfigFile = "config.yaml"
	// DefaultDBPort is the default port for embedded PostgreSQL.
	DefaultDBPort = 5433
	// DefaultListenPort is the default port for the web server.
	DefaultListenPort = 8080
	// DefaultListenHost is the default host to bind to.
	DefaultListenHost = "127.0.0.1"
	// DefaultDBUser is the default database user.
	DefaultDBUser = "volundr"
	// DefaultDBName is the default database name.
	DefaultDBName = "volundr"
)

// K3sConfig holds k3s/k3d runtime settings.
type K3sConfig struct {
	Kubeconfig string `yaml:"kubeconfig"`            // default: auto-detect
	Namespace  string `yaml:"namespace"`             // default: volundr
	Provider   string `yaml:"provider"`              // "auto", "k3d", "native" (default: auto)
	APIImage   string `yaml:"api_image,omitempty"`   // default: ghcr.io/niuulabs/volundr:latest
	SkuldImage string `yaml:"skuld_image,omitempty"` // default: ghcr.io/niuulabs/skuld:latest
	RehImage   string `yaml:"reh_image,omitempty"`   // default: ghcr.io/niuulabs/vscode-reh:latest
	TtydImage  string `yaml:"ttyd_image,omitempty"`  // default: ghcr.io/niuulabs/devrunner:latest
	Network    string `yaml:"network,omitempty"`     // default: volundr-net
}

// GitHubInstanceConfig holds settings for a single GitHub instance.
type GitHubInstanceConfig struct {
	Name     string   `yaml:"name"`
	BaseURL  string   `yaml:"base_url"`
	Token    string   `yaml:"token,omitempty"`
	TokenEnv string   `yaml:"token_env,omitempty"`
	Orgs     []string `yaml:"orgs,omitempty"`
}

// GitConfig holds git provider settings.
type GitConfig struct {
	GitHub GitHubConfig `yaml:"github,omitempty"`
}

// GitHubConfig holds GitHub-specific settings.
type GitHubConfig struct {
	Enabled    bool                   `yaml:"enabled"`
	Instances  []GitHubInstanceConfig `yaml:"instances,omitempty"`
	CloneToken string                 `yaml:"clone_token,omitempty"`
}

// LocalMountsConfig holds settings for local filesystem mount support.
type LocalMountsConfig struct {
	Enabled         bool     `yaml:"enabled"`
	AllowRootMount  bool     `yaml:"allow_root_mount"`
	AllowedPrefixes []string `yaml:"allowed_prefixes,omitempty"`
	DefaultReadOnly bool     `yaml:"default_read_only"`
}

// TyrSettings holds tyr-mini settings within the main config.
type TyrSettings struct {
	Enabled bool `yaml:"enabled"`
}

// VolundrConfig holds Volundr stack mode and forge settings.
type VolundrConfig struct {
	Mode  string        `yaml:"mode"`
	Web   bool          `yaml:"web"`
	Forge ForgeSettings `yaml:"forge"`
	Tyr   TyrSettings   `yaml:"tyr"`
}

// ForgeSettings holds forge (mini mode) settings within the main config.
type ForgeSettings struct {
	Listen            string             `yaml:"listen"`
	Workspace         string             `yaml:"workspace"`
	ClaudeBinary      string             `yaml:"claude_binary,omitempty"`
	MaxConcurrent     int                `yaml:"max_concurrent"`
	SDKPortStart      int                `yaml:"sdk_port_start,omitempty"`
	Auth              ForgeAuthSettings  `yaml:"auth"`
	StopTimeout       time.Duration      `yaml:"stop_timeout"`
	ShutdownTimeout   time.Duration      `yaml:"shutdown_timeout"`
	ReadHeaderTimeout time.Duration      `yaml:"read_header_timeout"`
	Xcode             ForgeXcodeSettings `yaml:"xcode,omitempty"`
}

// ForgeAuthSettings holds forge authentication settings.
type ForgeAuthSettings struct {
	Mode   string            `yaml:"mode"`
	Tokens []ForgeTokenEntry `yaml:"tokens,omitempty"`
}

// ForgeTokenEntry is a named personal access token.
type ForgeTokenEntry struct {
	Name  string `yaml:"name"`
	Token string `yaml:"token"`
}

// ForgeXcodeSettings holds Xcode toolchain settings for forge.
type ForgeXcodeSettings struct {
	DefaultVersion string   `yaml:"default_version,omitempty"`
	SearchPaths    []string `yaml:"search_paths,omitempty"`
}

// Config represents the full volundr configuration.
type Config struct {
	Volundr     VolundrConfig     `yaml:"volundr"`
	Listen      ListenConfig      `yaml:"listen"`
	TLS         TLSConfig         `yaml:"tls"`
	Database    DatabaseConfig    `yaml:"database"`
	Anthropic   AnthropicConfig   `yaml:"anthropic"`
	Git         GitConfig         `yaml:"git,omitempty"`
	K3s         K3sConfig         `yaml:"k3s,omitempty"`
	LocalMounts LocalMountsConfig `yaml:"local_mounts,omitempty"`

	// Runtime is deprecated: use Volundr.Mode instead.
	Runtime string `yaml:"runtime,omitempty"`
}

// ListenConfig holds the listener settings.
type ListenConfig struct {
	Host string `yaml:"host"`
	Port int    `yaml:"port"`
}

// TLSConfig holds TLS settings.
type TLSConfig struct {
	Mode     string `yaml:"mode"`
	CertFile string `yaml:"cert_file,omitempty"`
	KeyFile  string `yaml:"key_file,omitempty"`
}

// DatabaseConfig holds database settings.
type DatabaseConfig struct {
	Mode     string `yaml:"mode"`
	DataDir  string `yaml:"data_dir,omitempty"`
	Port     int    `yaml:"port"`
	Host     string `yaml:"host,omitempty"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	Name     string `yaml:"name"`
}

// AnthropicConfig holds Anthropic API settings.
type AnthropicConfig struct {
	APIKey string `yaml:"api_key"`
}

// ConfigDir returns the path to the niuu config directory.
// It checks NIUU_HOME, then VOLUNDR_HOME (legacy), then ~/.niuu,
// falling back to ~/.volundr if the new directory doesn't exist yet.
func ConfigDir() (string, error) { //nolint:revive // used as config.ConfigDir externally
	if dir := os.Getenv(EnvHome); dir != "" {
		return dir, nil
	}
	if dir := os.Getenv(LegacyEnvHome); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home directory: %w", err)
	}

	newDir := filepath.Join(home, DefaultConfigDir)
	if _, err := os.Stat(newDir); err == nil {
		return newDir, nil
	}

	// Fall back to legacy path if it exists.
	legacyDir := filepath.Join(home, LegacyConfigDir)
	if _, err := os.Stat(legacyDir); err == nil {
		return legacyDir, nil
	}

	// Neither exists — use the new path (will be created on first write).
	return newDir, nil
}

// ConfigPath returns the path to the config file.
func ConfigPath() (string, error) { //nolint:revive // used as config.ConfigPath externally
	dir, err := ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, DefaultConfigFile), nil
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() (*Config, error) {
	dir, err := ConfigDir()
	if err != nil {
		return nil, fmt.Errorf("get config dir: %w", err)
	}

	password, err := generatePassword()
	if err != nil {
		return nil, fmt.Errorf("generate db password: %w", err)
	}

	return &Config{
		Volundr: VolundrConfig{
			Mode: "mini",
			Web:  true,
			Forge: ForgeSettings{
				Listen:            "127.0.0.1:8080",
				Workspace:         filepath.Join(dir, "sessions"),
				ClaudeBinary:      "claude",
				MaxConcurrent:     4,
				SDKPortStart:      9100,
				StopTimeout:       10 * time.Second,
				ShutdownTimeout:   10 * time.Second,
				ReadHeaderTimeout: 10 * time.Second,
				Auth: ForgeAuthSettings{
					Mode: "none",
				},
				Xcode: ForgeXcodeSettings{
					SearchPaths: []string{"/Applications"},
				},
			},
		},
		Listen: ListenConfig{
			Host: DefaultListenHost,
			Port: DefaultListenPort,
		},
		TLS: TLSConfig{
			Mode: "off",
		},
		Database: DatabaseConfig{
			Mode:     "embedded",
			DataDir:  filepath.Join(dir, "data", "pg"),
			Port:     DefaultDBPort,
			User:     DefaultDBUser,
			Password: password,
			Name:     DefaultDBName,
		},
		Anthropic: AnthropicConfig{},
		K3s: K3sConfig{
			Kubeconfig: "",
			Namespace:  "volundr",
			Provider:   "auto",
			APIImage:   "ghcr.io/niuulabs/volundr:latest",
			SkuldImage: "ghcr.io/niuulabs/skuld:latest",
			RehImage:   "ghcr.io/niuulabs/vscode-reh:latest",
			TtydImage:  "ghcr.io/niuulabs/devrunner:latest",
			Network:    "volundr-net",
		},
	}, nil
}

// Load reads the config file from the default location.
func Load() (*Config, error) {
	path, err := ConfigPath()
	if err != nil {
		return nil, err
	}
	return LoadFrom(path)
}

// LoadFrom reads a config file from the given path.
func LoadFrom(path string) (*Config, error) {
	data, err := os.ReadFile(path) //nolint:gosec // path comes from ConfigPath() or caller-provided config location
	if err != nil {
		return nil, fmt.Errorf("read config file %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config file %s: %w", path, err)
	}

	cfg.migrate()
	return &cfg, nil
}

// migrate normalizes deprecated config fields to the current structure.
func (c *Config) migrate() {
	if c.Volundr.Mode != "" {
		return
	}
	if c.Runtime == "" {
		return
	}
	// Map legacy runtime values to volundr.mode.
	switch c.Runtime {
	case "local":
		c.Volundr.Mode = "mini"
	default:
		c.Volundr.Mode = c.Runtime
	}
}

// Save writes the config to the default location.
func (c *Config) Save() error {
	path, err := ConfigPath()
	if err != nil {
		return err
	}
	return c.SaveTo(path)
}

// SaveTo writes the config to the given path.
func (c *Config) SaveTo(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config directory %s: %w", dir, err)
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write config file %s: %w", path, err)
	}

	return nil
}

// Exists checks if the config file exists at the default location.
func Exists() (bool, error) {
	path, err := ConfigPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("stat config file: %w", err)
	}
	return true, nil
}

// Validate checks the config for correctness.
func (c *Config) Validate() error {
	if c.Volundr.Mode != "mini" && c.Volundr.Mode != "k3s" {
		return fmt.Errorf("invalid mode %q: must be mini or k3s", c.Volundr.Mode)
	}

	if c.Volundr.Mode == "k3s" {
		if c.Listen.Port < 1 || c.Listen.Port > 65535 {
			return fmt.Errorf("invalid listen port %d: must be 1-65535", c.Listen.Port)
		}
		if c.Database.Mode != "embedded" && c.Database.Mode != "external" {
			return fmt.Errorf("invalid database mode %q: must be embedded or external", c.Database.Mode)
		}
		if c.Database.Mode == "external" && c.Database.Host == "" {
			return fmt.Errorf("database host is required when mode is external")
		}
		if c.Database.Port < 1 || c.Database.Port > 65535 {
			return fmt.Errorf("invalid database port %d: must be 1-65535", c.Database.Port)
		}
	}

	if c.Volundr.Mode == "mini" && c.Volundr.Forge.MaxConcurrent < 1 {
		return fmt.Errorf("forge max_concurrent must be >= 1")
	}

	return nil
}

// DSN returns the PostgreSQL connection string.
func (c *Config) DSN() string {
	host := "127.0.0.1"
	if c.Database.Mode == "external" && c.Database.Host != "" {
		host = c.Database.Host
	}
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=disable",
		c.Database.User,
		c.Database.Password,
		host,
		c.Database.Port,
		c.Database.Name,
	)
}

func generatePassword() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	return hex.EncodeToString(b), nil
}
