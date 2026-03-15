// Package remote manages CLI configuration for the Volundr remote client.
// Configuration is stored in $VOLUNDR_HOME/remotes.yaml (or ~/.config/volundr/config.yaml as fallback).
package remote

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const (
	// envHome is the environment variable that overrides the config directory.
	envHome = "VOLUNDR_HOME"
	// remotesFile is the config file name within VOLUNDR_HOME.
	remotesFile = "remotes.yaml"
	// legacyDir is the fallback directory when VOLUNDR_HOME is not set.
	legacyDir = ".config/volundr"
	// legacyFile is the config file name in the legacy directory.
	legacyFile = "config.yaml"
)

// Context represents a single Volundr cluster connection.
type Context struct {
	Name         string `yaml:"name"`
	Server       string `yaml:"server"`
	Token        string `yaml:"token,omitempty"`
	RefreshToken string `yaml:"refresh_token,omitempty"`
	TokenExpiry  string `yaml:"token_expiry,omitempty"`
	Issuer       string `yaml:"issuer,omitempty"`
	ClientID     string `yaml:"client_id,omitempty"`
}

// Config holds all CLI configuration values.
type Config struct {
	Theme    string              `yaml:"theme"`
	Contexts map[string]*Context `yaml:"contexts"`
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Theme:    "dark",
		Contexts: make(map[string]*Context),
	}
}

// ConfigDir returns the configuration directory path.
// It checks VOLUNDR_HOME first, falling back to ~/.config/volundr.
func ConfigDir() (string, error) {
	if dir := os.Getenv(envHome); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, legacyDir), nil
}

// ConfigPath returns the full path to the config file.
// When VOLUNDR_HOME is set, uses $VOLUNDR_HOME/remotes.yaml.
// Otherwise falls back to ~/.config/volundr/config.yaml.
func ConfigPath() (string, error) {
	if dir := os.Getenv(envHome); dir != "" {
		return filepath.Join(dir, remotesFile), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	return filepath.Join(home, legacyDir, legacyFile), nil
}

// legacyConfig represents the old flat config format for migration purposes.
type legacyConfig struct {
	Server       string `yaml:"server"`
	Token        string `yaml:"token"`
	RefreshToken string `yaml:"refresh_token"`
	TokenExpiry  string `yaml:"token_expiry"`
	Issuer       string `yaml:"issuer"`
	ClientID     string `yaml:"client_id"`
	Theme        string `yaml:"theme"`
}

// Load reads configuration from disk, returning defaults if the file doesn't exist.
// It auto-migrates the old flat format to the new multi-context format.
func Load() (*Config, error) {
	path, err := ConfigPath()
	if err != nil {
		return DefaultConfig(), nil //nolint:nilerr // gracefully return defaults when config path cannot be determined
	}

	data, err := os.ReadFile(path) //nolint:gosec // path comes from ConfigPath(), a trusted location
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultConfig(), nil
		}
		return nil, fmt.Errorf("reading config: %w", err)
	}

	// Probe the raw YAML to detect the old flat format.
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	// Old format detection: top-level "server" key means legacy format.
	if _, hasServer := raw["server"]; hasServer {
		return migrateFromLegacy(data)
	}

	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	// Ensure Contexts map is never nil.
	if cfg.Contexts == nil {
		cfg.Contexts = make(map[string]*Context)
	}

	return cfg, nil
}

// migrateFromLegacy converts old flat config bytes into the new multi-context format.
func migrateFromLegacy(data []byte) (*Config, error) {
	var legacy legacyConfig
	if err := yaml.Unmarshal(data, &legacy); err != nil {
		return nil, fmt.Errorf("parsing legacy config: %w", err)
	}

	theme := legacy.Theme
	if theme == "" {
		theme = "dark"
	}

	cfg := &Config{
		Theme:    theme,
		Contexts: make(map[string]*Context),
	}

	ctx := &Context{
		Name:         "default",
		Server:       legacy.Server,
		Token:        legacy.Token,
		RefreshToken: legacy.RefreshToken,
		TokenExpiry:  legacy.TokenExpiry,
		Issuer:       legacy.Issuer,
		ClientID:     legacy.ClientID,
	}

	cfg.Contexts["default"] = ctx
	return cfg, nil
}

// Save writes configuration to disk.
func (c *Config) Save() error {
	path, err := ConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}

	return nil
}

// AddContext adds a new context to the config. It returns an error if the key
// already exists.
func (c *Config) AddContext(key string, ctx *Context) error {
	if _, exists := c.Contexts[key]; exists {
		return fmt.Errorf("context %q already exists", key)
	}
	c.Contexts[key] = ctx
	return nil
}

// RemoveContext removes a context by key. It returns an error if the key does
// not exist.
func (c *Config) RemoveContext(key string) error {
	if _, exists := c.Contexts[key]; !exists {
		return fmt.Errorf("context %q not found", key)
	}
	delete(c.Contexts, key)
	return nil
}

// RenameContext renames a context from oldKey to newKey. It returns an error if
// the old key does not exist or the new key already exists.
func (c *Config) RenameContext(oldKey, newKey string) error {
	ctx, exists := c.Contexts[oldKey]
	if !exists {
		return fmt.Errorf("context %q not found", oldKey)
	}
	if _, exists := c.Contexts[newKey]; exists {
		return fmt.Errorf("context %q already exists", newKey)
	}
	ctx.Name = newKey
	c.Contexts[newKey] = ctx
	delete(c.Contexts, oldKey)
	return nil
}

// GetContext returns the context for the given key, or nil if it doesn't exist.
func (c *Config) GetContext(key string) *Context {
	return c.Contexts[key]
}

// ClearTokens clears all token-related fields for a specific context.
func (c *Config) ClearTokens(key string) error {
	ctx, exists := c.Contexts[key]
	if !exists {
		return fmt.Errorf("context %q not found", key)
	}
	ctx.Token = ""
	ctx.RefreshToken = ""
	ctx.TokenExpiry = ""
	return nil
}

// ResolveContext returns the context to use based on the given key hint.
// If key is empty and there is exactly one context, it returns that one.
// If key is empty and there are zero or multiple contexts, it returns an error.
func (c *Config) ResolveContext(key string) (*Context, string, error) {
	if key != "" {
		ctx := c.GetContext(key)
		if ctx == nil {
			return nil, "", fmt.Errorf("context %q not found", key)
		}
		return ctx, key, nil
	}

	if len(c.Contexts) == 0 {
		return nil, "", fmt.Errorf("no contexts configured — run: volundr context add <name> --server <url>")
	}

	if len(c.Contexts) == 1 {
		for k, ctx := range c.Contexts {
			return ctx, k, nil
		}
	}

	return nil, "", fmt.Errorf("multiple contexts configured — specify one with --context <name>\nAvailable contexts: %s", contextKeys(c))
}

// contextKeys returns a comma-separated list of context keys.
func contextKeys(c *Config) string {
	keys := make([]string, 0, len(c.Contexts))
	for k := range c.Contexts {
		keys = append(keys, k)
	}
	result := ""
	for i, k := range keys {
		if i > 0 {
			result += ", "
		}
		result += k
	}
	return result
}
