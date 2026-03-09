// Package remote manages CLI configuration for the Volundr remote client.
// Configuration is stored in ~/.config/volundr/config.yaml.
package remote

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// Config holds all CLI configuration values.
type Config struct {
	Server       string `yaml:"server"`
	Token        string `yaml:"token"`
	RefreshToken string `yaml:"refresh_token,omitempty"`
	TokenExpiry  string `yaml:"token_expiry,omitempty"`
	Issuer       string `yaml:"issuer,omitempty"`
	ClientID     string `yaml:"client_id,omitempty"`
	Theme        string `yaml:"theme"`
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Server: "http://localhost:8000",
		Theme:  "dark",
	}
}

// ConfigDir returns the configuration directory path.
func ConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, ".config", "volundr"), nil
}

// ConfigPath returns the full path to the config file.
func ConfigPath() (string, error) {
	dir, err := ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// Load reads configuration from disk, returning defaults if the file doesn't exist.
func Load() (*Config, error) {
	path, err := ConfigPath()
	if err != nil {
		return DefaultConfig(), nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultConfig(), nil
		}
		return nil, fmt.Errorf("reading config: %w", err)
	}

	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	return cfg, nil
}

// Save writes configuration to disk.
func (c *Config) Save() error {
	path, err := ConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	return nil
}

// Get retrieves a configuration value by key.
func (c *Config) Get(key string) (string, error) {
	switch key {
	case "server":
		return c.Server, nil
	case "token":
		return c.Token, nil
	case "refresh_token":
		return c.RefreshToken, nil
	case "token_expiry":
		return c.TokenExpiry, nil
	case "issuer":
		return c.Issuer, nil
	case "client_id", "client-id":
		return c.ClientID, nil
	case "theme":
		return c.Theme, nil
	default:
		return "", fmt.Errorf("unknown config key: %s (valid keys: server, token, refresh_token, token_expiry, issuer, client-id, theme)", key)
	}
}

// Set updates a configuration value by key.
func (c *Config) Set(key, value string) error {
	switch key {
	case "server":
		c.Server = value
	case "token":
		c.Token = value
	case "refresh_token":
		c.RefreshToken = value
	case "token_expiry":
		c.TokenExpiry = value
	case "issuer":
		c.Issuer = value
	case "client_id", "client-id":
		c.ClientID = value
	case "theme":
		c.Theme = value
	default:
		return fmt.Errorf("unknown config key: %s (valid keys: server, token, refresh_token, token_expiry, issuer, client-id, theme)", key)
	}
	return nil
}

// ClearTokens removes all token-related fields from the config.
func (c *Config) ClearTokens() {
	c.Token = ""
	c.RefreshToken = ""
	c.TokenExpiry = ""
}
