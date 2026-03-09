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

// SessionsLoadedMsg carries fetched sessions from the API.
type SessionsLoadedMsg struct {
	Sessions []api.Session
	Err      error
}

// SessionSelectedMsg is emitted when the user opens a session (Enter).
type SessionSelectedMsg struct {
	Session api.Session
}

// SessionActionDoneMsg is emitted after a session action completes.
type SessionActionDoneMsg struct {
	Action string // "start", "stop", "delete"
	Err    error
}

// SessionsPage displays a list of sessions with search and filter.
type SessionsPage struct {
	client    *api.Client
	sessions  []api.Session
	filtered  []api.Session
	cursor    int
	filter    string // "all", "running", "stopped", "error"
	search    string
	searching bool
	loading   bool
	loadErr   error
	width     int
	height    int
}

// NewSessionsPage creates a new sessions page.
func NewSessionsPage(client *api.Client) SessionsPage {
	return SessionsPage{
		client: client,
		filter: "all",
	}
}

// Init fetches sessions from the API.
func (s SessionsPage) Init() tea.Cmd {
	if s.client == nil {
		return nil
	}
	client := s.client
	return func() tea.Msg {
		sessions, err := client.ListSessions()
		return SessionsLoadedMsg{Sessions: sessions, Err: err}
	}
}

// Update handles messages for the sessions page.
func (s SessionsPage) Update(msg tea.Msg) (SessionsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case SessionsLoadedMsg:
		s.loading = false
		if msg.Err != nil {
			s.loadErr = msg.Err
			return s, nil
		}
		s.sessions = msg.Sessions
		s.applyFilter()
		return s, nil
	case SessionActionDoneMsg:
		if msg.Err != nil {
			s.loadErr = msg.Err
			return s, nil
		}
		// Refresh session list after action.
		return s, s.Init()
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
		case "enter":
			if sess := s.selectedSession(); sess != nil {
				return s, func() tea.Msg { return SessionSelectedMsg{Session: *sess} }
			}
		case "s":
			return s, s.doAction("start")
		case "x":
			return s, s.doAction("stop")
		case "d":
			return s, s.doAction("delete")
		case "/":
			s.searching = true
			s.search = ""
		case "tab":
			s.cycleFilter(1)
		case "shift+tab":
			s.cycleFilter(-1)
		case "r":
			return s, s.Init()
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
	case "space":
		s.search += " "
	default:
		if len(msg.String()) == 1 {
			s.search += msg.String()
		}
	}
	s.applyFilter()
	return s, nil
}

// sessionFilters defines the filter cycle order.
var sessionFilters = []string{"all", "running", "stopped", "error"}

// cycleFilter moves to the next or previous filter.
func (s *SessionsPage) cycleFilter(dir int) {
	idx := filterIndex(s.filter)
	idx = (idx + dir + len(sessionFilters)) % len(sessionFilters)
	s.filter = sessionFilters[idx]
	s.applyFilter()
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
	_ = errored

	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Total", fmt.Sprintf("%d", len(s.sessions)), "◉", theme.AccentAmber),
		components.NewMetricCard("Running", fmt.Sprintf("%d", running), "▶", theme.AccentEmerald),
		components.NewMetricCard("Stopped", fmt.Sprintf("%d", stopped), "■", theme.TextMuted),
		components.NewMetricCard("Tokens", formatTokens(totalTokens), "◈", theme.AccentAmber),
	})

	// Filter tabs
	tabs := components.Tabs{
		Items:     []string{"All", "Running", "Stopped", "Error"},
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

	if s.loading {
		rows = append(rows, lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Padding(2, 0).
			Render("  Loading sessions..."))
	} else if s.loadErr != nil {
		rows = append(rows, lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Padding(2, 0).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", s.loadErr)))
	} else if len(rows) == 0 {
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

// selectedSession returns the session under the cursor, or nil.
func (s SessionsPage) selectedSession() *api.Session {
	if s.cursor < 0 || s.cursor >= len(s.filtered) {
		return nil
	}
	sess := s.filtered[s.cursor]
	return &sess
}

// doAction performs a session action (start/stop/delete) asynchronously.
func (s SessionsPage) doAction(action string) tea.Cmd {
	sess := s.selectedSession()
	if sess == nil || s.client == nil {
		return nil
	}
	client := s.client
	id := sess.ID
	return func() tea.Msg {
		var err error
		switch action {
		case "start":
			err = client.StartSession(id)
		case "stop":
			err = client.StopSession(id)
		case "delete":
			err = client.DeleteSession(id)
		}
		return SessionActionDoneMsg{Action: action, Err: err}
	}
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
