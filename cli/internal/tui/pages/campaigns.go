package pages

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// Campaign represents a coordinated multi-session work campaign.
type Campaign struct {
	Name        string
	Status      string
	Description string
	Sessions    int
	Phases      []CampaignPhase
	Progress    int // 0-100
	CreatedAt   string
}

// CampaignPhase represents a phase within a campaign.
type CampaignPhase struct {
	Name     string
	Status   string
	Sessions int
}

// CampaignsPage displays campaign list and detail.
type CampaignsPage struct {
	campaigns []Campaign
	cursor    int
	expanded  bool // show detail view
	width     int
	height    int
}

// NewCampaignsPage creates a new campaigns page with demo data.
func NewCampaignsPage() CampaignsPage {
	return CampaignsPage{
		campaigns: demoCampaigns(),
	}
}

// Init initializes the campaigns page.
func (c CampaignsPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the campaigns page.
func (c CampaignsPage) Update(msg tea.Msg) (CampaignsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if c.cursor > 0 {
				c.cursor--
			}
		case "down", "j":
			if c.cursor < len(c.campaigns)-1 {
				c.cursor++
			}
		case "enter":
			c.expanded = !c.expanded
		case "esc":
			c.expanded = false
		}
	}
	return c, nil
}

// SetSize updates the page dimensions.
func (c *CampaignsPage) SetSize(w, h int) {
	c.width = w
	c.height = h
}

// View renders the campaigns page.
func (c CampaignsPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	// Summary
	active := 0
	for _, camp := range c.campaigns {
		if camp.Status == "running" {
			active++
		}
	}

	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Campaigns", fmt.Sprintf("%d", len(c.campaigns)), "◇", theme.AccentCyan),
		components.NewMetricCard("Active", fmt.Sprintf("%d", active), "▶", theme.AccentEmerald),
	})

	var content string
	if c.expanded && len(c.campaigns) > 0 {
		content = c.renderDetail(c.campaigns[c.cursor])
	} else {
		content = c.renderList()
	}

	return lipgloss.NewStyle().
		Width(c.width).
		Height(c.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◇ Campaigns"),
			"",
			cards,
			"",
			content,
			"",
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  Enter: expand/collapse  ↑↓: navigate"),
		))
}

// renderList renders the campaign list view.
func (c CampaignsPage) renderList() string {
	theme := tui.DefaultTheme

	var rows []string
	for i, camp := range c.campaigns {
		badge := components.NewStatusBadge(camp.Status)
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true)
		descStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)
		metaStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

		progress := renderBar(camp.Progress, 100, 20, theme.AccentEmerald, theme.BgTertiary)

		line1 := fmt.Sprintf("  %s  %s  %s %d%%",
			badge.View(),
			nameStyle.Render(camp.Name),
			progress,
			camp.Progress,
		)
		line2 := fmt.Sprintf("     %s  %s",
			descStyle.Render(camp.Description),
			metaStyle.Render(fmt.Sprintf("%d sessions", camp.Sessions)),
		)

		entry := line1 + "\n" + line2

		if i == c.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(c.width - 6).
				Padding(0, 1).
				Render(entry))
		} else {
			rows = append(rows, lipgloss.NewStyle().
				Width(c.width - 6).
				Padding(0, 1).
				Render(entry))
		}
	}

	return strings.Join(rows, "\n")
}

// renderDetail renders the expanded detail view for a campaign.
func (c CampaignsPage) renderDetail(camp Campaign) string {
	theme := tui.DefaultTheme

	nameStyle := lipgloss.NewStyle().Foreground(theme.AccentCyan).Bold(true)
	descStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)
	labelStyle := lipgloss.NewStyle().Foreground(theme.TextMuted).Width(12)
	valueStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary)

	var lines []string
	lines = append(lines, nameStyle.Render(camp.Name))
	lines = append(lines, descStyle.Render(camp.Description))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("  %s %s",
		labelStyle.Render("Status:"),
		components.NewStatusBadge(camp.Status).View()))
	lines = append(lines, fmt.Sprintf("  %s %s",
		labelStyle.Render("Progress:"),
		valueStyle.Render(fmt.Sprintf("%d%%", camp.Progress))))
	lines = append(lines, fmt.Sprintf("  %s %s",
		labelStyle.Render("Sessions:"),
		valueStyle.Render(fmt.Sprintf("%d", camp.Sessions))))
	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Render("  Phases:"))

	for _, phase := range camp.Phases {
		phaseBadge := components.NewStatusBadge(phase.Status)
		lines = append(lines, fmt.Sprintf("    %s  %s  (%d sessions)",
			phaseBadge.View(),
			lipgloss.NewStyle().Foreground(theme.TextPrimary).Render(phase.Name),
			phase.Sessions,
		))
	}

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Padding(1, 2).
		Width(c.width - 6).
		Render(strings.Join(lines, "\n"))
}

// demoCampaigns returns demo campaign data.
func demoCampaigns() []Campaign {
	return []Campaign{
		{
			Name: "Platform v0.63", Status: "running", Description: "Docker runtime backend + TUI client release",
			Sessions: 5, Progress: 65, CreatedAt: "2026-03-05",
			Phases: []CampaignPhase{
				{Name: "Docker Backend", Status: "completed", Sessions: 2},
				{Name: "TUI Client", Status: "running", Sessions: 2},
				{Name: "Integration Tests", Status: "pending", Sessions: 1},
			},
		},
		{
			Name: "Auth Overhaul", Status: "running", Description: "Migrate to OIDC-native auth with IDP abstraction",
			Sessions: 3, Progress: 40, CreatedAt: "2026-03-01",
			Phases: []CampaignPhase{
				{Name: "Identity Adapter", Status: "completed", Sessions: 1},
				{Name: "Envoy Integration", Status: "running", Sessions: 1},
				{Name: "Token Refresh", Status: "pending", Sessions: 1},
			},
		},
		{
			Name: "Bifrost Phase B", Status: "stopped", Description: "Multi-cluster gateway with realm-aware routing",
			Sessions: 8, Progress: 85, CreatedAt: "2026-02-15",
			Phases: []CampaignPhase{
				{Name: "Gateway Core", Status: "completed", Sessions: 3},
				{Name: "Realm Router", Status: "completed", Sessions: 3},
				{Name: "Load Balancer", Status: "stopped", Sessions: 2},
			},
		},
		{
			Name: "Test Coverage Push", Status: "completed", Description: "Bring all packages to 85%+ coverage",
			Sessions: 4, Progress: 100, CreatedAt: "2026-02-20",
			Phases: []CampaignPhase{
				{Name: "API Tests", Status: "completed", Sessions: 2},
				{Name: "Service Tests", Status: "completed", Sessions: 2},
			},
		},
	}
}
