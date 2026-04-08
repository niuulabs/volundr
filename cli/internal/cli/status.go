package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/runtime"
)

// statusHTTPTimeout is the timeout for HTTP requests to the local Forge API
// during status checks. Kept short so the CLI feels responsive when the
// server is unreachable.
const statusHTTPTimeout = 2 * time.Second

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show status of Volundr services",
	Long:  `Displays the current state of all Volundr services including session details.`,
	RunE:  runStatus,
}

// DetailedStatus holds the rich status output for both modes.
type DetailedStatus struct {
	Mode     string          `json:"mode"`
	Server   ServerInfo      `json:"server"`
	WebUI    string          `json:"web_ui,omitempty"`
	Tyr      *ServiceInfo    `json:"tyr,omitempty"`
	Database *DatabaseInfo   `json:"database,omitempty"`
	Cluster  *ClusterInfo    `json:"cluster,omitempty"`
	Sessions *SessionSummary `json:"sessions,omitempty"`
	Pods     []PodInfo       `json:"pods,omitempty"`
}

// ServerInfo holds server/API process information.
type ServerInfo struct {
	Status  string `json:"status"`
	Address string `json:"address,omitempty"`
	PID     int    `json:"pid,omitempty"`
}

// ServiceInfo holds information about an auxiliary service.
type ServiceInfo struct {
	Status  string `json:"status"`
	Address string `json:"address,omitempty"`
	PID     int    `json:"pid,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

// DatabaseInfo holds database status.
type DatabaseInfo struct {
	Status string `json:"status"`
	Mode   string `json:"mode"`
	Port   int    `json:"port,omitempty"`
}

// ClusterInfo holds k3s cluster details.
type ClusterInfo struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// SessionSummary holds aggregate session information.
type SessionSummary struct {
	Active int           `json:"active"`
	Max    int           `json:"max"`
	Total  int           `json:"total"`
	List   []SessionInfo `json:"list,omitempty"`
}

// SessionInfo holds individual session details for display.
type SessionInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Model     string `json:"model"`
	Repo      string `json:"repo"`
	CreatedAt string `json:"created_at"`
	Age       string `json:"age,omitempty"`
}

// PodInfo holds k3s pod details for display.
type PodInfo struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

func runStatus(_ *cobra.Command, _ []string) error {
	cfg, cfgErr := config.Load()

	// If config cannot be loaded, fall back to basic state file status.
	if cfgErr != nil {
		return runStatusFallback()
	}

	mode := cfg.Volundr.Mode
	if mode == "" {
		mode = "mini"
	}

	rt := runtime.NewRuntime(mode)
	ctx := context.Background()

	stackStatus, err := rt.Status(ctx)
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}

	detailed := buildDetailedStatus(mode, cfg, stackStatus)

	// For mini mode with a running server, fetch session data.
	if mode == "mini" && detailed.Server.Status == "running" {
		fetchMiniSessions(&detailed, cfg)
	}

	if jsonOutput {
		return printJSON(detailed)
	}

	printDetailedStatus(&detailed)
	return nil
}

// runStatusFallback handles the case where no config file exists.
func runStatusFallback() error {
	status, err := runtime.StatusFromStateFile()
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}

	detailed := DetailedStatus{
		Mode: status.Runtime,
		Server: ServerInfo{
			Status: inferServerState(status.Services),
		},
	}

	if jsonOutput {
		return printJSON(detailed)
	}

	printDetailedStatus(&detailed)
	return nil
}

// buildDetailedStatus constructs the rich status from stack status and config.
func buildDetailedStatus(mode string, cfg *config.Config, stack *runtime.StackStatus) DetailedStatus {
	ds := DetailedStatus{
		Mode: mode,
	}

	serverState := inferServerState(stack.Services)
	ds.Server = ServerInfo{
		Status: serverState,
	}

	if serverState == "running" {
		ds.Server.Address = fmt.Sprintf("%s:%d", cfg.Listen.Host, cfg.Listen.Port)
		ds.Server.PID = findServicePID("proxy", stack.Services)
		if ds.Server.PID == 0 {
			ds.Server.PID = findServicePID("api", stack.Services)
		}

		if mode == "mini" {
			ds.WebUI = fmt.Sprintf("http://%s:%d", cfg.Listen.Host, cfg.Listen.Port)
		}
	}

	// Database info.
	dbSvc := findService("postgres", stack.Services)
	if dbSvc != nil {
		ds.Database = &DatabaseInfo{
			Status: string(dbSvc.State),
			Mode:   cfg.Database.Mode,
			Port:   dbSvc.Port,
		}
	} else if cfg.Database.Mode == "embedded" {
		ds.Database = &DatabaseInfo{
			Status: serverState,
			Mode:   cfg.Database.Mode,
			Port:   cfg.Database.Port,
		}
	}

	// Tyr status - check for tyr-related services/pods.
	tyrSvc := findServicePrefix("tyr", stack.Services)
	if tyrSvc != nil {
		ds.Tyr = &ServiceInfo{
			Status: string(tyrSvc.State),
		}
		if tyrSvc.Port > 0 {
			ds.Tyr.Address = fmt.Sprintf("%s:%d", cfg.Listen.Host, tyrSvc.Port)
		}
		if tyrSvc.PID > 0 {
			ds.Tyr.PID = tyrSvc.PID
		}
		if tyrSvc.Name != "tyr" {
			ds.Tyr.Detail = tyrSvc.Name
		}
	}

	// K3s-specific: cluster info and pods.
	if mode == "k3s" {
		clusterSvc := findService("k3s-cluster", stack.Services)
		if clusterSvc != nil {
			ds.Cluster = &ClusterInfo{
				Name:   "k3d-volundr",
				Status: string(clusterSvc.State),
			}
		}

		// Collect pod entries (anything that's not a host service or already shown as Tyr).
		excludeServices := map[string]bool{
			"proxy": true, "api": true, "postgres": true, "k3s-cluster": true,
		}
		if tyrSvc != nil {
			excludeServices[tyrSvc.Name] = true
		}
		for _, svc := range stack.Services {
			if excludeServices[svc.Name] {
				continue
			}
			ds.Pods = append(ds.Pods, PodInfo{
				Name:   svc.Name,
				Status: string(svc.State),
			})
		}
	}

	// Session capacity for mini mode.
	if mode == "mini" && cfg.Volundr.Forge.MaxConcurrent > 0 {
		ds.Sessions = &SessionSummary{
			Max: cfg.Volundr.Forge.MaxConcurrent,
		}
	}

	return ds
}

// fetchMiniSessions queries the running forge server for session data.
func fetchMiniSessions(ds *DetailedStatus, cfg *config.Config) {
	addr := fmt.Sprintf("http://%s:%d", cfg.Listen.Host, cfg.Listen.Port)
	client := &http.Client{Timeout: statusHTTPTimeout}

	// Fetch stats.
	statsResp, err := client.Get(addr + "/api/v1/volundr/stats") //nolint:noctx // short-lived status check
	if err == nil {
		defer statsResp.Body.Close() //nolint:errcheck // best-effort status
		if statsResp.StatusCode == http.StatusOK {
			var stats struct {
				ActiveSessions int `json:"active_sessions"`
				TotalSessions  int `json:"total_sessions"`
			}
			if json.NewDecoder(statsResp.Body).Decode(&stats) == nil {
				if ds.Sessions == nil {
					ds.Sessions = &SessionSummary{Max: cfg.Volundr.Forge.MaxConcurrent}
				}
				ds.Sessions.Active = stats.ActiveSessions
				ds.Sessions.Total = stats.TotalSessions
			}
		}
	}

	// Fetch session list.
	sessResp, err := client.Get(addr + "/api/v1/volundr/sessions") //nolint:noctx // short-lived status check
	if err != nil {
		return
	}
	defer sessResp.Body.Close() //nolint:errcheck // best-effort status
	if sessResp.StatusCode != http.StatusOK {
		return
	}

	type sessionEntry struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Status string `json:"status"`
		Model  string `json:"model"`
		Source *struct {
			Repo string `json:"repo"`
		} `json:"source"`
		Repo      string `json:"repo"`
		CreatedAt string `json:"created_at"`
	}

	var sessions []sessionEntry
	if json.NewDecoder(sessResp.Body).Decode(&sessions) != nil {
		return
	}

	if ds.Sessions == nil {
		ds.Sessions = &SessionSummary{Max: cfg.Volundr.Forge.MaxConcurrent}
	}

	now := time.Now()
	for _, s := range sessions {
		repo := s.Repo
		if repo == "" && s.Source != nil {
			repo = s.Source.Repo
		}
		age := ""
		if t, err := time.Parse(time.RFC3339, s.CreatedAt); err == nil {
			age = formatAge(now.Sub(t))
		}
		ds.Sessions.List = append(ds.Sessions.List, SessionInfo{
			ID:        s.ID,
			Name:      s.Name,
			Status:    s.Status,
			Model:     s.Model,
			Repo:      repo,
			CreatedAt: s.CreatedAt,
			Age:       age,
		})
	}
}

// printDetailedStatus renders the rich status to stdout.
func printDetailedStatus(ds *DetailedStatus) {
	modeName := ds.Mode
	if modeName == "" {
		modeName = "local"
	}
	fmt.Printf("Volundr (%s mode)\n", modeName)

	// Server line.
	if ds.Server.Status == "running" {
		pidStr := ""
		if ds.Server.PID > 0 {
			pidStr = fmt.Sprintf(" (PID %d)", ds.Server.PID)
		}
		fmt.Printf("  Server:     running on %s%s\n", ds.Server.Address, pidStr)
	} else {
		fmt.Printf("  Server:     %s\n", ds.Server.Status)
	}

	// Web UI.
	if ds.WebUI != "" {
		fmt.Printf("  Web UI:     %s\n", ds.WebUI)
	}

	// Tyr.
	if ds.Tyr != nil {
		if ds.Tyr.Status == "running" {
			detail := ""
			if ds.Tyr.Address != "" {
				detail = fmt.Sprintf(" on %s", ds.Tyr.Address)
			}
			if ds.Tyr.PID > 0 {
				detail += fmt.Sprintf(" (PID %d)", ds.Tyr.PID)
			}
			if ds.Tyr.Detail != "" {
				detail += fmt.Sprintf(" (%s)", ds.Tyr.Detail)
			}
			fmt.Printf("  Tyr:        running%s\n", detail)
		} else {
			fmt.Printf("  Tyr:        %s\n", ds.Tyr.Status)
		}
	}

	// Database.
	if ds.Database != nil {
		if ds.Database.Status == "running" {
			fmt.Printf("  Database:   %s PostgreSQL on port %d\n", ds.Database.Mode, ds.Database.Port)
		} else {
			fmt.Printf("  Database:   %s (%s)\n", ds.Database.Mode, ds.Database.Status)
		}
	}

	// Cluster (k3s).
	if ds.Cluster != nil {
		fmt.Printf("  Cluster:    %s (%s)\n", ds.Cluster.Name, ds.Cluster.Status)
	}

	// Sessions.
	if ds.Sessions != nil {
		fmt.Printf("  Sessions:   %d/%d active\n", ds.Sessions.Active, ds.Sessions.Max)

		if len(ds.Sessions.List) > 0 {
			fmt.Println()
			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			_, _ = fmt.Fprintln(w, "  ID\tNAME\tSTATUS\tMODEL\tREPO\tAGE")
			for _, s := range ds.Sessions.List {
				id := s.ID
				if len(id) > 8 {
					id = id[:8]
				}
				_, _ = fmt.Fprintf(w, "  %s\t%s\t%s\t%s\t%s\t%s\n",
					id, s.Name, s.Status, s.Model, s.Repo, s.Age)
			}
			_ = w.Flush()
		}
	}

	// Pods (k3s).
	if len(ds.Pods) > 0 {
		fmt.Println()
		fmt.Println("  PODS:")
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(w, "  NAME\tSTATUS")
		for _, p := range ds.Pods {
			_, _ = fmt.Fprintf(w, "  %s\t%s\n", p.Name, p.Status)
		}
		_ = w.Flush()
	}
}

// inferServerState determines overall server state from service list.
func inferServerState(services []runtime.ServiceStatus) string {
	if len(services) == 0 {
		return "stopped"
	}
	for _, svc := range services {
		if svc.Name == "volundr" {
			return string(svc.State)
		}
		if svc.Name == "proxy" || svc.Name == "api" {
			return string(svc.State)
		}
	}
	return "stopped"
}

// findService returns the first service with the exact name.
func findService(name string, services []runtime.ServiceStatus) *runtime.ServiceStatus {
	for i := range services {
		if services[i].Name == name {
			return &services[i]
		}
	}
	return nil
}

// findServicePrefix returns the first service whose name starts with prefix.
func findServicePrefix(prefix string, services []runtime.ServiceStatus) *runtime.ServiceStatus {
	for i := range services {
		if strings.HasPrefix(services[i].Name, prefix) {
			return &services[i]
		}
	}
	return nil
}

// findServicePID returns the PID of the named service, or 0.
func findServicePID(name string, services []runtime.ServiceStatus) int {
	svc := findService(name, services)
	if svc == nil {
		return 0
	}
	return svc.PID
}

// formatAge formats a duration as a human-readable age string.
func formatAge(d time.Duration) string {
	if d < time.Minute {
		return strconv.Itoa(int(d.Seconds())) + "s"
	}
	if d < time.Hour {
		return strconv.Itoa(int(d.Minutes())) + "m"
	}
	if d < 24*time.Hour {
		return strconv.Itoa(int(d.Hours())) + "h"
	}
	return strconv.Itoa(int(d.Hours()/24)) + "d"
}
