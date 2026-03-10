package pages

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// AdminTab represents a tab in the admin panel.
type AdminTab int

const (
	AdminUsers    AdminTab = iota
	AdminTenants
	AdminStorage
)

// AdminUser represents a user in the admin panel.
type AdminUser struct {
	Name     string
	Email    string
	Role     string
	Status   string
	Sessions int
	LastSeen string
}

// AdminTenant represents a tenant/organization.
type AdminTenant struct {
	Name     string
	Plan     string
	Users    int
	Sessions int
	Storage  string
	Status   string
}

// AdminPage displays admin tables for users, tenants, and storage.
type AdminPage struct {
	tab    AdminTab
	cursor int
	width  int
	height int

	users   []AdminUser
	tenants []AdminTenant
}

// NewAdminPage creates a new admin page with demo data.
func NewAdminPage() AdminPage {
	return AdminPage{
		users:   demoAdminUsers(),
		tenants: demoAdminTenants(),
	}
}

// Init initializes the admin page.
func (a AdminPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the admin page.
func (a AdminPage) Update(msg tea.Msg) (AdminPage, tea.Cmd) {
	switch msg := msg.(type) {
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
		Items:     []string{"Users", "Tenants", "Storage"},
		ActiveTab: int(a.tab),
		Width:     a.width,
	}

	var content string
	switch a.tab {
	case AdminUsers:
		content = a.renderUsers()
	case AdminTenants:
		content = a.renderTenants()
	case AdminStorage:
		content = a.renderStorage()
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

	// Table header
	headerStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Bold(true)

	header := fmt.Sprintf("  %-20s %-28s %-10s %-12s %-8s %s",
		headerStyle.Render("Name"),
		headerStyle.Render("Email"),
		headerStyle.Render("Role"),
		headerStyle.Render("Status"),
		headerStyle.Render("Sessions"),
		headerStyle.Render("Last Seen"),
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
		roleStyle := lipgloss.NewStyle().Foreground(theme.AccentPurple)
		badge := components.NewStatusBadge(user.Status)

		row := fmt.Sprintf("  %-20s %-28s %-10s %-12s %-8d %s",
			nameStyle.Render(user.Name),
			emailStyle.Render(user.Email),
			roleStyle.Render(user.Role),
			badge.View(),
			user.Sessions,
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render(user.LastSeen),
		)

		if i == a.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(a.width - 6).
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

	headerStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Bold(true)

	header := fmt.Sprintf("  %-20s %-12s %-8s %-10s %-10s %s",
		headerStyle.Render("Name"),
		headerStyle.Render("Plan"),
		headerStyle.Render("Users"),
		headerStyle.Render("Sessions"),
		headerStyle.Render("Storage"),
		headerStyle.Render("Status"),
	)

	separator := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle).
		Render("  " + strings.Repeat("─", a.width-8))

	var rows []string
	rows = append(rows, header)
	rows = append(rows, separator)

	for i, tenant := range a.tenants {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true)
		planStyle := lipgloss.NewStyle().Foreground(theme.AccentAmber)
		badge := components.NewStatusBadge(tenant.Status)

		row := fmt.Sprintf("  %-20s %-12s %-8d %-10d %-10s %s",
			nameStyle.Render(tenant.Name),
			planStyle.Render(tenant.Plan),
			tenant.Users,
			tenant.Sessions,
			tenant.Storage,
			badge.View(),
		)

		if i == a.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(a.width - 6).
				Render(row))
		} else {
			rows = append(rows, row)
		}
	}

	return strings.Join(rows, "\n")
}

// renderStorage renders the storage usage view.
func (a AdminPage) renderStorage() string {
	theme := tui.DefaultTheme

	type storageEntry struct {
		Name  string
		Used  string
		Quota string
		Pct   int
	}

	entries := []storageEntry{
		{Name: "Workspaces (PVCs)", Used: "124 GB", Quota: "500 GB", Pct: 25},
		{Name: "Container Images", Used: "89 GB", Quota: "200 GB", Pct: 45},
		{Name: "Database (PostgreSQL)", Used: "12 GB", Quota: "50 GB", Pct: 24},
		{Name: "Object Storage (S3)", Used: "340 GB", Quota: "1 TB", Pct: 33},
		{Name: "Logs & Metrics", Used: "67 GB", Quota: "100 GB", Pct: 67},
	}

	var rows []string
	for i, entry := range entries {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Width(25)
		usedStyle := lipgloss.NewStyle().Foreground(theme.AccentCyan).Width(10)
		quotaStyle := lipgloss.NewStyle().Foreground(theme.TextMuted).Width(10)

		barColor := theme.AccentEmerald
		if entry.Pct > 80 {
			barColor = theme.AccentRed
		} else if entry.Pct > 60 {
			barColor = theme.AccentAmber
		}

		bar := renderBar(entry.Pct, 100, 25, barColor, theme.BgTertiary)

		row := fmt.Sprintf("  %s %s / %s  %s  %d%%",
			nameStyle.Render(entry.Name),
			usedStyle.Render(entry.Used),
			quotaStyle.Render(entry.Quota),
			bar,
			entry.Pct,
		)

		if i == a.cursor {
			rows = append(rows, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(a.width - 6).
				Render(row))
		} else {
			rows = append(rows, row)
		}
	}

	return strings.Join(rows, "\n")
}

func demoAdminUsers() []AdminUser {
	return []AdminUser{
		{Name: "Jozef Van Eenbergen", Email: "jozef@niuu.dev", Role: "admin", Status: "running", Sessions: 42, LastSeen: "2 min ago"},
		{Name: "Sigrid Odinsdottir", Email: "sigrid@niuu.dev", Role: "developer", Status: "running", Sessions: 28, LastSeen: "15 min ago"},
		{Name: "Erik Thorsen", Email: "erik@niuu.dev", Role: "developer", Status: "running", Sessions: 19, LastSeen: "1 hr ago"},
		{Name: "Astrid Bjornsen", Email: "astrid@niuu.dev", Role: "viewer", Status: "stopped", Sessions: 5, LastSeen: "2 days ago"},
		{Name: "Leif Ragnarsson", Email: "leif@niuu.dev", Role: "developer", Status: "stopped", Sessions: 34, LastSeen: "1 week ago"},
	}
}

func demoAdminTenants() []AdminTenant {
	return []AdminTenant{
		{Name: "Niuu", Plan: "Enterprise", Users: 12, Sessions: 156, Storage: "124 GB", Status: "running"},
		{Name: "Asgard Labs", Plan: "Team", Users: 5, Sessions: 42, Storage: "34 GB", Status: "running"},
		{Name: "Midgard Inc", Plan: "Starter", Users: 2, Sessions: 8, Storage: "4 GB", Status: "running"},
	}
}
