// Package config manages the ~/.volundr/config.yaml configuration file.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const (
	// EnvHome is the environment variable that overrides the config directory.
	EnvHome = "VOLUNDR_HOME"
	// DefaultConfigDir is the default directory for volundr configuration.
	DefaultConfigDir = ".volundr"
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

// DockerConfig holds Docker runtime settings.
type DockerConfig struct {
	APIImage        string `yaml:"api_image"`
	SkuldImage      string `yaml:"skuld_image"`
	CodeServerImage string `yaml:"code_server_image"`
	RehImage        string `yaml:"reh_image"`
	TtydImage       string `yaml:"ttyd_image"`
	Network         string `yaml:"network"`
}

// K3sConfig holds k3s/k3d runtime settings.
type K3sConfig struct {
	Kubeconfig string `yaml:"kubeconfig"` // default: auto-detect
	Namespace  string `yaml:"namespace"`  // default: volundr
	Provider   string `yaml:"provider"`   // "auto", "k3d", "native" (default: auto)
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

// Config represents the full volundr configuration.
type Config struct {
	Runtime     string            `yaml:"runtime"`
	Listen      ListenConfig      `yaml:"listen"`
	TLS         TLSConfig         `yaml:"tls"`
	Database    DatabaseConfig    `yaml:"database"`
	Anthropic   AnthropicConfig   `yaml:"anthropic"`
	Git         GitConfig         `yaml:"git,omitempty"`
	Docker      DockerConfig      `yaml:"docker,omitempty"`
	K3s         K3sConfig         `yaml:"k3s,omitempty"`
	LocalMounts LocalMountsConfig `yaml:"local_mounts,omitempty"`
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

// ConfigDir returns the path to the volundr config directory.
// It checks VOLUNDR_HOME first, falling back to ~/.volundr.
func ConfigDir() (string, error) { //nolint:revive // used as config.ConfigDir externally
	if dir := os.Getenv(EnvHome); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home directory: %w", err)
	}
	return filepath.Join(home, DefaultConfigDir), nil
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
		Runtime: "local",
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
		Docker: DockerConfig{
			APIImage:        "ghcr.io/niuulabs/volundr-api:latest",
			SkuldImage:      "ghcr.io/niuulabs/skuld:latest",
			CodeServerImage: "codercom/code-server:latest",
			RehImage:        "ghcr.io/niuulabs/vscode-reh:latest",
			TtydImage:       "ghcr.io/niuulabs/ttyd:latest",
			Network:         "volundr-net",
		},
		K3s: K3sConfig{
			Kubeconfig: "",
			Namespace:  "volundr",
			Provider:   "auto",
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

	return &cfg, nil
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
	if c.Runtime != "local" && c.Runtime != "docker" && c.Runtime != "k3s" {
		return fmt.Errorf("invalid runtime %q: must be local, docker, or k3s", c.Runtime)
	}

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
