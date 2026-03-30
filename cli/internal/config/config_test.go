package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	if cfg.Volundr.Mode != "mini" {
		t.Errorf("expected mode 'mini', got %q", cfg.Volundr.Mode)
	}
	if !cfg.Volundr.Web {
		t.Error("expected web=true by default")
	}
	if cfg.Volundr.Forge.MaxConcurrent != 4 {
		t.Errorf("expected forge max_concurrent 4, got %d", cfg.Volundr.Forge.MaxConcurrent)
	}
	if cfg.Listen.Host != DefaultListenHost {
		t.Errorf("expected listen host %q, got %q", DefaultListenHost, cfg.Listen.Host)
	}
	if cfg.Listen.Port != DefaultListenPort {
		t.Errorf("expected listen port %d, got %d", DefaultListenPort, cfg.Listen.Port)
	}
	if cfg.Database.Mode != "embedded" {
		t.Errorf("expected database mode 'embedded', got %q", cfg.Database.Mode)
	}
	if cfg.Database.Port != DefaultDBPort {
		t.Errorf("expected database port %d, got %d", DefaultDBPort, cfg.Database.Port)
	}
	if cfg.Database.User != DefaultDBUser {
		t.Errorf("expected database user %q, got %q", DefaultDBUser, cfg.Database.User)
	}
	if cfg.Database.Name != DefaultDBName {
		t.Errorf("expected database name %q, got %q", DefaultDBName, cfg.Database.Name)
	}
	if cfg.Database.Password == "" {
		t.Error("expected generated password, got empty string")
	}
	if cfg.TLS.Mode != "off" {
		t.Errorf("expected TLS mode 'off', got %q", cfg.TLS.Mode)
	}
}

func TestConfigSaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	cfg.Anthropic.APIKey = "sk-ant-test"
	cfg.Database.DataDir = filepath.Join(tmpDir, "data", "pg")

	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("SaveTo() error: %v", err)
	}

	loaded, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom() error: %v", err)
	}

	if loaded.Volundr.Mode != cfg.Volundr.Mode {
		t.Errorf("mode: expected %q, got %q", cfg.Volundr.Mode, loaded.Volundr.Mode)
	}
	if loaded.Listen.Port != cfg.Listen.Port {
		t.Errorf("listen port: expected %d, got %d", cfg.Listen.Port, loaded.Listen.Port)
	}
	if loaded.Database.Mode != cfg.Database.Mode {
		t.Errorf("database mode: expected %q, got %q", cfg.Database.Mode, loaded.Database.Mode)
	}
	if loaded.Database.Password != cfg.Database.Password {
		t.Errorf("database password mismatch")
	}
	if loaded.Anthropic.APIKey != cfg.Anthropic.APIKey {
		t.Errorf("anthropic api key: expected %q, got %q", cfg.Anthropic.APIKey, loaded.Anthropic.APIKey)
	}
}

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		modify  func(*Config)
		wantErr bool
	}{
		{
			name:    "valid default config (mini)",
			modify:  func(_ *Config) {},
			wantErr: false,
		},
		{
			name:    "invalid mode",
			modify:  func(c *Config) { c.Volundr.Mode = "invalid" },
			wantErr: true,
		},
		{
			name: "k3s mode with invalid listen port",
			modify: func(c *Config) {
				c.Volundr.Mode = "k3s"
				c.Listen.Port = 0
			},
			wantErr: true,
		},
		{
			name: "k3s mode with invalid database mode",
			modify: func(c *Config) {
				c.Volundr.Mode = "k3s"
				c.Database.Mode = "sqlite"
			},
			wantErr: true,
		},
		{
			name: "k3s mode external db without host",
			modify: func(c *Config) {
				c.Volundr.Mode = "k3s"
				c.Database.Mode = "external"
				c.Database.Host = ""
			},
			wantErr: true,
		},
		{
			name: "k3s mode external db with host",
			modify: func(c *Config) {
				c.Volundr.Mode = "k3s"
				c.Database.Mode = "external"
				c.Database.Host = "db.example.com"
			},
			wantErr: false,
		},
		{
			name:    "docker mode is invalid",
			modify:  func(c *Config) { c.Volundr.Mode = "docker" },
			wantErr: true,
		},
		{
			name:    "k3s mode is valid",
			modify:  func(c *Config) { c.Volundr.Mode = "k3s" },
			wantErr: false,
		},
		{
			name: "mini mode with zero max_concurrent",
			modify: func(c *Config) {
				c.Volundr.Forge.MaxConcurrent = 0
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := DefaultConfig()
			if err != nil {
				t.Fatalf("DefaultConfig() error: %v", err)
			}
			tt.modify(cfg)
			err = cfg.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestConfigDSN(t *testing.T) {
	cfg := &Config{
		Database: DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "secret",
			Name:     "volundr",
		},
	}

	expected := "postgres://volundr:secret@127.0.0.1:5433/volundr?sslmode=disable" //nolint:gosec // test fixture, not real credentials
	if got := cfg.DSN(); got != expected {
		t.Errorf("DSN() = %q, want %q", got, expected)
	}

	// External mode with host.
	cfg.Database.Mode = "external"
	cfg.Database.Host = "db.example.com"
	cfg.Database.Port = 5432
	expected = "postgres://volundr:secret@db.example.com:5432/volundr?sslmode=disable" //nolint:gosec // test fixture, not real credentials
	if got := cfg.DSN(); got != expected {
		t.Errorf("DSN() = %q, want %q", got, expected)
	}
}

func TestLoadFromNonExistent(t *testing.T) {
	_, err := LoadFrom("/nonexistent/path/config.yaml")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestConfigFilePermissions(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("SaveTo() error: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat() error: %v", err)
	}

	perm := info.Mode().Perm()
	if perm != 0o600 {
		t.Errorf("expected file permissions 0600, got %o", perm)
	}
}

func TestGeneratePassword(t *testing.T) {
	p1, err := generatePassword()
	if err != nil {
		t.Fatalf("generatePassword() error: %v", err)
	}
	p2, err := generatePassword()
	if err != nil {
		t.Fatalf("generatePassword() error: %v", err)
	}

	if p1 == p2 {
		t.Error("expected unique passwords, got identical")
	}
	if len(p1) != 32 {
		t.Errorf("expected 32-char hex password, got %d chars", len(p1))
	}
}

func TestConfigDir(t *testing.T) {
	t.Run("uses NIUU_HOME when set", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)
		t.Setenv(LegacyEnvHome, "")

		dir, err := ConfigDir()
		if err != nil {
			t.Fatalf("ConfigDir() error: %v", err)
		}
		if dir != tmpDir {
			t.Errorf("ConfigDir() = %q, want %q", dir, tmpDir)
		}
	})

	t.Run("falls back to VOLUNDR_HOME", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, "")
		t.Setenv(LegacyEnvHome, tmpDir)

		dir, err := ConfigDir()
		if err != nil {
			t.Fatalf("ConfigDir() error: %v", err)
		}
		if dir != tmpDir {
			t.Errorf("ConfigDir() = %q, want %q", dir, tmpDir)
		}
	})

	t.Run("falls back to home directory", func(t *testing.T) {
		// Use a clean temp dir as HOME so neither .niuu nor .volundr exist,
		// ensuring ConfigDir returns the new default path.
		tmpHome := t.TempDir()
		t.Setenv("HOME", tmpHome)
		t.Setenv(EnvHome, "")
		t.Setenv(LegacyEnvHome, "")

		dir, err := ConfigDir()
		if err != nil {
			t.Fatalf("ConfigDir() error: %v", err)
		}

		expected := filepath.Join(tmpHome, DefaultConfigDir)
		if dir != expected {
			t.Errorf("ConfigDir() = %q, want %q", dir, expected)
		}
	})
}

func TestConfigPath(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)

	path, err := ConfigPath()
	if err != nil {
		t.Fatalf("ConfigPath() error: %v", err)
	}

	expected := filepath.Join(tmpDir, DefaultConfigFile)
	if path != expected {
		t.Errorf("ConfigPath() = %q, want %q", path, expected)
	}
}

func TestLoadAndSaveViaDefaults(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}
	cfg.Anthropic.APIKey = "sk-ant-roundtrip"

	if err := cfg.Save(); err != nil {
		t.Fatalf("Save() error: %v", err)
	}

	loaded, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if loaded.Anthropic.APIKey != "sk-ant-roundtrip" {
		t.Errorf("Load() APIKey = %q, want %q", loaded.Anthropic.APIKey, "sk-ant-roundtrip")
	}
	if loaded.Volundr.Mode != "mini" {
		t.Errorf("Load() Mode = %q, want %q", loaded.Volundr.Mode, "mini")
	}
}

func TestExists(t *testing.T) {
	t.Run("returns false when config does not exist", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)

		exists, err := Exists()
		if err != nil {
			t.Fatalf("Exists() error: %v", err)
		}
		if exists {
			t.Error("Exists() = true, want false")
		}
	})

	t.Run("returns true when config exists", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)

		cfg, err := DefaultConfig()
		if err != nil {
			t.Fatalf("DefaultConfig() error: %v", err)
		}
		if err := cfg.Save(); err != nil {
			t.Fatalf("Save() error: %v", err)
		}

		exists, err := Exists()
		if err != nil {
			t.Fatalf("Exists() error: %v", err)
		}
		if !exists {
			t.Error("Exists() = false, want true")
		}
	})
}

func TestLoadFromInvalidYAML(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "bad.yaml")

	// Use a YAML document with a mapping value where a scalar is expected to
	// trigger an unmarshal error into the Config struct.
	if err := os.WriteFile(path, []byte("runtime:\n  - :\n  :\n\t"), 0o600); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	_, err := LoadFrom(path)
	if err == nil {
		t.Error("expected error for invalid YAML")
	}
}

func TestValidateDBPortOutOfRange(t *testing.T) {
	tests := []struct {
		name string
		port int
	}{
		{"db port zero", 0},
		{"db port negative", -1},
		{"db port too high", 70000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := DefaultConfig()
			if err != nil {
				t.Fatalf("DefaultConfig() error: %v", err)
			}
			cfg.Volundr.Mode = "k3s"
			cfg.Database.Port = tt.port
			if err := cfg.Validate(); err == nil {
				t.Errorf("Validate() expected error for db port %d", tt.port)
			}
		})
	}
}

func TestDefaultConfigWithNIUU_HOME(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)
	t.Setenv(LegacyEnvHome, "")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	expectedDataDir := filepath.Join(tmpDir, "data", "pg")
	if cfg.Database.DataDir != expectedDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.Database.DataDir, expectedDataDir)
	}

	if cfg.K3s.Provider != "auto" {
		t.Errorf("K3s.Provider = %q, want %q", cfg.K3s.Provider, "auto")
	}
	if cfg.K3s.Namespace != "volundr" {
		t.Errorf("K3s.Namespace = %q, want %q", cfg.K3s.Namespace, "volundr")
	}
}

func TestConfigDirErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	_, err := ConfigDir()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestConfigPathErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	_, err := ConfigPath()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestDefaultConfigErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	_, err := DefaultConfig()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestLoadErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestSaveErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	cfg := &Config{Volundr: VolundrConfig{Mode: "mini"}}
	if err := cfg.Save(); err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestExistsErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv(LegacyEnvHome, "")
	t.Setenv("HOME", "")

	_, err := Exists()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestSaveToReadOnlyDir(t *testing.T) {
	tmpDir := t.TempDir()
	readOnly := filepath.Join(tmpDir, "readonly")
	if err := os.Mkdir(readOnly, 0o500); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(readOnly, 0o700) }) //nolint:gosec // restoring permissions for cleanup

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	nested := filepath.Join(readOnly, "sub", "config.yaml")
	if err := cfg.SaveTo(nested); err == nil {
		t.Error("expected error saving to read-only directory")
	}
}

func TestMigrateLegacyRuntime(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	// Write a config with the legacy "runtime" field.
	content := `runtime: local
listen:
  host: "127.0.0.1"
  port: 8080
database:
  mode: embedded
  port: 5433
  user: volundr
  password: test
  name: volundr
tls:
  mode: "off"
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}

	if cfg.Volundr.Mode != "mini" {
		t.Errorf("expected mode 'mini' after migration from runtime 'local', got %q", cfg.Volundr.Mode)
	}
}

func TestMigrateLegacyRuntimeK3s(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	content := `runtime: k3s
listen:
  host: "127.0.0.1"
  port: 8080
database:
  mode: embedded
  port: 5433
  user: volundr
  password: test
  name: volundr
tls:
  mode: "off"
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}

	if cfg.Volundr.Mode != "k3s" {
		t.Errorf("expected mode 'k3s' after migration, got %q", cfg.Volundr.Mode)
	}
}

func TestSaveToCreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	nested := filepath.Join(tmpDir, "a", "b", "c", "config.yaml")

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	if err := cfg.SaveTo(nested); err != nil {
		t.Fatalf("SaveTo() error: %v", err)
	}

	if _, err := os.Stat(nested); err != nil {
		t.Errorf("expected file to exist at %s", nested)
	}
}

func TestDefaultConfig_TyrDefaults(t *testing.T) {
	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	if cfg.K3s.TyrImage != "ghcr.io/niuulabs/tyr:latest" {
		t.Errorf("expected tyr_image 'ghcr.io/niuulabs/tyr:latest', got %q", cfg.K3s.TyrImage)
	}
	if !cfg.K3s.TyrEnabled {
		t.Error("expected tyr_enabled to be true by default")
	}
}

func TestK3sConfig_TyrFieldsRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg := &Config{
		Volundr: VolundrConfig{Mode: "k3s"},
		Listen:  ListenConfig{Host: "127.0.0.1", Port: 8080},
		Database: DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
		K3s: K3sConfig{
			TyrImage:   "ghcr.io/niuulabs/tyr:v2.0",
			TyrEnabled: true,
		},
	}

	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}

	loaded, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}

	if loaded.K3s.TyrImage != "ghcr.io/niuulabs/tyr:v2.0" {
		t.Errorf("expected tyr_image 'ghcr.io/niuulabs/tyr:v2.0', got %q", loaded.K3s.TyrImage)
	}
	if !loaded.K3s.TyrEnabled {
		t.Error("expected tyr_enabled to persist as true")
	}
}

func TestK3sConfig_TyrDisabledRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg := &Config{
		Volundr: VolundrConfig{Mode: "k3s"},
		Listen:  ListenConfig{Host: "127.0.0.1", Port: 8080},
		Database: DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
		K3s: K3sConfig{
			TyrEnabled: false,
		},
	}

	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("SaveTo: %v", err)
	}

	loaded, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom: %v", err)
	}

	if loaded.K3s.TyrEnabled {
		t.Error("expected tyr_enabled to persist as false")
	}
}
