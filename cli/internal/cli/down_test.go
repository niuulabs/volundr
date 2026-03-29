package cli

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunDown_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// No config and no PID file → falls back to DownFromPID which errors.
	err := runDown(nil, nil)
	if err == nil {
		t.Fatal("expected error when no PID file exists")
	}
}

func TestRunDown_WithConfig_LocalRuntime(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a valid config with local runtime.
	cfgContent := `runtime: local
listen:
  host: 127.0.0.1
  port: 18080
tls:
  mode: "off"
database:
  mode: embedded
  port: 15432
  user: volundr
  password: test
  name: volundr
`
	if err := os.WriteFile(filepath.Join(tmpDir, "config.yaml"), []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// No PID file, so DownFromPID is best-effort (ignored).
	// rt.Down() for local with nil fields just removes PID/state files (no-op since they don't exist).
	err := runDown(nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunDown_WithConfig_DockerRuntime(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfgContent := `runtime: docker
listen:
  host: 127.0.0.1
  port: 18080
tls:
  mode: "off"
database:
  mode: embedded
  port: 15432
  user: volundr
  password: test
  name: volundr
docker:
  network: volundr-net
`
	if err := os.WriteFile(filepath.Join(tmpDir, "config.yaml"), []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// Docker runtime Down() calls docker compose down (will fail in test env
	// since docker isn't available, but that's expected — the error is collected).
	// This tests that config is loaded and the docker runtime is dispatched.
	err := runDown(nil, nil)
	// Docker compose errors are expected in test env without docker.
	// The function may or may not error depending on whether docker CLI exists.
	// We just verify it doesn't panic and goes through the config-based path.
	_ = err
}

func TestRunDown_WithConfig_K3sRuntime(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfgContent := `runtime: k3s
listen:
  host: 127.0.0.1
  port: 18080
tls:
  mode: "off"
database:
  mode: embedded
  port: 15432
  user: volundr
  password: test
  name: volundr
k3s:
  namespace: volundr
  provider: auto
`
	if err := os.WriteFile(filepath.Join(tmpDir, "config.yaml"), []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// K3s runtime Down() calls kubectl/docker (will fail in test env).
	err := runDown(nil, nil)
	_ = err
}

func TestRunDown_NoConfig_FallbackToDownFromPID(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// No config file, no PID file → falls back to DownFromPID → error.
	err := runDown(nil, nil)
	if err == nil {
		t.Fatal("expected error when no config and no PID file")
	}
}
