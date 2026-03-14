package pages

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// AdminTab represents a tab in the admin panel.
type AdminTab int

const (
	AdminUsers AdminTab = iota
	AdminTenants
	AdminStats
)

// AdminDataLoadedMsg carries data fetched for the admin page.
type AdminDataLoadedMsg struct {
	Users   []api.UserInfo
	Tenants []api.Tenant
	Stats   *api.StatsResponse
	Err     error
}

// AdminPage displays admin tables for users, tenants, and stats.
type AdminPage struct {
	client  *api.Client
	tab     AdminTab
	cursor  int
	width   int
	height  int
	loading bool
	loadErr error

	users   []api.UserInfo
	tenants []api.Tenant
	stats   *api.StatsResponse
}

// NewAdminPage creates a new admin page.
func NewAdminPage(client *api.Client) AdminPage {
	return AdminPage{
		client:  client,
		loading: true,
	}
}

// Init fetches admin data from the API.
func (a AdminPage) Init() tea.Cmd {
	if a.client == nil {
		return nil
	}
	client := a.client
	return func() tea.Msg {
		var result AdminDataLoadedMsg

		users, err := client.ListUsers()
		if err != nil {
			// Non-admin users may get a 403; that's OK.
			result.Err = err
		}
		result.Users = users

		tenants, _ := client.ListTenants()
		result.Tenants = tenants

		stats, _ := client.GetStats()
		result.Stats = stats

		return result
	}
}

// Update handles messages for the admin page.
func (a AdminPage) Update(msg tea.Msg) (AdminPage, tea.Cmd) {
	switch msg := msg.(type) {
	case AdminDataLoadedMsg:
		a.loading = false
		if msg.Err != nil && len(msg.Users) == 0 && len(msg.Tenants) == 0 && msg.Stats == nil {
			a.loadErr = msg.Err
			return a, nil
		}
		a.loadErr = nil
		a.users = msg.Users
		a.tenants = msg.Tenants
		a.stats = msg.Stats
		return a, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "tab":
			a.tab = (a.tab + 1) % 3
			a.cursor = 0
		case "shift+tab":
			a.tab = (a.tab + 2) % 3
			a.cursor = 0
		case "up", "k":
			if a.cursor > 0 {
				a.cursor--
			}
		case "down", "j":
			a.cursor++
		case "r":
			a.loading = true
			return a, a.Init()
		}
	}
	return a, nil
}

// SetSize updates the page dimensions.
func (a *AdminPage) SetSize(w, h int) {
	a.width = w
	a.height = h
}

// View renders the admin page.
func (a AdminPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	tabs := components.Tabs{
		Items:     []string{"Users", "Tenants", "Stats"},
		ActiveTab: int(a.tab),
		Width:     a.width,
	}

	var content string
	if a.loading {
		content = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("  Loading admin data...")
	} else if a.loadErr != nil {
		content = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", a.loadErr))
	} else {
		switch a.tab {
		case AdminUsers:
			content = a.renderUsers()
		case AdminTenants:
			content = a.renderTenants()
		case AdminStats:
			content = a.renderStats()
		}
	}

	return lipgloss.NewStyle().
		Width(a.width).
		Height(a.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◈ Admin"),
			"",
			tabs.View(),
			"",
			content,
		))
}

// renderUsers renders the users table.
func (a AdminPage) renderUsers() string {
	theme := tui.DefaultTheme

	if len(a.users) == 0 {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("  No users found (admin role required)")
	}

	headerStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Bold(true)

	header := fmt.Sprintf("  %-24s %-30s %-12s %s",
		headerStyle.Render("Name"),
		headerStyle.Render("Email"),
		headerStyle.Render("Status"),
		headerStyle.Render("Created"),
	)

	separator := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle).
		Render("  " + strings.Repeat("─", a.width-8))

	var rows []string
	rows = append(rows, header)
	rows = append(rows, separator)

	for i, user := range a.users {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true)
		emailStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)
		badge := components.NewStatusBadge(user.Status)

		row := fmt.Sprintf("  %-24s %-30s %-12s %s",
			nameStyle.Render(user.DisplayName),
			emailStyle.Render(user.Email),
			badge.View(),
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render(user.CreatedAt),
		)

		if i == a.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(a.width-6).
				Render(row))
		} else {
			rows = append(rows, row)
		}
	}

	return strings.Join(rows, "\n")
}

// renderTenants renders the tenants table.
func (a AdminPage) renderTenants() string {
	theme := tui.DefaultTheme

	if len(a.tenants) == 0 {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("  No tenants found")
	}

	headerStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Bold(true)

	header := fmt.Sprintf("  %-24s %-38s %s",
		headerStyle.Render("Name"),
		headerStyle.Render("ID"),
		headerStyle.Render("Created"),
	)

	separator := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle).
		Render("  " + strings.Repeat("─", a.width-8))

	var rows []string
	rows = append(rows, header)
	rows = append(rows, separator)

	for i, tenant := range a.tenants {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true)
		idStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)

		row := fmt.Sprintf("  %-24s %-38s %s",
			nameStyle.Render(tenant.Name),
			idStyle.Render(tenant.ID),
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render(tenant.CreatedAt),
		)

		if i == a.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(a.width-6).
				Render(row))
		} else {
			rows = append(rows, row)
		}
	}

	return strings.Join(rows, "\n")
}

// renderStats renders the stats/dashboard view.
func (a AdminPage) renderStats() string {
	theme := tui.DefaultTheme

	if a.stats == nil {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("  No stats available")
	}

	s := a.stats
	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Active", fmt.Sprintf("%d", s.ActiveSessions), "▶", theme.AccentEmerald),
		components.NewMetricCard("Total", fmt.Sprintf("%d", s.TotalSessions), "◉", theme.AccentAmber),
		components.NewMetricCard("Tokens Today", formatTokens(s.TokensToday), "◈", theme.AccentPurple),
		components.NewMetricCard("Cost Today", fmt.Sprintf("$%.2f", s.CostToday), "$", theme.AccentAmber),
	})

	// Token breakdown
	var breakdown []string
	breakdown = append(breakdown, "")
	breakdown = append(breakdown, lipgloss.NewStyle().
		Foreground(theme.TextPrimary).Bold(true).Render("  Token Breakdown"))
	breakdown = append(breakdown, "")

	localPct := 0
	if s.TokensToday > 0 {
		localPct = s.LocalTokens * 100 / s.TokensToday
	}

	breakdown = append(breakdown, fmt.Sprintf("  %s  %s  %s",
		lipgloss.NewStyle().Foreground(theme.TextSecondary).Width(16).Render("Local Tokens:"),
		lipgloss.NewStyle().Foreground(theme.AccentEmerald).Bold(true).Render(formatTokens(s.LocalTokens)),
		renderBar(localPct, 100, 25, theme.AccentEmerald, theme.BgTertiary),
	))

	cloudPct := 0
	if s.TokensToday > 0 {
		cloudPct = s.CloudTokens * 100 / s.TokensToday
	}

	breakdown = append(breakdown, fmt.Sprintf("  %s  %s  %s",
		lipgloss.NewStyle().Foreground(theme.TextSecondary).Width(16).Render("Cloud Tokens:"),
		lipgloss.NewStyle().Foreground(theme.AccentCyan).Bold(true).Render(formatTokens(s.CloudTokens)),
		renderBar(cloudPct, 100, 25, theme.AccentCyan, theme.BgTertiary),
	))

	return lipgloss.JoinVertical(lipgloss.Left,
		cards,
		strings.Join(breakdown, "\n"),
	)
}

// renderBar is defined in realms.go.
