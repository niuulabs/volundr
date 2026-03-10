package pages

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// SettingsSection represents a tab in the settings page.
type SettingsSection int

const (
	SectionConnection SettingsSection = iota
	SectionCredentials
	SectionIntegrations
	SectionAppearance
)

// SettingsPage displays configuration with tabbed sections.
type SettingsPage struct {
	section SettingsSection
	cursor  int
	width   int
	height  int

	// Configuration values
	serverURL string
	authToken string
	theme     string
}

// NewSettingsPage creates a new settings page.
func NewSettingsPage() SettingsPage {
	return SettingsPage{
		serverURL: "http://localhost:8000",
		theme:     "dark",
	}
}

// Init initializes the settings page.
func (s SettingsPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the settings page.
func (s SettingsPage) Update(msg tea.Msg) (SettingsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "tab":
			s.section = (s.section + 1) % 4
			s.cursor = 0
		case "shift+tab":
			s.section = (s.section + 3) % 4
			s.cursor = 0
		case "up", "k":
			if s.cursor > 0 {
				s.cursor--
			}
		case "down", "j":
			s.cursor++
		}
	}
	return s, nil
}

// SetSize updates the page dimensions.
func (s *SettingsPage) SetSize(w, h int) {
	s.width = w
	s.height = h
}

// View renders the settings page.
func (s SettingsPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	tabs := components.Tabs{
		Items:     []string{"Connection", "Credentials", "Integrations", "Appearance"},
		ActiveTab: int(s.section),
		Width:     s.width,
	}

	var content string
	switch s.section {
	case SectionConnection:
		content = s.renderConnection()
	case SectionCredentials:
		content = s.renderCredentials()
	case SectionIntegrations:
		content = s.renderIntegrations()
	case SectionAppearance:
		content = s.renderAppearance()
	}

	return lipgloss.NewStyle().
		Width(s.width).
		Height(s.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◎ Settings"),
			"",
			tabs.View(),
			"",
			content,
			"",
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  Tab/Shift+Tab: switch section  ↑↓: navigate  Enter: edit"),
		))
}

// renderConnection renders the connection settings section.
func (s SettingsPage) renderConnection() string {
	theme := tui.DefaultTheme

	rows := []settingRow{
		{Label: "Server URL", Value: s.serverURL, Desc: "Volundr API server address"},
		{Label: "Auth Token", Value: maskToken(s.authToken), Desc: "OIDC Bearer token for API authentication"},
		{Label: "WebSocket", Value: "Auto (derived from server URL)", Desc: "WebSocket endpoint for real-time features"},
		{Label: "Timeout", Value: "30s", Desc: "HTTP request timeout"},
	}

	return s.renderSettingRows(rows, theme)
}

// renderCredentials renders the credentials section.
func (s SettingsPage) renderCredentials() string {
	theme := tui.DefaultTheme

	rows := []settingRow{
		{Label: "GitHub Token", Value: "●●●●●●●●●●●●ghp_x4k", Desc: "Personal access token for GitHub API"},
		{Label: "GitLab Token", Value: "(not set)", Desc: "Personal access token for GitLab API"},
		{Label: "Linear API Key", Value: "●●●●●●●●●●●●lin_k9p", Desc: "API key for Linear issue tracking"},
	}

	return s.renderSettingRows(rows, theme)
}

// renderIntegrations renders the integrations section.
func (s SettingsPage) renderIntegrations() string {
	theme := tui.DefaultTheme

	type integration struct {
		Name    string
		Status  string
		Desc    string
	}

	integrations := []integration{
		{Name: "GitHub", Status: "connected", Desc: "Repository hosting and CI/CD"},
		{Name: "Linear", Status: "connected", Desc: "Issue tracking and project management"},
		{Name: "GitLab", Status: "disconnected", Desc: "Alternative repository hosting"},
		{Name: "Slack", Status: "disconnected", Desc: "Team notifications"},
		{Name: "Sentry", Status: "disconnected", Desc: "Error tracking and monitoring"},
	}

	var lines []string
	for i, intg := range integrations {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Width(14)
		badge := components.NewStatusBadge(intg.Status)
		descStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

		line := fmt.Sprintf("  %s  %s  %s",
			nameStyle.Render(intg.Name),
			badge.View(),
			descStyle.Render(intg.Desc),
		)

		if i == s.cursor {
			lines = append(lines, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(s.width - 8).
				Render(line))
		} else {
			lines = append(lines, line)
		}
	}

	return strings.Join(lines, "\n")
}

// renderAppearance renders the appearance settings section.
func (s SettingsPage) renderAppearance() string {
	theme := tui.DefaultTheme

	rows := []settingRow{
		{Label: "Theme", Value: s.theme, Desc: "Color scheme (dark is the only option, obviously)"},
		{Label: "Sidebar", Value: "Expanded", Desc: "Sidebar display mode"},
		{Label: "Timestamps", Value: "Relative", Desc: "How to display timestamps"},
		{Label: "Unicode Icons", Value: "Enabled", Desc: "Use unicode icons in navigation"},
	}

	return s.renderSettingRows(rows, theme)
}

// settingRow represents a single setting field.
type settingRow struct {
	Label string
	Value string
	Desc  string
}

// renderSettingRows renders a list of setting rows.
func (s SettingsPage) renderSettingRows(rows []settingRow, theme tui.Theme) string {
	var lines []string
	for i, row := range rows {
		labelStyle := lipgloss.NewStyle().
			Foreground(theme.TextSecondary).
			Width(16).
			Align(lipgloss.Right)

		valueStyle := lipgloss.NewStyle().
			Foreground(theme.TextPrimary).
			Bold(true)

		descStyle := lipgloss.NewStyle().
			Foreground(theme.TextMuted)

		line := fmt.Sprintf("  %s  %s\n  %s  %s",
			labelStyle.Render(row.Label+":"),
			valueStyle.Render(row.Value),
			lipgloss.NewStyle().Width(16).Render(""),
			descStyle.Render(row.Desc),
		)

		if i == s.cursor {
			lines = append(lines, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Width(s.width - 8).
				Render(line))
		} else {
			lines = append(lines, line)
		}
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

// maskToken partially masks a token for display.
func maskToken(token string) string {
	if token == "" {
		return "(not set)"
	}
	if len(token) <= 8 {
		return "●●●●●●●●"
	}
	return "●●●●●●●●●●●●" + token[len(token)-4:]
}
