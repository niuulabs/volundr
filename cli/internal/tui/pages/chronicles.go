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

const (
	EventThink    EventType = "think"
	EventObserve  EventType = "observe"
	EventDecide   EventType = "decide"
	EventAct      EventType = "act"
	EventComplete EventType = "complete"
	EventMerge    EventType = "merge"
	EventError    EventType = "error"
)

// ChronicleEvent represents a single event in the chronicles timeline.
type ChronicleEvent struct {
	Type      EventType
	Title     string
	Content   string
	Session   string
	Timestamp time.Time
	Duration  time.Duration
	Tokens    int
}

// ChroniclesLoadedMsg carries fetched chronicles from the API.
type ChroniclesLoadedMsg struct {
	Chronicles []api.Chronicle
	Err        error
}

// ChroniclesPage displays a filterable event log with a timeline feel.
type ChroniclesPage struct {
	client    *api.Client
	events    []ChronicleEvent
	filtered  []ChronicleEvent
	cursor    int
	scrollPos int
	filter    string // "all", "think", "observe", "decide", "act", "complete", "merge"
	loading   bool
	loadErr   error
	width     int
	height    int
}

// chronicleFilters defines the filter cycle order.
var chronicleFilters = []string{"all", "think", "observe", "decide", "act", "complete", "merge"}

// NewChroniclesPage creates a new chronicles page.
func NewChroniclesPage(client *api.Client) ChroniclesPage {
	return ChroniclesPage{
		client:  client,
		filter:  "all",
		loading: true,
	}
}

// Init fetches chronicles from the API.
func (c ChroniclesPage) Init() tea.Cmd {
	if c.client == nil {
		return nil
	}
	client := c.client
	return func() tea.Msg {
		chronicles, err := client.ListChronicles()
		return ChroniclesLoadedMsg{Chronicles: chronicles, Err: err}
	}
}

// Update handles messages for the chronicles page.
func (c ChroniclesPage) Update(msg tea.Msg) (ChroniclesPage, tea.Cmd) {
	switch msg := msg.(type) {
	case ChroniclesLoadedMsg:
		c.loading = false
		if msg.Err != nil {
			c.loadErr = msg.Err
			return c, nil
		}
		c.events = chroniclesFromAPI(msg.Chronicles)
		c.applyFilter()
		return c, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if c.cursor > 0 {
				c.cursor--
			}
		case "down", "j":
			if c.cursor < len(c.filtered)-1 {
				c.cursor++
			}
		case "tab":
			c.cycleFilter(1)
		case "shift+tab":
			c.cycleFilter(-1)
		case "r":
			c.loading = true
			return c, c.Init()
		}
	}
	return c, nil
}

// chroniclesFromAPI converts API chronicles to timeline events.
func chroniclesFromAPI(chronicles []api.Chronicle) []ChronicleEvent {
	var events []ChronicleEvent
	for _, ch := range chronicles {
		eventType := guessEventType(ch.Status)
		ts, _ := time.Parse(time.RFC3339, ch.CreatedAt)
		dur := time.Duration(ch.DurationSeconds) * time.Second

		title := ch.Summary
		if title == "" {
			title = ch.Status
		}

		content := strings.Join(ch.KeyChanges, "; ")
		if content == "" {
			content = ch.UnfinishedWork
		}

		events = append(events, ChronicleEvent{
			Type:      eventType,
			Title:     title,
			Content:   content,
			Session:   ch.SessionID,
			Timestamp: ts,
			Duration:  dur,
			Tokens:    ch.TokenUsage,
		})
	}
	return events
}

// guessEventType maps a chronicle status string to an EventType.
func guessEventType(status string) EventType {
	switch strings.ToLower(status) {
	case "thinking", "think":
		return EventThink
	case "observing", "observe":
		return EventObserve
	case "deciding", "decide":
		return EventDecide
	case "acting", "act":
		return EventAct
	case "completed", "complete", "done":
		return EventComplete
	case "merged", "merge":
		return EventMerge
	case "error", "failed":
		return EventError
	}
	return EventAct
}

// cycleFilter moves to the next or previous filter.
func (c *ChroniclesPage) cycleFilter(dir int) {
	idx := c.filterTabIndex()
	idx = (idx + dir + len(chronicleFilters)) % len(chronicleFilters)
	c.filter = chronicleFilters[idx]
	c.applyFilter()
}

// applyFilter filters events by type.
func (c *ChroniclesPage) applyFilter() {
	c.filtered = nil
	for _, e := range c.events {
		if c.filter == "all" || string(e.Type) == c.filter {
			c.filtered = append(c.filtered, e)
		}
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
func (c ChroniclesPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	// Stats row
	counts := c.countByType()
	cards := components.MetricRow([]components.MetricCard{
		components.NewMetricCard("Total", fmt.Sprintf("%d", len(c.events)), "◷", theme.AccentAmber),
		components.NewMetricCard("Think", fmt.Sprintf("%d", counts["think"]), "◐", theme.AccentPurple),
		components.NewMetricCard("Act", fmt.Sprintf("%d", counts["act"]), "▶", theme.AccentEmerald),
		components.NewMetricCard("Decide", fmt.Sprintf("%d", counts["decide"]), "◈", theme.AccentAmber),
	})

	// Filter tabs
	tabs := components.Tabs{
		Items: []string{
			fmt.Sprintf("All (%d)", len(c.events)),
			"Think", "Observe", "Decide", "Act", "Complete", "Merge",
		},
		ActiveTab: c.filterTabIndex(),
		Width:     c.width,
	}

	// Timeline
	timelineHeight := c.height - 12
	var timeline string

	if c.loading {
		timeline = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Padding(2, 0).
			Render("  Loading chronicles...")
	} else if c.loadErr != nil {
		timeline = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Padding(2, 0).
			Render(fmt.Sprintf("  Error: %v  (r to retry)", c.loadErr))
	} else {
		timeline = c.renderTimeline(timelineHeight)
	}

	return lipgloss.NewStyle().
		Width(c.width).
		Height(c.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◷ Chronicles"),
			"",
			cards,
			"",
			tabs.View(),
			"",
			timeline,
		))
}

// renderTimeline renders the scrollable timeline of events.
func (c ChroniclesPage) renderTimeline(maxHeight int) string {
	theme := tui.DefaultTheme

	if len(c.filtered) == 0 {
		return lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Padding(2, 0).
			Render("  No events match the current filter")
	}

	var entries []string
	var lastDate string

	for i, event := range c.filtered {
		// Date separator
		dateStr := event.Timestamp.Format("Jan 02, 2006")
		if dateStr != lastDate {
			lastDate = dateStr
			dateSep := lipgloss.NewStyle().
				Foreground(theme.TextMuted).
				Bold(true).
				Render(fmt.Sprintf("  ─── %s ───", dateStr))
			entries = append(entries, dateSep)
		}

		entry := c.renderTimelineEntry(event, i == c.cursor)
		entries = append(entries, entry)
	}

	content := strings.Join(entries, "\n")

	// Truncate to fit
	lines := strings.Split(content, "\n")
	if len(lines) > maxHeight {
		cursorLine := 0
		lineCount := 0
		for i, event := range c.filtered {
			dateStr := event.Timestamp.Format("Jan 02, 2006")
			_ = dateStr
			lineCount += 4
			if i == c.cursor {
				cursorLine = lineCount
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
func (c ChroniclesPage) renderTimelineEntry(event ChronicleEvent, selected bool) string {
	theme := tui.DefaultTheme

	icon, clr := eventTypeStyle(event.Type)

	timeStr := event.Timestamp.Format("15:04:05")
	timeStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Width(10)

	iconStyle := lipgloss.NewStyle().
		Foreground(clr).
		Bold(true)

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	typeStyle := lipgloss.NewStyle().
		Foreground(clr).
		Bold(true)

	contentStyle := lipgloss.NewStyle().
		Foreground(theme.TextSecondary).
		PaddingLeft(14)

	sessionStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber)

	metaStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	// Timeline connector
	connector := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle).
		Render("│")

	// Build the entry
	line1 := fmt.Sprintf("  %s %s %s  %s  %s",
		timeStyle.Render(timeStr),
		iconStyle.Render(icon),
		titleStyle.Render(event.Title),
		typeStyle.Render(string(event.Type)),
		sessionStyle.Render(event.Session),
	)

	line2 := fmt.Sprintf("  %s %s  %s",
		lipgloss.NewStyle().Width(10).Render(""),
		connector,
		contentStyle.Render(event.Content),
	)

	// Metadata line with duration and tokens
	var metaParts []string
	if event.Duration > 0 {
		metaParts = append(metaParts, fmt.Sprintf("⏱ %s", event.Duration.Round(time.Second)))
	}
	if event.Tokens > 0 {
		metaParts = append(metaParts, fmt.Sprintf("◈ %s tokens", formatTokens(event.Tokens)))
	}
	line3 := fmt.Sprintf("  %s %s  %s",
		lipgloss.NewStyle().Width(10).Render(""),
		connector,
		metaStyle.Render(strings.Join(metaParts, "  ")),
	)

	entry := line1 + "\n" + line2 + "\n" + line3

	if selected {
		return lipgloss.NewStyle().
			Background(theme.BgTertiary).
			Width(c.width - 6).
			Render(entry)
	}

	return entry
}

// eventTypeStyle returns the icon and color for an event type.
func eventTypeStyle(t EventType) (string, color.Color) {
	theme := tui.DefaultTheme
	switch t {
	case EventThink:
		return "◐", theme.AccentPurple
	case EventObserve:
		return "◉", theme.AccentCyan
	case EventDecide:
		return "◈", theme.AccentAmber
	case EventAct:
		return "▶", theme.AccentEmerald
	case EventComplete:
		return "✓", theme.AccentEmerald
	case EventMerge:
		return "⊕", theme.AccentIndigo
	case EventError:
		return "✗", theme.AccentRed
	}
	return "○", theme.TextMuted
}

// countByType returns event counts grouped by type.
func (c ChroniclesPage) countByType() map[string]int {
	counts := make(map[string]int)
	for _, e := range c.events {
		counts[string(e.Type)]++
	}
	return counts
}

// filterTabIndex maps the current filter to a tab index.
func (c ChroniclesPage) filterTabIndex() int {
	switch c.filter {
	case "all":
		return 0
	case "think":
		return 1
	case "observe":
		return 2
	case "decide":
		return 3
	case "act":
		return 4
	case "complete":
		return 5
	case "merge":
		return 6
	}
	return 0
}
