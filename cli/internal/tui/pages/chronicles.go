package pages

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// EventType classifies a chronicle timeline event.
type EventType string

// EventType constants for chronicle timeline events.
const (
	EventSession  EventType = "session"
	EventMessage  EventType = "message"
	EventFile     EventType = "file"
	EventGit      EventType = "git"
	EventTerminal EventType = "terminal"
	EventError    EventType = "error"
)

// ChronicleEvent represents a single event in the chronicles timeline.
type ChronicleEvent struct {
	Type      EventType
	Label     string
	Action    string
	Ins       int
	Del       int
	Hash      string
	Elapsed   int // seconds since session start
	Tokens    int
	Timestamp time.Time
}

// TimelineLoadedMsg carries the fetched timeline from the API.
type TimelineLoadedMsg struct {
	Timeline *api.TimelineResponse
	Err      error
}

// ChroniclesPage displays a filterable event log with a timeline feel.
type ChroniclesPage struct {
	client    *api.Client
	sessionID string
	events    []ChronicleEvent
	files     []api.TimelineFile
	commits   []api.TimelineCommit
	filtered  []ChronicleEvent
	cursor    int
	scrollPos int
	filter    string // "all", "session", "message", "file", "git", "terminal", "error"
	search    string
	searching bool
	loading   bool
	loadErr   error
	noSession bool
	width     int
	height    int
}

// chronicleFilters defines the filter cycle order.
var chronicleFilters = []string{"all", "session", "message", "file", "git", "terminal", "error"}

// NewChroniclesPage creates a new chronicles page.
func NewChroniclesPage(client *api.Client) ChroniclesPage {
	return ChroniclesPage{
		client:    client,
		filter:    "all",
		noSession: true,
	}
}

// SetSession loads the timeline for the given session.
func (c *ChroniclesPage) SetSession(sess api.Session) tea.Cmd { //nolint:gocritic // hugeParam acceptable for API type
	c.sessionID = sess.ID
	c.loading = true
	c.loadErr = nil
	c.noSession = false
	c.events = nil
	c.filtered = nil
	c.files = nil
	c.commits = nil
	c.cursor = 0

	client := c.client
	sessionID := sess.ID
	return func() tea.Msg {
		timeline, err := client.GetTimeline(sessionID)
		return TimelineLoadedMsg{Timeline: timeline, Err: err}
	}
}

// Init does not load data on startup — chronicles require a session selection.
func (c ChroniclesPage) Init() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	return nil
}

// Update handles messages for the chronicles page.
func (c ChroniclesPage) Update(msg tea.Msg) (ChroniclesPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg := msg.(type) {
	case TimelineLoadedMsg:
		c.loading = false
		if msg.Err != nil {
			c.loadErr = msg.Err
			return c, nil
		}
		if msg.Timeline != nil {
			c.events = timelineEventsFromAPI(msg.Timeline.Events)
			c.files = msg.Timeline.Files
			c.commits = msg.Timeline.Commits
		}
		c.applyFilter()
		return c, nil
	case tea.KeyMsg:
		if c.searching {
			return c.handleSearchInput(msg)
		}

		switch msg.String() {
		case "up", "k":
			if c.cursor > 0 {
				c.cursor--
			}
		case "down", "j":
			if c.cursor < len(c.filtered)-1 {
				c.cursor++
			}
		case "J":
			c.scrollPos++
		case "K":
			if c.scrollPos > 0 {
				c.scrollPos--
			}
		case "G":
			c.cursor = max(0, len(c.filtered)-1)
		case "g":
			c.cursor = 0
		case "/":
			c.searching = true
			c.search = ""
		case "tab":
			c.cycleFilter(1)
		case "shift+tab":
			c.cycleFilter(-1)
		case "r":
			if c.sessionID != "" {
				c.loading = true
				client := c.client
				sessionID := c.sessionID
				return c, func() tea.Msg {
					timeline, err := client.GetTimeline(sessionID)
					return TimelineLoadedMsg{Timeline: timeline, Err: err}
				}
			}
		}
	}
	return c, nil
}

// timelineEventsFromAPI converts API timeline events to display events.
func timelineEventsFromAPI(events []api.TimelineEvent) []ChronicleEvent {
	result := make([]ChronicleEvent, 0, len(events))
	for _, ev := range events {
		eventType := mapEventType(ev.Type)

		tokens := 0
		if ev.Tokens != nil {
			tokens = *ev.Tokens
		}
		ins := 0
		if ev.Ins != nil {
			ins = *ev.Ins
		}
		del := 0
		if ev.Del != nil {
			del = *ev.Del
		}

		result = append(result, ChronicleEvent{
			Type:    eventType,
			Label:   ev.Label,
			Action:  ev.Action,
			Ins:     ins,
			Del:     del,
			Hash:    ev.Hash,
			Elapsed: ev.T,
			Tokens:  tokens,
		})
	}
	return result
}

// mapEventType maps a timeline event type string to an EventType.
func mapEventType(t string) EventType {
	switch t {
	case "session":
		return EventSession
	case "message":
		return EventMessage
	case "file":
		return EventFile
	case "git":
		return EventGit
	case "terminal":
		return EventTerminal
	case "error":
		return EventError
	}
	return EventMessage
}

// cycleFilter moves to the next or previous filter.
func (c *ChroniclesPage) cycleFilter(dir int) {
	idx := c.filterTabIndex()
	idx = (idx + dir + len(chronicleFilters)) % len(chronicleFilters)
	c.filter = chronicleFilters[idx]
	c.applyFilter()
}

// handleSearchInput processes keystrokes in search mode.
func (c ChroniclesPage) handleSearchInput(msg tea.KeyMsg) (ChroniclesPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg.String() {
	case "enter", "esc":
		c.searching = false
	case "backspace":
		if c.search != "" {
			c.search = c.search[:len(c.search)-1]
		}
	case "space":
		c.search += " "
	default:
		if text := msg.Key().Text; text != "" {
			c.search += text
		}
	}
	c.applyFilter()
	return c, nil
}

// Searching returns whether the search input is active.
func (c ChroniclesPage) Searching() bool { //nolint:gocritic // value receiver needed for page interface consistency
	return c.searching
}

// applyFilter filters events by type and search term.
func (c *ChroniclesPage) applyFilter() {
	c.filtered = nil
	lower := strings.ToLower(c.search)
	for _, e := range c.events {
		if c.filter != "all" && string(e.Type) != c.filter {
			continue
		}
		if c.search != "" {
			if !strings.Contains(strings.ToLower(e.Label), lower) &&
				!strings.Contains(strings.ToLower(e.Action), lower) &&
				!strings.Contains(strings.ToLower(string(e.Type)), lower) &&
				!strings.Contains(strings.ToLower(e.Hash), lower) {
				continue
			}
		}
		c.filtered = append(c.filtered, e)
	}
	if c.cursor >= len(c.filtered) {
		c.cursor = max(0, len(c.filtered)-1)
	}
}

// SetSize updates the page dimensions.
func (c *ChroniclesPage) SetSize(w, h int) {
	c.width = w
	c.height = h
}

// View renders the chronicles page with a beautiful timeline layout.
func (c ChroniclesPage) View() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	// No session selected
	if c.noSession {
		return lipgloss.NewStyle().
			Width(c.width).
			Height(c.height).
			Padding(1, 2).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				titleStyle.Render("◷ Chronicles"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentAmber).
					Render("  Select a session first (press 1 to go to Sessions, then Enter)"),
			))
	}

	// Stats row
	counts := c.countByType()
	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Total", fmt.Sprintf("%d", len(c.events)), "◷", theme.AccentAmber),
		components.NewMetricCard("Messages", fmt.Sprintf("%d", counts["message"]), "◈", theme.AccentPurple),
		components.NewMetricCard("Files", fmt.Sprintf("%d", counts["file"]), "▶", theme.AccentEmerald),
		components.NewMetricCard("Git", fmt.Sprintf("%d", counts["git"]), "⊕", theme.AccentIndigo),
	})

	// Filter tabs
	tabs := components.Tabs{
		Items: []string{
			fmt.Sprintf("All (%d)", len(c.events)),
			"Session", "Message", "File", "Git", "Terminal", "Error",
		},
		ActiveTab: c.filterTabIndex(),
		Width:     c.width,
	}

	// Search bar
	var searchBar string
	if c.searching {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("/ " + c.search + "\u2588")
	} else if c.search != "" {
		searchBar = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render("Filter: " + c.search + "  (/ to edit)")
	}

	// Timeline
	timelineHeight := c.height - 12
	if searchBar != "" {
		timelineHeight--
	}
	var timeline string

	switch {
	case c.loading:
		timeline = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Padding(2, 0).
			Render("  Loading timeline...")
	case c.loadErr != nil:
		timeline = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Padding(2, 0).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", c.loadErr))
	default:
		timeline = c.renderTimeline(timelineHeight)
	}

	parts := []string{
		titleStyle.Render("◷ Chronicles"),
		"",
		cards,
		"",
		tabs.View(),
	}
	if searchBar != "" {
		parts = append(parts, searchBar)
	}
	parts = append(parts, "", timeline)

	return lipgloss.NewStyle().
		Width(c.width).
		Height(c.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left, parts...))
}

// renderTimeline renders the scrollable timeline of events.
func (c ChroniclesPage) renderTimeline(maxHeight int) string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	if len(c.filtered) == 0 {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Padding(2, 0).
			Render("  No events match the current filter")
	}

	var entries []string

	for i, event := range c.filtered {
		entry := c.renderTimelineEntry(event, i == c.cursor)
		entries = append(entries, entry)
	}

	content := strings.Join(entries, "\n")

	// Truncate to fit
	lines := strings.Split(content, "\n")
	if len(lines) > maxHeight {
		cursorLine := 0
		for i := range c.filtered {
			cursorLine += 3 // each entry is ~3 lines
			if i == c.cursor {
				break
			}
		}

		start := cursorLine - maxHeight/2
		if start < 0 {
			start = 0
		}
		end := start + maxHeight
		if end > len(lines) {
			end = len(lines)
			start = max(0, end-maxHeight)
		}
		lines = lines[start:end]
	}

	return strings.Join(lines, "\n")
}

// renderTimelineEntry renders a single timeline event with the vertical timeline connector.
func (c ChroniclesPage) renderTimelineEntry(event ChronicleEvent, selected bool) string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	icon, clr := eventTypeStyle(event.Type)

	// Format elapsed time
	elapsed := formatElapsed(event.Elapsed)
	timeStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Width(10)

	iconStyle := lipgloss.NewStyle().
		Foreground(clr).
		Bold(true)

	labelStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	typeStyle := lipgloss.NewStyle().
		Foreground(clr).
		Bold(true)

	metaStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	// Timeline connector
	connector := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle).
		Render("│")

	// Build the entry
	line1 := fmt.Sprintf("  %s %s %s  %s",
		timeStyle.Render(elapsed),
		iconStyle.Render(icon),
		labelStyle.Render(event.Label),
		typeStyle.Render(string(event.Type)),
	)

	// Metadata line
	var metaParts []string
	if event.Tokens > 0 {
		metaParts = append(metaParts, fmt.Sprintf("◈ %s tokens", formatTokens(event.Tokens)))
	}
	if event.Action != "" {
		metaParts = append(metaParts, event.Action)
	}
	if event.Ins > 0 || event.Del > 0 {
		metaParts = append(metaParts, fmt.Sprintf("+%d/-%d", event.Ins, event.Del))
	}
	if event.Hash != "" {
		display := event.Hash
		if len(display) > 8 {
			display = display[:8]
		}
		metaParts = append(metaParts, display)
	}

	line2 := fmt.Sprintf("  %s %s  %s",
		lipgloss.NewStyle().Width(10).Render(""),
		connector,
		metaStyle.Render(strings.Join(metaParts, "  ")),
	)

	entry := line1 + "\n" + line2

	if selected {
		return lipgloss.NewStyle().
			Background(theme.BgTertiary).
			Width(c.width - 6).
			Render(entry)
	}

	return entry
}

// formatElapsed formats seconds elapsed into a human-friendly string.
func formatElapsed(seconds int) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	m := seconds / 60
	s := seconds % 60
	if m < 60 {
		return fmt.Sprintf("%dm%02ds", m, s)
	}
	h := m / 60
	m %= 60
	return fmt.Sprintf("%dh%02dm", h, m)
}

// eventTypeStyle returns the icon and color for an event type.
func eventTypeStyle(t EventType) (string, color.Color) {
	theme := tui.DefaultTheme
	switch t {
	case EventSession:
		return "◉", theme.AccentCyan
	case EventMessage:
		return "◈", theme.AccentPurple
	case EventFile:
		return "▶", theme.AccentEmerald
	case EventGit:
		return "⊕", theme.AccentIndigo
	case EventTerminal:
		return "▸", theme.AccentAmber
	case EventError:
		return "✗", theme.AccentRed
	}
	return "○", theme.TextMuted
}

// countByType returns event counts grouped by type.
func (c ChroniclesPage) countByType() map[string]int { //nolint:gocritic // value receiver needed for page interface consistency
	counts := make(map[string]int)
	for _, e := range c.events {
		counts[string(e.Type)]++
	}
	return counts
}

// filterTabIndex maps the current filter to a tab index.
func (c ChroniclesPage) filterTabIndex() int { //nolint:gocritic // value receiver needed for page interface consistency
	for i, f := range chronicleFilters {
		if c.filter == f {
			return i
		}
	}
	return 0
}
