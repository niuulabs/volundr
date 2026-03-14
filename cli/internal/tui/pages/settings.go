package pages

import (
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// SettingsSection represents a tab in the settings page.
type SettingsSection int

// SettingsSection constants for settings page tabs.
const (
	SectionConnection SettingsSection = iota
	SectionCredentials
	SectionIntegrations
	SectionAppearance
)

// SettingsLoadedMsg carries data fetched for the settings page.
type SettingsLoadedMsg struct {
	Profile      *api.UserProfile
	Integrations []api.IntegrationConnection
	Catalog      []api.IntegrationCatalogEntry
	Err          error
}

// SettingsPage displays configuration with tabbed sections.
type SettingsPage struct {
	client  *api.Client
	cfg     *remote.Config
	rctx    *remote.Context // resolved context for display
	ctxKey  string          // resolved context key
	section SettingsSection
	cursor  int
	width   int
	height  int
	editing bool
	editBuf string
	loading bool
	loadErr error

	// Loaded data
	profile      *api.UserProfile
	integrations []api.IntegrationConnection
	catalog      []api.IntegrationCatalogEntry
}

// NewSettingsPage creates a new settings page.
func NewSettingsPage(client *api.Client, cfg *remote.Config) SettingsPage {
	// Resolve the first available context for display.
	var rctx *remote.Context
	var ctxKey string
	if cfg != nil {
		for k, c := range cfg.Contexts {
			rctx = c
			ctxKey = k
			break
		}
	}
	return SettingsPage{
		client:  client,
		cfg:     cfg,
		rctx:    rctx,
		ctxKey:  ctxKey,
		loading: true,
	}
}

// Init fetches settings data from the API.
func (s SettingsPage) Init() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	if s.client == nil {
		return nil
	}
	client := s.client
	return func() tea.Msg {
		var result SettingsLoadedMsg

		profile, err := client.GetMe()
		if err != nil {
			result.Err = err
			return result
		}
		result.Profile = profile

		integrations, _ := client.ListIntegrations()
		result.Integrations = integrations

		catalog, _ := client.ListIntegrationCatalog()
		result.Catalog = catalog

		return result
	}
}

// Update handles messages for the settings page.
func (s SettingsPage) Update(msg tea.Msg) (SettingsPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg := msg.(type) {
	case SettingsLoadedMsg:
		s.loading = false
		if msg.Err != nil {
			s.loadErr = msg.Err
			return s, nil
		}
		s.profile = msg.Profile
		s.integrations = msg.Integrations
		s.catalog = msg.Catalog
		return s, nil
	case tea.KeyMsg:
		if s.editing {
			s.handleEditInput(msg)
			return s, nil
		}
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
		case "enter":
			s.startEditing()
		case "r":
			s.loading = true
			return s, s.Init()
		}
	}
	return s, nil
}

// startEditing enters edit mode for the currently selected setting.
func (s *SettingsPage) startEditing() {
	if s.section == SectionConnection && s.cursor == 0 && s.rctx != nil {
		s.editing = true
		s.editBuf = s.rctx.Server
	}
}

// handleEditInput handles key input while in edit mode.
func (s *SettingsPage) handleEditInput(msg tea.KeyMsg) {
	switch msg.String() {
	case "enter":
		s.applyEdit()
		s.editing = false
	case "esc":
		s.editing = false
	case "backspace":
		if s.editBuf != "" {
			s.editBuf = s.editBuf[:len(s.editBuf)-1]
		}
	case "space":
		s.editBuf += " "
	default:
		if text := msg.Key().Text; text != "" {
			s.editBuf += text
		}
	}
}

// applyEdit saves the edit buffer to the appropriate setting.
func (s *SettingsPage) applyEdit() {
	if s.rctx != nil {
		s.rctx.Server = s.editBuf
		if s.cfg != nil {
			_ = s.cfg.Save()
		}
	}
}

// settingsHelp returns contextual help text.
func (s SettingsPage) settingsHelp() string { //nolint:gocritic // value receiver needed for page interface consistency
	if s.editing {
		return "  Enter: save  Esc: cancel"
	}
	return "  Tab/Shift+Tab: switch section  ↑↓: navigate  Enter: edit  r: refresh"
}

// Editing returns whether the settings editor is active.
func (s SettingsPage) Editing() bool { //nolint:gocritic // value receiver needed for page interface consistency
	return s.editing
}

// SetSize updates the page dimensions.
func (s *SettingsPage) SetSize(w, h int) {
	s.width = w
	s.height = h
}

// View renders the settings page.
func (s SettingsPage) View() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	tabs := components.Tabs{
		Items:     []string{"Connection", "Profile", "Integrations", "Appearance"},
		ActiveTab: int(s.section),
		Width:     s.width,
	}

	var content string
	switch {
	case s.loading:
		content = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("  Loading settings...")
	case s.loadErr != nil:
		content = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", s.loadErr))
	default:
		switch s.section {
		case SectionConnection:
			content = s.renderConnection()
		case SectionCredentials:
			content = s.renderProfile()
		case SectionIntegrations:
			content = s.renderIntegrations()
		case SectionAppearance:
			content = s.renderAppearance()
		}
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
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render(s.settingsHelp()),
		))
}

// renderConnection renders the connection settings section.
func (s SettingsPage) renderConnection() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	serverURL := "(not set)"
	if s.rctx != nil && s.rctx.Server != "" {
		serverURL = s.rctx.Server
	}
	if s.editing && s.cursor == 0 {
		serverURL = s.editBuf + "█"
	}

	tokenDisplay := "(not set)"
	if s.rctx != nil && s.rctx.Token != "" {
		tokenDisplay = maskToken(s.rctx.Token)
	}

	rows := []settingRow{
		{Label: "Server URL", Value: serverURL, Desc: "Volundr API server address"},
		{Label: "Auth Token", Value: tokenDisplay, Desc: "OIDC Bearer token for API authentication"},
		{Label: "WebSocket", Value: "Auto (derived from server URL)", Desc: "WebSocket endpoint for real-time features"},
		{Label: "Timeout", Value: "30s", Desc: "HTTP request timeout"},
	}

	return s.renderSettingRows(rows, theme)
}

// renderProfile renders the user profile section.
func (s SettingsPage) renderProfile() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	if s.profile == nil {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("  No profile loaded")
	}

	p := s.profile
	rows := []settingRow{
		{Label: "User ID", Value: p.UserID, Desc: "Unique identifier"},
		{Label: "Display Name", Value: p.DisplayName, Desc: "Your display name"},
		{Label: "Email", Value: p.Email, Desc: "Email address"},
		{Label: "Tenant", Value: p.TenantID, Desc: "Organization / tenant"},
		{Label: "Roles", Value: strings.Join(p.Roles, ", "), Desc: "Assigned roles"},
		{Label: "Status", Value: p.Status, Desc: "Account status"},
	}

	return s.renderSettingRows(rows, theme)
}

// renderIntegrations renders the integrations section.
func (s SettingsPage) renderIntegrations() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	// Build a map of connected integrations by slug.
	connected := make(map[string]bool)
	for i := range s.integrations {
		connected[s.integrations[i].Slug] = s.integrations[i].Enabled
	}

	// Show catalog entries with connection status.
	var lines []string
	items := s.catalog
	if len(items) == 0 && len(s.integrations) > 0 {
		// No catalog but have connections — show connections directly.
		for i := range s.integrations {
			conn := &s.integrations[i]
			nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Width(16)
			typeStyle := lipgloss.NewStyle().Foreground(theme.AccentPurple)
			var badge components.StatusBadge
			if conn.Enabled {
				badge = components.NewStatusBadge("running")
			} else {
				badge = components.NewStatusBadge("stopped")
			}
			line := fmt.Sprintf("  %s  %s  %s",
				nameStyle.Render(conn.Slug),
				badge.View(),
				typeStyle.Render(conn.IntegrationType),
			)
			if i == s.cursor {
				lines = append(lines, lipgloss.NewStyle().
					Background(theme.BgTertiary).Width(s.width-8).Render(line))
			} else {
				lines = append(lines, line)
			}
		}
		return strings.Join(lines, "\n")
	}

	for i, entry := range items {
		nameStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Width(16)
		descStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

		status := "disconnected"
		if connected[entry.Slug] {
			status = "connected"
		}
		badge := components.NewStatusBadge(status)

		icon := entry.Icon
		if icon == "" {
			icon = "◈"
		}

		line := fmt.Sprintf("  %s %s  %s  %s",
			icon,
			nameStyle.Render(entry.Name),
			badge.View(),
			descStyle.Render(entry.Description),
		)

		if i == s.cursor {
			lines = append(lines, lipgloss.NewStyle().
				Background(theme.BgTertiary).Width(s.width-8).Render(line))
		} else {
			lines = append(lines, line)
		}
	}

	if len(lines) == 0 {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("  No integrations available")
	}

	return strings.Join(lines, "\n")
}

// renderAppearance renders the appearance settings section.
func (s SettingsPage) renderAppearance() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	rows := []settingRow{
		{Label: "Theme", Value: "dark", Desc: "Color scheme (dark is the only option, obviously)"},
		{Label: "Sidebar", Value: "Expanded", Desc: "Sidebar display mode (toggle with [)"},
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
func (s SettingsPage) renderSettingRows(rows []settingRow, theme tui.Theme) string { //nolint:gocritic // value receiver needed for page interface consistency
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
				Width(s.width-8).
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
