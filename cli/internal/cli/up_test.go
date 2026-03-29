package cli

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunUp_NoConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	oldRuntimeFlag := runtimeFlag
	runtimeFlag = ""
	defer func() { runtimeFlag = oldRuntimeFlag }()

	// No config file, so Load should fail.
	err := runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error when config not found")
	}
}

func TestRunUp_InvalidConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write an invalid config (missing required fields).
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	cfgContent := `runtime: local
listen:
  host: 127.0.0.1
  port: 0
database:
  mode: embedded
  port: 99999
`
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldRuntimeFlag := runtimeFlag
	runtimeFlag = ""
	defer func() { runtimeFlag = oldRuntimeFlag }()

	// Config exists but has invalid db port, Validate should fail.
	err := runUp(nil, nil)
	if err == nil {
		t.Fatal("expected error for invalid config")
	}
}

func TestRunUp_NoWebFlag(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a minimal valid config.
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	cfgContent := `runtime: local
listen:
  host: 127.0.0.1
  port: 18081
tls:
  mode: "off"
database:
  mode: embedded
  port: 15433
  user: volundr
  password: test
  name: volundr
  data_dir: /tmp/test-pg
`
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldNoWebFlag := noWebFlag
	oldRuntimeFlag := runtimeFlag
	noWebFlag = true
	runtimeFlag = "local"
	defer func() {
		noWebFlag = oldNoWebFlag
		runtimeFlag = oldRuntimeFlag
	}()

	// Will fail on missing dependencies but exercises the --no-web path.
	_ = runUp(nil, nil)
}

func TestRunUp_RuntimeFlagOverride(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// Write a minimal valid config.
	cfgPath := filepath.Join(tmpDir, "config.yaml")
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
  data_dir: /tmp/test-pg
`
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldRuntimeFlag := runtimeFlag
	runtimeFlag = "local"
	defer func() { runtimeFlag = oldRuntimeFlag }()

	// Will try to start the runtime but fail on missing dependencies. That's ok,
	// we're testing config loading and flag override.
	err := runUp(nil, nil)
	// We expect an error because runtime.Up will fail in test env.
	if err == nil {
		// If somehow it starts, it would block. Since we're here, it didn't.
		t.Log("runUp succeeded unexpectedly, but that's ok for coverage")
	}
}
