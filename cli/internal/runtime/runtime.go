// Package runtime defines the Runtime interface and shared types for
// managing the Volundr stack lifecycle.
package runtime

import (
	"context"
	"io"

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
