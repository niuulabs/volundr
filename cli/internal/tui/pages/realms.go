package pages

import (
	"fmt"
	"image/color"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// Realm represents an infrastructure realm (Kubernetes namespace/cluster).
type Realm struct {
	Name     string
	Status   string
	Cluster  string
	Pods     int
	MaxPods  int
	CPUUsage string
	MemUsage string
	GPUs     int
	Region   string
}

// RealmsPage displays an infrastructure grid with health status.
type RealmsPage struct {
	realms []Realm
	cursor int
	width  int
	height int
}

// NewRealmsPage creates a new realms page with demo data.
func NewRealmsPage() RealmsPage {
	return RealmsPage{
		realms: demoRealms(),
	}
}

// Init initializes the realms page.
func (r RealmsPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the realms page.
func (r RealmsPage) Update(msg tea.Msg) (RealmsPage, tea.Cmd) {
	if msg, ok := msg.(tea.KeyMsg); ok {
		switch msg.String() {
		case "up", "k":
			if r.cursor > 0 {
				r.cursor--
			}
		case "down", "j":
			if r.cursor < len(r.realms)-1 {
				r.cursor++
			}
		}
	}
	return r, nil
}

// SetSize updates the page dimensions.
func (r *RealmsPage) SetSize(w, h int) {
	r.width = w
	r.height = h
}

// View renders the realms page.
func (r RealmsPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	// Summary metrics
	totalPods := 0
	totalGPUs := 0
	healthyCount := 0
	for _, realm := range r.realms {
		totalPods += realm.Pods
		totalGPUs += realm.GPUs
		if realm.Status == "running" {
			healthyCount++
		}
	}

	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Realms", fmt.Sprintf("%d", len(r.realms)), "◆", theme.AccentCyan),
		components.NewMetricCard("Healthy", fmt.Sprintf("%d/%d", healthyCount, len(r.realms)), "●", theme.AccentEmerald),
		components.NewMetricCard("Pods", fmt.Sprintf("%d", totalPods), "▣", theme.AccentAmber),
		components.NewMetricCard("GPUs", fmt.Sprintf("%d", totalGPUs), "◈", theme.AccentPurple),
	})

	// Realm grid
	rows := make([]string, 0, len(r.realms))
	for i, realm := range r.realms {
		rows = append(rows, r.renderRealmCard(realm, i == r.cursor))
	}

	grid := strings.Join(rows, "\n")

	return lipgloss.NewStyle().
		Width(r.width).
		Height(r.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◆ Realms"),
			"",
			cards,
			"",
			grid,
		))
}

// renderRealmCard renders a single realm as a card.
func (r RealmsPage) renderRealmCard(realm Realm, selected bool) string {
	theme := tui.DefaultTheme

	badge := components.NewStatusBadge(realm.Status)
	nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Width(18)
	clusterStyle := lipgloss.NewStyle().Foreground(theme.AccentCyan)
	metaStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

	podBar := renderBar(realm.Pods, realm.MaxPods, 15, theme.AccentEmerald, theme.BgTertiary)

	line1 := fmt.Sprintf("  %s %s  %s  %s",
		badge.View(),
		nameStyle.Render(realm.Name),
		clusterStyle.Render(realm.Cluster),
		metaStyle.Render(realm.Region),
	)

	line2 := fmt.Sprintf("     Pods: %s %d/%d   CPU: %s   Mem: %s   GPUs: %d",
		podBar,
		realm.Pods, realm.MaxPods,
		realm.CPUUsage, realm.MemUsage,
		realm.GPUs,
	)

	content := line1 + "\n" + metaStyle.Render(line2)

	if selected {
		return lipgloss.NewStyle().
			Background(theme.BgTertiary).
			Width(r.width-6).
			Padding(0, 1).
			Render(content)
	}

	return lipgloss.NewStyle().
		Width(r.width-6).
		Padding(0, 1).
		Render(content)
}

// renderBar renders a simple progress bar.
func renderBar(current, capacity, width int, fillColor, emptyColor color.Color) string {
	if capacity == 0 {
		return strings.Repeat("░", width)
	}
	filled := width * current / capacity
	if filled > width {
		filled = width
	}
	return lipgloss.NewStyle().Foreground(fillColor).Render(strings.Repeat("█", filled)) +
		lipgloss.NewStyle().Foreground(emptyColor).Render(strings.Repeat("░", width-filled))
}

// demoRealms returns demo infrastructure data.
func demoRealms() []Realm {
	return []Realm{
		{Name: "asgard-prod", Status: "running", Cluster: "k8s-eu-west", Pods: 12, MaxPods: 20, CPUUsage: "67%", MemUsage: "54%", GPUs: 4, Region: "eu-west-1"},
		{Name: "midgard-dev", Status: "running", Cluster: "k8s-eu-west", Pods: 5, MaxPods: 10, CPUUsage: "32%", MemUsage: "28%", GPUs: 2, Region: "eu-west-1"},
		{Name: "vanaheim-staging", Status: "running", Cluster: "k8s-us-east", Pods: 8, MaxPods: 15, CPUUsage: "45%", MemUsage: "41%", GPUs: 2, Region: "us-east-1"},
		{Name: "jotunheim-gpu", Status: "running", Cluster: "k8s-us-east", Pods: 3, MaxPods: 5, CPUUsage: "89%", MemUsage: "76%", GPUs: 8, Region: "us-east-1"},
		{Name: "niflheim-archive", Status: "stopped", Cluster: "k8s-eu-north", Pods: 0, MaxPods: 8, CPUUsage: "0%", MemUsage: "0%", GPUs: 0, Region: "eu-north-1"},
	}
}
