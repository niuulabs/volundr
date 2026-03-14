package cli

import (
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestRunDown_NoPIDFile(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	// No PID file, so DownFromPID should error.
	err := runDown(nil, nil)
	if err == nil {
		t.Fatal("expected error when no PID file exists")
	}
}
