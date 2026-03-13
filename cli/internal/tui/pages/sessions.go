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
	pool          *tui.ClientPool
	sessions      []tui.ClusterSession
	filtered      []tui.ClusterSession
	cursor        int
	filter        string // "all", "running", "stopped", "error"
	contextFilter string // "" means all contexts
	search        string
	searching     bool
	loading       bool
	loadErrors    map[string]error
	width         int
	height        int
}

// NewSessionsPage creates a new sessions page.
// If pool is nil, demo data is used as a fallback.
func NewSessionsPage(pool *tui.ClientPool) SessionsPage {
	if pool == nil || len(pool.Entries) == 0 {
		// Fall back to demo data for when no contexts are configured.
		demos := demoSessions()
		clusterSessions := make([]tui.ClusterSession, len(demos))
		for i, s := range demos {
			clusterSessions[i] = tui.ClusterSession{
				Session:     s,
				ContextKey:  "demo",
				ContextName: "demo",
			}
		}
		return SessionsPage{
			sessions: clusterSessions,
			filtered: clusterSessions,
			filter:   "all",
		}
	}

	return SessionsPage{
		pool:    pool,
		filter:  "all",
		loading: true,
	}
}

// Init fetches sessions from the API.
func (s SessionsPage) Init() tea.Cmd {
	if s.pool == nil {
		return nil
	}
	return fetchAllSessions(s.pool)
}

// Update handles messages for the sessions page.
func (s SessionsPage) Update(msg tea.Msg) (SessionsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tui.AllSessionsLoadedMsg:
		s.sessions = msg.Sessions
		s.loadErrors = msg.Errors
		s.loading = false
		s.applyFilter()
		return s, nil

	case SessionActionDoneMsg:
		if msg.Err != nil {
			if s.loadErrors == nil {
				s.loadErrors = make(map[string]error)
			}
			s.loadErrors["action"] = msg.Err
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
			if s.pool != nil {
				s.loading = true
				return s, fetchAllSessions(s.pool)
			}
		case "c":
			s.cycleContextFilter()
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

// cycleContextFilter cycles through available context filters.
func (s *SessionsPage) cycleContextFilter() {
	if s.pool == nil {
		return
	}

	keys := s.pool.OrderedKeys()
	if len(keys) <= 1 {
		return
	}

	if s.contextFilter == "" {
		s.contextFilter = keys[0]
		s.applyFilter()
		return
	}

	for i, k := range keys {
		if k == s.contextFilter {
			if i+1 < len(keys) {
				s.contextFilter = keys[i+1]
			} else {
				s.contextFilter = "" // wrap to "all"
			}
			s.applyFilter()
			return
		}
	}

	// Key not found, reset.
	s.contextFilter = ""
	s.applyFilter()
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

// applyFilter filters sessions by status, context, and search term.
func (s *SessionsPage) applyFilter() {
	s.filtered = nil
	for _, sess := range s.sessions {
		if s.filter != "all" && sess.Status != s.filter {
			continue
		}
		if s.contextFilter != "" && sess.ContextKey != s.contextFilter {
			continue
		}
		if s.search != "" {
			lower := strings.ToLower(s.search)
			if !strings.Contains(strings.ToLower(sess.Name), lower) &&
				!strings.Contains(strings.ToLower(sess.Repo), lower) &&
				!strings.Contains(strings.ToLower(sess.Model), lower) &&
				!strings.Contains(strings.ToLower(sess.ContextName), lower) {
				continue
			}
		}
		s.filtered = append(s.filtered, sess)
	}
	if s.cursor >= len(s.filtered) {
		s.cursor = max(0, len(s.filtered)-1)
	}
}

// SelectedSession returns the currently selected session, or nil if none.
func (s SessionsPage) SelectedSession() *tui.ClusterSession {
	if len(s.filtered) == 0 {
		return nil
	}
	if s.cursor < 0 || s.cursor >= len(s.filtered) {
		return nil
	}
	sess := s.filtered[s.cursor]
	return &sess
}

// Searching returns whether the search input is active.
func (s SessionsPage) Searching() bool {
	return s.searching
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

	// Loading state
	if s.loading {
		return lipgloss.NewStyle().
			Padding(1, 2).
			Width(s.width).
			Height(s.height).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				titleStyle.Render("◉ Sessions"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("  Loading sessions from all clusters..."),
			))
	}

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

	// Context filter indicator
	var contextLine string
	if s.pool != nil && len(s.pool.Entries) > 1 {
		if s.contextFilter == "" {
			contextLine = lipgloss.NewStyle().
				Foreground(theme.TextMuted).
				Render("  Context: all  (c to filter)")
		} else {
			ctxColor := s.pool.ColorForContext(s.contextFilter)
			contextLine = fmt.Sprintf("  Context: %s  %s",
				lipgloss.NewStyle().Foreground(ctxColor).Bold(true).Render(s.contextFilter),
				lipgloss.NewStyle().Foreground(theme.TextMuted).Render("(c to cycle)"),
			)
		}
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

	// Error notifications from clusters
	var errorLines []string
	for key, err := range s.loadErrors {
		errorLines = append(errorLines, lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render(fmt.Sprintf("  ✗ %s: %v", key, err)))
	}

	// Session list
	var rows []string
	for i, sess := range s.filtered {
		rows = append(rows, s.renderSessionCard(sess, i == s.cursor))
	}

	if len(rows) == 0 && !s.loading {
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
	if contextLine != "" {
		parts = append(parts, contextLine)
	}
	if searchBar != "" {
		parts = append(parts, searchBar)
	}
	for _, el := range errorLines {
		parts = append(parts, el)
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
func (s SessionsPage) renderSessionCard(sess tui.ClusterSession, selected bool) string {
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

	// Context badge with color
	var contextBadge string
	if s.pool != nil && len(s.pool.Entries) > 1 {
		ctxColor := s.pool.ColorForContext(sess.ContextKey)
		contextBadge = lipgloss.NewStyle().
			Foreground(ctxColor).
			Bold(true).
			Render("["+sess.ContextKey+"]") + " "
	}

	line1 := fmt.Sprintf("  %s  %s%s  %s",
		badge.View(),
		contextBadge,
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
			Width(s.width-6).
			Padding(0, 1).
			Render(content)
	}

	return lipgloss.NewStyle().
		Width(s.width-6).
		Padding(0, 1).
		Render(content)
}

// fetchAllSessions returns a tea.Cmd that fetches sessions from all connected
// clusters concurrently and returns a single AllSessionsLoadedMsg.
func fetchAllSessions(pool *tui.ClientPool) tea.Cmd {
	return func() tea.Msg {
		type result struct {
			key      string
			name     string
			sessions []api.Session
			err      error
		}

		connected := pool.ConnectedClients()
		if len(connected) == 0 {
			return tui.AllSessionsLoadedMsg{
				Errors: map[string]error{"": fmt.Errorf("no connected clusters")},
			}
		}

		ch := make(chan result, len(connected))
		for _, entry := range connected {
			go func(e *tui.ClusterEntry) {
				sessions, err := e.Client.ListSessions()
				ch <- result{key: e.Key, name: e.Name, sessions: sessions, err: err}
			}(entry)
		}

		var allSessions []tui.ClusterSession
		errors := make(map[string]error)

		for range connected {
			r := <-ch
			if r.err != nil {
				errors[r.key] = r.err
				continue
			}
			for _, s := range r.sessions {
				allSessions = append(allSessions, tui.ClusterSession{
					Session:     s,
					ContextKey:  r.key,
					ContextName: r.name,
				})
			}
		}

		return tui.AllSessionsLoadedMsg{Sessions: allSessions, Errors: errors}
	}
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
	return &sess.Session
}

// doAction performs a session action (start/stop/delete) asynchronously.
// Uses the first connected client from the pool.
func (s SessionsPage) doAction(action string) tea.Cmd {
	sess := s.selectedSession()
	if sess == nil || s.pool == nil {
		return nil
	}
	connected := s.pool.ConnectedClients()
	if len(connected) == 0 {
		return nil
	}
	client := connected[0].Client
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

// demoSessions returns placeholder sessions for when no clusters are configured.
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
			Error:     "Pod OOMKilled after 4.2GB memory usage",
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
