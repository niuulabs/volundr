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

// SessionsPage displays a list of sessions with search and filter.
type SessionsPage struct {
	sessions  []api.Session
	filtered  []api.Session
	cursor    int
	filter    string // "all", "running", "stopped", "error"
	search    string
	searching bool
	width     int
	height    int
}

// NewSessionsPage creates a new sessions page with demo data.
func NewSessionsPage() SessionsPage {
	sessions := demoSessions()
	return SessionsPage{
		sessions: sessions,
		filtered: sessions,
		filter:   "all",
	}
}

// Init initializes the sessions page.
func (s SessionsPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the sessions page.
func (s SessionsPage) Update(msg tea.Msg) (SessionsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if s.searching {
			return s.handleSearchInput(msg)
		}

		switch msg.String() {
		case "up", "k":
			if s.cursor > 0 {
				s.cursor--
			}
		case "down", "j":
			if s.cursor < len(s.filtered)-1 {
				s.cursor++
			}
		case "/":
			s.searching = true
			s.search = ""
		case "1":
			s.filter = "all"
			s.applyFilter()
		case "2":
			s.filter = "running"
			s.applyFilter()
		case "3":
			s.filter = "stopped"
			s.applyFilter()
		case "4":
			s.filter = "error"
			s.applyFilter()
		}
	}
	return s, nil
}

// handleSearchInput processes keystrokes in search mode.
func (s SessionsPage) handleSearchInput(msg tea.KeyMsg) (SessionsPage, tea.Cmd) {
	switch msg.String() {
	case "enter", "esc":
		s.searching = false
	case "backspace":
		if len(s.search) > 0 {
			s.search = s.search[:len(s.search)-1]
		}
	default:
		if len(msg.String()) == 1 {
			s.search += msg.String()
		}
	}
	s.applyFilter()
	return s, nil
}

// applyFilter filters sessions by status and search term.
func (s *SessionsPage) applyFilter() {
	s.filtered = nil
	for _, sess := range s.sessions {
		if s.filter != "all" && sess.Status != s.filter {
			continue
		}
		if s.search != "" {
			lower := strings.ToLower(s.search)
			if !strings.Contains(strings.ToLower(sess.Name), lower) &&
				!strings.Contains(strings.ToLower(sess.Repo), lower) &&
				!strings.Contains(strings.ToLower(sess.Model), lower) {
				continue
			}
		}
		s.filtered = append(s.filtered, sess)
	}
	if s.cursor >= len(s.filtered) {
		s.cursor = max(0, len(s.filtered)-1)
	}
}

// SetSize updates the page dimensions.
func (s *SessionsPage) SetSize(w, h int) {
	s.width = w
	s.height = h
}

// View renders the sessions page.
func (s SessionsPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true).
		MarginBottom(1)

	// Metric cards
	running := 0
	stopped := 0
	errored := 0
	totalTokens := 0
	for _, sess := range s.sessions {
		switch sess.Status {
		case "running":
			running++
		case "stopped":
			stopped++
		case "error":
			errored++
		}
		totalTokens += sess.TokensUsed
	}

	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Total", fmt.Sprintf("%d", len(s.sessions)), "◉", theme.AccentCyan),
		components.NewMetricCard("Running", fmt.Sprintf("%d", running), "▶", theme.AccentEmerald),
		components.NewMetricCard("Stopped", fmt.Sprintf("%d", stopped), "■", theme.TextMuted),
		components.NewMetricCard("Tokens", formatTokens(totalTokens), "◈", theme.AccentAmber),
	})

	// Filter tabs
	tabs := components.Tabs{
		Items:     []string{"All (1)", "Running (2)", "Stopped (3)", "Error (4)"},
		ActiveTab: filterIndex(s.filter),
		Width:     s.width,
	}

	// Search bar
	var searchBar string
	if s.searching {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("/ " + s.search + "█")
	} else if s.search != "" {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("Filter: " + s.search + "  (/ to edit)")
	}

	// Session list
	var rows []string
	for i, sess := range s.filtered {
		rows = append(rows, s.renderSessionCard(sess, i == s.cursor))
	}

	if len(rows) == 0 {
		rows = append(rows, lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Padding(2, 0).
			Render("  No sessions found"))
	}

	sessionList := strings.Join(rows, "\n")

	// Compose the full page
	var parts []string
	parts = append(parts, titleStyle.Render("◉ Sessions"))
	parts = append(parts, cards)
	parts = append(parts, "")
	parts = append(parts, tabs.View())
	if searchBar != "" {
		parts = append(parts, searchBar)
	}
	parts = append(parts, "")
	parts = append(parts, sessionList)

	return lipgloss.NewStyle().
		Padding(1, 2).
		Width(s.width).
		Height(s.height).
		Render(strings.Join(parts, "\n"))
}

// renderSessionCard renders a single session as a card row.
func (s SessionsPage) renderSessionCard(sess api.Session, selected bool) string {
	theme := tui.DefaultTheme

	badge := components.NewStatusBadge(sess.Status)

	nameStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	repoStyle := lipgloss.NewStyle().
		Foreground(theme.AccentCyan)

	modelStyle := lipgloss.NewStyle().
		Foreground(theme.AccentPurple)

	mutedStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	line1 := fmt.Sprintf("  %s  %s  %s",
		badge.View(),
		nameStyle.Render(sess.Name),
		modelStyle.Render(sess.Model),
	)

	line2 := fmt.Sprintf("     %s  %s  %s",
		repoStyle.Render(sess.Repo),
		mutedStyle.Render(sess.Branch),
		mutedStyle.Render(fmt.Sprintf("%s tokens", formatTokens(sess.TokensUsed))),
	)

	content := line1 + "\n" + line2

	if selected {
		return lipgloss.NewStyle().
			Background(theme.BgTertiary).
			Width(s.width - 6).
			Padding(0, 1).
			Render(content)
	}

	return lipgloss.NewStyle().
		Width(s.width - 6).
		Padding(0, 1).
		Render(content)
}

// filterIndex maps filter name to tab index.
func filterIndex(filter string) int {
	switch filter {
	case "all":
		return 0
	case "running":
		return 1
	case "stopped":
		return 2
	case "error":
		return 3
	}
	return 0
}

// formatTokens formats a token count with K/M suffixes.
func formatTokens(tokens int) string {
	if tokens >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(tokens)/1_000_000)
	}
	if tokens >= 1_000 {
		return fmt.Sprintf("%.1fK", float64(tokens)/1_000)
	}
	return fmt.Sprintf("%d", tokens)
}

// demoSessions returns realistic demo session data.
func demoSessions() []api.Session {
	return []api.Session{
		{
			ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", Name: "feat/auth-flow",
			Model: "claude-sonnet-4", Repo: "niuu/volundr", Branch: "feat/auth-flow",
			Status: "running", MessageCount: 42, TokensUsed: 128450,
			CreatedAt: "2026-03-08T10:30:00Z", LastActive: "2026-03-08T14:22:00Z",
		},
		{
			ID: "b2c3d4e5-f6a7-8901-bcde-f12345678901", Name: "fix/ws-reconnect",
			Model: "claude-sonnet-4", Repo: "niuu/volundr", Branch: "fix/ws-reconnect",
			Status: "running", MessageCount: 18, TokensUsed: 67200,
			CreatedAt: "2026-03-08T09:15:00Z", LastActive: "2026-03-08T14:18:00Z",
		},
		{
			ID: "c3d4e5f6-a7b8-9012-cdef-123456789012", Name: "refactor/api-client",
			Model: "claude-opus-4", Repo: "niuu/hlidskjalf", Branch: "refactor/api",
			Status: "stopped", MessageCount: 95, TokensUsed: 342100,
			CreatedAt: "2026-03-07T16:00:00Z", LastActive: "2026-03-07T23:45:00Z",
		},
		{
			ID: "d4e5f6a7-b8c9-0123-defa-234567890123", Name: "feat/tui-client",
			Model: "claude-opus-4", Repo: "niuu/volundr", Branch: "feat/niu-130-go-tui",
			Status: "running", MessageCount: 156, TokensUsed: 891200,
			CreatedAt: "2026-03-08T08:00:00Z", LastActive: "2026-03-08T14:25:00Z",
		},
		{
			ID: "e5f6a7b8-c9d0-1234-efab-345678901234", Name: "docs/api-reference",
			Model: "claude-haiku-3.5", Repo: "niuu/docs", Branch: "docs/api",
			Status: "completed", MessageCount: 12, TokensUsed: 15800,
			CreatedAt: "2026-03-06T11:00:00Z", LastActive: "2026-03-06T11:45:00Z",
		},
		{
			ID: "f6a7b8c9-d0e1-2345-fabc-456789012345", Name: "fix/migration-lock",
			Model: "claude-sonnet-4", Repo: "niuu/volundr", Branch: "fix/migration",
			Status: "error", MessageCount: 7, TokensUsed: 23400,
			Error: "Pod OOMKilled after 4.2GB memory usage",
			CreatedAt: "2026-03-08T13:00:00Z", LastActive: "2026-03-08T13:12:00Z",
		},
		{
			ID: "a7b8c9d0-e1f2-3456-abcd-567890123456", Name: "feat/campaign-tracker",
			Model: "claude-sonnet-4", Repo: "niuu/volundr", Branch: "feat/campaigns",
			Status: "stopped", MessageCount: 67, TokensUsed: 198500,
			CreatedAt: "2026-03-05T14:30:00Z", LastActive: "2026-03-05T22:15:00Z",
		},
	}
}
