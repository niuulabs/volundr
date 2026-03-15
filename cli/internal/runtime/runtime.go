// Package runtime defines the Runtime interface and shared types for
// managing the Volundr stack lifecycle.
package runtime

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/niuulabs/volundr/cli/internal/config"
)

// ServiceState represents the state of a managed service.
type ServiceState string

const (
	// StateRunning indicates the service is running.
	StateRunning ServiceState = "running"
	// StateStopped indicates the service is stopped.
	StateStopped ServiceState = "stopped"
	// StateError indicates the service is in an error state.
	StateError ServiceState = "error"
	// StateStarting indicates the service is starting up.
	StateStarting ServiceState = "starting"
)

// ServiceStatus holds the status of a single service.
type ServiceStatus struct {
	Name  string       `json:"name"`
	State ServiceState `json:"state"`
	PID   int          `json:"pid,omitempty"`
	Port  int          `json:"port,omitempty"`
	Error string       `json:"error,omitempty"`
}

// StackStatus holds the status of all services.
type StackStatus struct {
	Runtime  string          `json:"runtime"`
	Services []ServiceStatus `json:"services"`
}

// buildGitConfig converts the CLI git config into the map structure
// expected by the Python API's config YAML.
func buildGitConfig(cfg *config.Config) map[string]interface{} {
	git := map[string]interface{}{}

	if cfg.Git.GitHub.Enabled {
		gh := map[string]interface{}{
			"enabled": true,
		}

		if len(cfg.Git.GitHub.Instances) > 0 {
			instances := make([]map[string]interface{}, 0, len(cfg.Git.GitHub.Instances))
			for _, inst := range cfg.Git.GitHub.Instances {
				m := map[string]interface{}{
					"name":     inst.Name,
					"base_url": inst.BaseURL,
				}
				if inst.Token != "" {
					m["token"] = inst.Token
				}
				if inst.TokenEnv != "" {
					m["token_env"] = inst.TokenEnv
				}
				if len(inst.Orgs) > 0 {
					m["orgs"] = inst.Orgs
				}
				instances = append(instances, m)
			}
			gh["instances"] = instances
		}

		git["github"] = gh
	}

	return git
}

// containerUID and containerGID are the user/group IDs of the volundr
// user inside the API container image.
const (
	containerUID = 1001
	containerGID = 1001
)

// ensureContainerStorageDirs creates directories that the API container
// writes to and chowns them to the container user (UID 1001). The config
// dir itself needs 0o755 so the container can traverse to its mounted files.
func ensureContainerStorageDirs(cfgDir string) error {
	// Config dir must be traversable by the container user.
	if err := os.Chmod(cfgDir, 0o755); err != nil { //nolint:gosec // container user needs to traverse config dir
		return fmt.Errorf("chmod config dir: %w", err)
	}

	// Directories the container writes to — owned by the container user
	// with 0o755 so only that user can write. If chown fails (e.g. not
	// running as root), fall back to 0o777.
	//
	// data/ is included because the API creates subdirs like data/home/
	// at runtime. data/pg/ (Postgres) is host-side and already exists
	// with 0o700 — chown won't recurse into it.
	writableDirs := []string{
		filepath.Join(cfgDir, "data"),
		filepath.Join(cfgDir, "data", "workspaces"),
		filepath.Join(cfgDir, "sessions"),
		filepath.Join(cfgDir, "user-credentials"),
	}
	for _, dir := range writableDirs {
		if err := os.MkdirAll(dir, 0o750); err != nil { //nolint:gosec // container user needs access to storage dirs
			return fmt.Errorf("create directory %s: %w", dir, err)
		}
		if err := os.Chown(dir, containerUID, containerGID); err != nil {
			// Not root — can't chown, use world-writable as fallback.
			if err := os.Chmod(dir, 0o777); err != nil { //nolint:gosec // fallback when chown unavailable
				return fmt.Errorf("chmod directory %s: %w", dir, err)
			}
		} else {
			if err := os.Chmod(dir, 0o750); err != nil { //nolint:gosec // container user needs access to storage dirs
				return fmt.Errorf("chmod directory %s: %w", dir, err)
			}
		}
	}

	return nil
}

// Runtime manages the Volundr stack lifecycle.
type Runtime interface {
	// Init performs first-time setup (create dirs, download binaries, etc.).
	Init(ctx context.Context, cfg *config.Config) error

	// Up starts all services.
	Up(ctx context.Context, cfg *config.Config) error

	// Down stops all services gracefully.
	Down(ctx context.Context) error

	// Status returns the state of each service.
	Status(ctx context.Context) (*StackStatus, error)

	// Logs streams logs for a service.
	Logs(ctx context.Context, service string, follow bool) (io.ReadCloser, error)
}
