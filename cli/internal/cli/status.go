package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show status of Volundr services",
	Long:  `Displays the current state of all Volundr services including sessions.`,
	RunE:  runStatus,
}

func runStatus(_ *cobra.Command, _ []string) error {
	cfg, err := config.Load()
	if err != nil {
		// Config not available — fall back to state file for basic info.
		return runStatusFallback()
	}

	ctx := context.Background()
	rt := runtime.NewRuntime(cfg.Runtime)
	rs, err := rt.RichStatus(ctx, cfg)
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}

	if jsonOutput {
		return printJSON(rs)
	}

	printRichStatus(rs)
	return nil
}

// runStatusFallback handles the case where config is not available.
func runStatusFallback() error {
	status, err := runtime.StatusFromStateFile()
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}

	if jsonOutput {
		return printJSON(status)
	}

	fmt.Printf("Runtime: %s\n\n", status.Runtime)
	fmt.Printf("%-15s %-10s %-8s %-6s %s\n", "SERVICE", "STATE", "PID", "PORT", "ERROR")
	fmt.Printf("%-15s %-10s %-8s %-6s %s\n", "-------", "-----", "---", "----", "-----")

	for _, svc := range status.Services {
		pid := ""
		if svc.PID > 0 {
			pid = fmt.Sprintf("%d", svc.PID)
		}
		port := ""
		if svc.Port > 0 {
			port = fmt.Sprintf("%d", svc.Port)
		}
		fmt.Printf("%-15s %-10s %-8s %-6s %s\n",
			svc.Name, svc.State, pid, port, svc.Error)
	}
	return nil
}

// printRichStatus formats and prints the rich status to stdout.
func printRichStatus(rs *runtime.RichStatus) {
	fmt.Printf("Volundr (%s mode)\n", rs.Mode)

	// Server.
	if rs.Server.PID > 0 {
		fmt.Printf("  Server:     %s on %s (PID %d)\n", rs.Server.Status, rs.Server.Address, rs.Server.PID)
	} else if rs.Server.Detail != "" {
		fmt.Printf("  Server:     %s (%s)\n", rs.Server.Status, rs.Server.Detail)
	} else if rs.Server.Address != "" {
		fmt.Printf("  Server:     %s on %s\n", rs.Server.Status, rs.Server.Address)
	} else {
		fmt.Printf("  Server:     %s\n", rs.Server.Status)
	}

	// Web UI.
	if rs.WebUI != "" {
		fmt.Printf("  Web UI:     %s\n", rs.WebUI)
	}

	// Cluster (k3s only).
	if rs.Cluster != nil {
		fmt.Printf("  Cluster:    %s (%s)\n", rs.Cluster.Name, rs.Cluster.Status)
	}

	// Tyr (when available).
	if rs.Tyr != nil {
		if rs.Tyr.Address != "" {
			fmt.Printf("  Tyr:        %s on %s (PID %d)\n", rs.Tyr.Status, rs.Tyr.Address, rs.Tyr.PID)
		} else {
			fmt.Printf("  Tyr:        %s\n", rs.Tyr.Status)
		}
	}

	// Database.
	if rs.Database.Detail != "" {
		fmt.Printf("  Database:   %s\n", rs.Database.Detail)
	} else {
		fmt.Printf("  Database:   %s\n", rs.Database.Status)
	}

	// Proxy (k3s).
	if rs.Proxy != "" {
		fmt.Printf("  Proxy:      %s\n", rs.Proxy)
	}

	// Sessions summary.
	fmt.Printf("  Sessions:   %d/%d active\n", rs.Sessions.Active, rs.Sessions.Max)

	// Session list.
	if len(rs.Sessions.List) > 0 {
		fmt.Println()
		fmt.Printf("  %-10s  %-15s  %-10s  %-18s  %-28s  %s\n",
			"ID", "NAME", "STATUS", "MODEL", "REPO", "AGE")
		for _, s := range rs.Sessions.List {
			age := formatAge(s.CreatedAt)
			fmt.Printf("  %-10s  %-15s  %-10s  %-18s  %-28s  %s\n",
				s.ID, truncateName(s.Name), s.Status, s.Model, s.Repo, age)
		}
	}

	// Pod list (k3s mode).
	if len(rs.Pods) > 0 {
		fmt.Println()
		fmt.Printf("  PODS (kubectl get pods -n volundr):\n")
		fmt.Printf("  %-30s  %-8s  %-10s  %s\n", "NAME", "READY", "STATUS", "AGE")
		for _, p := range rs.Pods {
			age := formatAge(p.Age)
			fmt.Printf("  %-30s  %-8s  %-10s  %s\n", p.Name, p.Ready, p.Status, age)
		}
	}
}

// truncateName truncates a session name to 15 characters.
func truncateName(name string) string {
	if len(name) > 15 {
		return name[:12] + "..."
	}
	return name
}

// formatAge converts an ISO 8601 timestamp to a human-readable age string.
func formatAge(timestamp string) string {
	if timestamp == "" {
		return ""
	}

	// Try common ISO 8601 formats.
	for _, layout := range []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05Z",
	} {
		t, err := time.Parse(layout, strings.TrimSpace(timestamp))
		if err != nil {
			continue
		}
		d := time.Since(t)
		switch {
		case d < time.Minute:
			return fmt.Sprintf("%ds", int(d.Seconds()))
		case d < time.Hour:
			return fmt.Sprintf("%dm", int(d.Minutes()))
		case d < 24*time.Hour:
			return fmt.Sprintf("%dh", int(d.Hours()))
		default:
			return fmt.Sprintf("%dd", int(d.Hours()/24))
		}
	}
	return timestamp
}
