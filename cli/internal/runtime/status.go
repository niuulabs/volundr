package runtime

import (
	"context"
	"fmt"

	"github.com/niuulabs/volundr/cli/internal/config"
)

// effectiveMaxSessions returns the configured max or the default when unset.
func effectiveMaxSessions(max int) int {
	if max > 0 {
		return max
	}
	return config.DefaultMaxSessions
}

// RichStatus holds the full status of the Volundr stack, including
// server info, session details, and component status.
type RichStatus struct {
	Mode     string          `json:"mode"`
	Server   ComponentStatus `json:"server"`
	WebUI    string          `json:"web_ui,omitempty"`
	Tyr      *ComponentStatus `json:"tyr,omitempty"`
	Database ComponentStatus `json:"database"`
	Sessions SessionSummary  `json:"sessions"`

	// K3s-specific fields.
	Cluster *ClusterStatus `json:"cluster,omitempty"`
	Proxy   string         `json:"proxy,omitempty"`
	Pods    []PodStatus    `json:"pods,omitempty"`
}

// ComponentStatus describes the status of a single component (server, db, tyr).
type ComponentStatus struct {
	Status  string `json:"status"`
	Address string `json:"address,omitempty"`
	PID     int    `json:"pid,omitempty"`
	Port    int    `json:"port,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

// databaseStatus returns a ComponentStatus for the database from config.
func databaseStatus(cfg *config.Config) ComponentStatus {
	if cfg.Database.Mode == "embedded" {
		return ComponentStatus{
			Status: "running",
			Detail: fmt.Sprintf("embedded PostgreSQL on port %d", cfg.Database.Port),
			Port:   cfg.Database.Port,
		}
	}
	return ComponentStatus{
		Status: "running",
		Detail: fmt.Sprintf("external PostgreSQL at %s:%d", cfg.Database.Host, cfg.Database.Port),
		Port:   cfg.Database.Port,
	}
}

// buildSessionSummary fetches sessions from the API and returns a summary.
func buildSessionSummary(ctx context.Context, listenAddr string, maxSessions int) SessionSummary {
	baseURL := fmt.Sprintf("http://%s", listenAddr)
	sessions, _ := fetchSessions(ctx, baseURL)
	if sessions == nil {
		sessions = []SessionInfo{}
	}
	return SessionSummary{
		Active: countActiveSessions(sessions),
		Max:    effectiveMaxSessions(maxSessions),
		List:   sessions,
	}
}

// SessionSummary holds aggregate session counts and the list of sessions.
type SessionSummary struct {
	Active int             `json:"active"`
	Max    int             `json:"max"`
	List   []SessionInfo   `json:"list"`
}

// SessionInfo holds details about a single session.
type SessionInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Model     string `json:"model"`
	Repo      string `json:"repo,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
}

// ClusterStatus holds k3s/k3d cluster information.
type ClusterStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// PodStatus holds status for a Kubernetes pod.
type PodStatus struct {
	Name   string `json:"name"`
	Ready  string `json:"ready"`
	Status string `json:"status"`
	Age    string `json:"age,omitempty"`
}
