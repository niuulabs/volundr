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

// AdminTab constants for admin panel tabs.
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
	client    *api.Client
	tab       AdminTab
	cursor    int
	search    string
	searching bool
	width     int
	height    int
	loading   bool
	loadErr   error

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
func (a AdminPage) Init() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
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
func (a AdminPage) Update(msg tea.Msg) (AdminPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
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
		if a.searching {
			return a.handleSearchInput(msg)
		}

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
		case "G":
			a.cursor = a.maxCursor()
		case "g":
			a.cursor = 0
		case "/":
			a.searching = true
			a.search = ""
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
func (a AdminPage) View() string { //nolint:gocritic // value receiver needed for page interface consistency
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
	switch {
	case a.loading:
		content = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("  Loading admin data...")
	case a.loadErr != nil:
		content = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", a.loadErr))
	default:
		switch a.tab {
		case AdminUsers:
			content = a.renderUsers()
		case AdminTenants:
			content = a.renderTenants()
		case AdminStats:
			content = a.renderStats()
		}
	}

	// Search bar
	var searchBar string
	if a.searching {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("/ " + a.search + "\u2588")
	} else if a.search != "" {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("Filter: " + a.search + "  (/ to edit)")
	}

	parts := []string{
		titleStyle.Render("◈ Admin"),
		"",
		tabs.View(),
	}
	if searchBar != "" {
		parts = append(parts, searchBar)
	}
	parts = append(parts, "", content)

	return lipgloss.NewStyle().
		Width(a.width).
		Height(a.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left, parts...))
}

// handleSearchInput processes keystrokes in search mode.
func (a AdminPage) handleSearchInput(msg tea.KeyMsg) (AdminPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg.String() {
	case "enter", "esc":
		a.searching = false
	case "backspace":
		if a.search != "" {
			a.search = a.search[:len(a.search)-1]
		}
	case "space":
		a.search += " "
	default:
		if text := msg.Key().Text; text != "" {
			a.search += text
		}
	}
	a.cursor = 0
	return a, nil
}

// Searching returns whether the search input is active.
func (a AdminPage) Searching() bool { //nolint:gocritic // value receiver needed for page interface consistency
	return a.searching
}

// maxCursor returns the maximum cursor position for the current tab.
func (a AdminPage) maxCursor() int { //nolint:gocritic // value receiver needed for page interface consistency
	switch a.tab {
	case AdminUsers:
		return max(0, len(a.filteredUsers())-1)
	case AdminTenants:
		return max(0, len(a.filteredTenants())-1)
	case AdminStats:
		return 0
	}
	return 0
}

// filteredUsers returns users matching the current search term.
func (a AdminPage) filteredUsers() []api.UserInfo { //nolint:gocritic // value receiver needed for page interface consistency
	if a.search == "" {
		return a.users
	}
	lower := strings.ToLower(a.search)
	var result []api.UserInfo
	for _, u := range a.users {
		if strings.Contains(strings.ToLower(u.DisplayName), lower) ||
			strings.Contains(strings.ToLower(u.Email), lower) ||
			strings.Contains(strings.ToLower(u.Status), lower) {
			result = append(result, u)
		}
	}
	return result
}

// filteredTenants returns tenants matching the current search term.
func (a AdminPage) filteredTenants() []api.Tenant { //nolint:gocritic // value receiver needed for page interface consistency
	if a.search == "" {
		return a.tenants
	}
	lower := strings.ToLower(a.search)
	var result []api.Tenant
	for _, t := range a.tenants {
		if strings.Contains(strings.ToLower(t.Name), lower) ||
			strings.Contains(strings.ToLower(t.ID), lower) {
			result = append(result, t)
		}
	}
	return result
}

// renderUsers renders the users table.
func (a AdminPage) renderUsers() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme
	users := a.filteredUsers()

	if len(users) == 0 {
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

	rows := []string{header, separator}

	for i, user := range users {
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
func (a AdminPage) renderTenants() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme
	tenants := a.filteredTenants()

	if len(tenants) == 0 {
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

	rows := []string{header, separator}

	for i, tenant := range tenants {
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
func (a AdminPage) renderStats() string { //nolint:gocritic // value receiver needed for page interface consistency
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
	breakdown := make([]string, 0, 5) //nolint:mnd // preallocated capacity for known breakdown items
	breakdown = append(breakdown,
		"",
		lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Render("  Token Breakdown"),
		"",
	)

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

// See realms.go for renderBar definition.
