package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/niuulabs/volundr/cli/internal/config"
)

const (
	// PIDFile is the name of the PID file for the running instance.
	PIDFile = "volundr.pid"
	// StateFile holds the current service state as JSON.
	StateFile = "state.json"
)

// CheckNotRunning verifies no other Volundr instance is already running.
// It returns nil if no instance is running, or an error if one is.
func CheckNotRunning() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return fmt.Errorf("get config dir: %w", err)
	}

	pidPath := filepath.Join(cfgDir, PIDFile)
	data, err := os.ReadFile(pidPath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read PID file: %w", err)
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		// Invalid PID file, remove it.
		_ = os.Remove(pidPath)
		return nil //nolint:nilerr // corrupt PID file means no instance running
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(pidPath)
		return nil //nolint:nilerr // process not found means no instance running
	}

	if err := proc.Signal(syscall.Signal(0)); err != nil {
		// Process is dead, clean up stale PID file.
		_ = os.Remove(pidPath)
		return nil //nolint:nilerr // signal failure means process is dead
	}

	return fmt.Errorf("volundr is already running (PID %d)", pid)
}

// WritePIDFile writes the current process ID to the PID file.
func WritePIDFile() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}

	pidPath := filepath.Join(cfgDir, PIDFile)
	return os.WriteFile(pidPath, []byte(strconv.Itoa(os.Getpid())), 0o600)
}

// RemovePIDFile removes the PID file.
func RemovePIDFile() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(cfgDir, PIDFile))
}

// WriteStateFile writes the given service statuses to the state file as JSON.
func WriteStateFile(services []ServiceStatus) error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(services, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}

	stateFilePath := filepath.Join(cfgDir, StateFile)
	return os.WriteFile(stateFilePath, data, 0o600)
}

// checkPIDFile reads the PID file from the given config directory and
// verifies the process is alive. Returns (pid, true) if running, (0, false)
// if stopped or the PID file is missing/stale.
func checkPIDFile(cfgDir string) (int, bool) {
	pidPath := filepath.Join(cfgDir, PIDFile)
	data, err := os.ReadFile(pidPath) //nolint:gosec // path derived from trusted config directory
	if err != nil {
		return 0, false
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		_ = os.Remove(pidPath)
		return 0, false
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		_ = os.Remove(pidPath)
		return 0, false
	}

	if err := proc.Signal(syscall.Signal(0)); err != nil {
		_ = os.Remove(pidPath)
		return 0, false
	}

	return pid, true
}

// RemoveStateFile removes the state file.
func RemoveStateFile() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(cfgDir, StateFile))
}
