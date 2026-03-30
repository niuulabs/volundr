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

	if cfg.Runtime != "local" {
		t.Errorf("expected runtime 'local', got %q", cfg.Runtime)
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

	if loaded.Runtime != cfg.Runtime {
		t.Errorf("runtime: expected %q, got %q", cfg.Runtime, loaded.Runtime)
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
			name:    "valid default config",
			modify:  func(_ *Config) {},
			wantErr: false,
		},
		{
			name:    "invalid runtime",
			modify:  func(c *Config) { c.Runtime = "invalid" },
			wantErr: true,
		},
		{
			name:    "invalid listen port zero",
			modify:  func(c *Config) { c.Listen.Port = 0 },
			wantErr: true,
		},
		{
			name:    "invalid listen port too high",
			modify:  func(c *Config) { c.Listen.Port = 70000 },
			wantErr: true,
		},
		{
			name:    "invalid database mode",
			modify:  func(c *Config) { c.Database.Mode = "sqlite" },
			wantErr: true,
		},
		{
			name:    "external db without host",
			modify:  func(c *Config) { c.Database.Mode = "external"; c.Database.Host = "" },
			wantErr: true,
		},
		{
			name: "external db with host",
			modify: func(c *Config) {
				c.Database.Mode = "external"
				c.Database.Host = "db.example.com"
			},
			wantErr: false,
		},
		{
			name:    "docker runtime is valid",
			modify:  func(c *Config) { c.Runtime = "docker" },
			wantErr: false,
		},
		{
			name:    "k3s runtime is valid",
			modify:  func(c *Config) { c.Runtime = "k3s" },
			wantErr: false,
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
	t.Run("uses VOLUNDR_HOME when set", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv(EnvHome, tmpDir)

		dir, err := ConfigDir()
		if err != nil {
			t.Fatalf("ConfigDir() error: %v", err)
		}
		if dir != tmpDir {
			t.Errorf("ConfigDir() = %q, want %q", dir, tmpDir)
		}
	})

	t.Run("falls back to home directory", func(t *testing.T) {
		t.Setenv(EnvHome, "")

		dir, err := ConfigDir()
		if err != nil {
			t.Fatalf("ConfigDir() error: %v", err)
		}

		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatalf("UserHomeDir() error: %v", err)
		}
		expected := filepath.Join(home, DefaultConfigDir)
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
	if loaded.Runtime != "local" {
		t.Errorf("Load() Runtime = %q, want %q", loaded.Runtime, "local")
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
			cfg.Database.Port = tt.port
			if err := cfg.Validate(); err == nil {
				t.Errorf("Validate() expected error for db port %d", tt.port)
			}
		})
	}
}

func TestDefaultConfigWithVOLUNDR_HOME(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(EnvHome, tmpDir)

	cfg, err := DefaultConfig()
	if err != nil {
		t.Fatalf("DefaultConfig() error: %v", err)
	}

	expectedDataDir := filepath.Join(tmpDir, "data", "pg")
	if cfg.Database.DataDir != expectedDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.Database.DataDir, expectedDataDir)
	}

	// Verify Docker defaults.
	if cfg.Docker.Network != "volundr-net" {
		t.Errorf("Docker.Network = %q, want %q", cfg.Docker.Network, "volundr-net")
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
	t.Setenv("HOME", "")

	_, err := ConfigDir()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestConfigPathErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := ConfigPath()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestDefaultConfigErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := DefaultConfig()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestLoadErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestSaveErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
	t.Setenv("HOME", "")

	cfg := &Config{Runtime: "local"}
	if err := cfg.Save(); err == nil {
		t.Error("expected error when HOME is unset")
	}
}

func TestExistsErrorWhenNoHome(t *testing.T) {
	t.Setenv(EnvHome, "")
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

func TestWebEnabled(t *testing.T) {
	t.Run("nil defaults to true", func(t *testing.T) {
		cfg := &Config{}
		if !cfg.WebEnabled() {
			t.Error("expected WebEnabled() to return true when Web is nil")
		}
	})

	t.Run("explicit true", func(t *testing.T) {
		v := true
		cfg := &Config{Web: &v}
		if !cfg.WebEnabled() {
			t.Error("expected WebEnabled() to return true")
		}
	})

	t.Run("explicit false", func(t *testing.T) {
		v := false
		cfg := &Config{Web: &v}
		if cfg.WebEnabled() {
			t.Error("expected WebEnabled() to return false")
		}
	})

	t.Run("default config has web enabled", func(t *testing.T) {
		cfg, err := DefaultConfig()
		if err != nil {
			t.Fatalf("DefaultConfig() error: %v", err)
		}
		if !cfg.WebEnabled() {
			t.Error("expected default config to have web enabled")
		}
	})
}

func TestWebEnabledRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("explicit false survives save/load", func(t *testing.T) {
		path := filepath.Join(tmpDir, "web-false.yaml")
		cfg, _ := DefaultConfig()
		v := false
		cfg.Web = &v
		if err := cfg.SaveTo(path); err != nil {
			t.Fatalf("SaveTo() error: %v", err)
		}
		loaded, err := LoadFrom(path)
		if err != nil {
			t.Fatalf("LoadFrom() error: %v", err)
		}
		if loaded.WebEnabled() {
			t.Error("expected loaded config to have web disabled")
		}
	})

	t.Run("missing web field defaults to enabled", func(t *testing.T) {
		path := filepath.Join(tmpDir, "no-web.yaml")
		yaml := "runtime: local\nlisten:\n  host: 127.0.0.1\n  port: 8080\ndatabase:\n  mode: embedded\n  port: 5433\n  user: volundr\n  password: test\n  name: volundr\n"
		if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
			t.Fatalf("write: %v", err)
		}
		loaded, err := LoadFrom(path)
		if err != nil {
			t.Fatalf("LoadFrom() error: %v", err)
		}
		if !loaded.WebEnabled() {
			t.Error("expected config without web field to default to enabled")
		}
	})
}

func TestK3sConfig_TyrImage(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "config.yaml")

	cfg := &Config{
		Runtime: "k3s",
		Listen:  ListenConfig{Host: "127.0.0.1", Port: 8080},
		Database: DatabaseConfig{
			Mode:     "embedded",
			Port:     5433,
			User:     "volundr",
			Password: "test",
			Name:     "volundr",
		},
		K3s: K3sConfig{
			Namespace: "volundr",
			Provider:  "k3d",
			TyrImage:  "ghcr.io/niuulabs/tyr:v1.0.0",
		},
		Tyr: TyrConfig{Enabled: true},
	}

	if err := cfg.SaveTo(path); err != nil {
		t.Fatalf("SaveTo() error: %v", err)
	}

	loaded, err := LoadFrom(path)
	if err != nil {
		t.Fatalf("LoadFrom() error: %v", err)
	}

	if loaded.K3s.TyrImage != "ghcr.io/niuulabs/tyr:v1.0.0" {
		t.Errorf("expected tyr_image ghcr.io/niuulabs/tyr:v1.0.0, got %s", loaded.K3s.TyrImage)
	}
	if !loaded.TyrEnabled() {
		t.Error("expected tyr to be enabled")
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
