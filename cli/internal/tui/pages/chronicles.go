package pages

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
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

// ChroniclesPage displays a filterable event log with a timeline feel.
type ChroniclesPage struct {
	events    []ChronicleEvent
	filtered  []ChronicleEvent
	cursor    int
	scrollPos int
	filter    string // "all", "think", "observe", "decide", "act", "complete", "merge"
	width     int
	height    int
}

// NewChroniclesPage creates a new chronicles page with demo data.
func NewChroniclesPage() ChroniclesPage {
	events := demoChronicleEvents()
	return ChroniclesPage{
		events:   events,
		filtered: events,
		filter:   "all",
	}
}

// Init initializes the chronicles page.
func (c ChroniclesPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the chronicles page.
func (c ChroniclesPage) Update(msg tea.Msg) (ChroniclesPage, tea.Cmd) {
	switch msg := msg.(type) {
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
		case "1":
			c.setFilter("all")
		case "2":
			c.setFilter("think")
		case "3":
			c.setFilter("observe")
		case "4":
			c.setFilter("decide")
		case "5":
			c.setFilter("act")
		case "6":
			c.setFilter("complete")
		case "7":
			c.setFilter("merge")
		}
	}
	return c, nil
}

// setFilter applies a filter and resets cursor.
func (c *ChroniclesPage) setFilter(filter string) {
	c.filter = filter
	c.filtered = nil
	for _, e := range c.events {
		if filter == "all" || string(e.Type) == filter {
			c.filtered = append(c.filtered, e)
		}
	}
	c.cursor = 0
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
		components.NewMetricCard("Total", fmt.Sprintf("%d", len(c.events)), "◷", theme.AccentCyan),
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
	timeline := c.renderTimeline(timelineHeight)

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
		// Center on cursor position (approximate)
		cursorLine := 0
		lineCount := 0
		for i, event := range c.filtered {
			dateStr := event.Timestamp.Format("Jan 02, 2006")
			_ = dateStr
			lineCount += 4 // approximate lines per entry
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

	icon, color := eventTypeStyle(event.Type)

	timeStr := event.Timestamp.Format("15:04:05")
	timeStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Width(10)

	iconStyle := lipgloss.NewStyle().
		Foreground(color).
		Bold(true)

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	typeStyle := lipgloss.NewStyle().
		Foreground(color).
		Bold(true)

	contentStyle := lipgloss.NewStyle().
		Foreground(theme.TextSecondary).
		PaddingLeft(14)

	sessionStyle := lipgloss.NewStyle().
		Foreground(theme.AccentCyan)

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

// demoChronicleEvents returns realistic demo timeline events.
func demoChronicleEvents() []ChronicleEvent {
	base := time.Date(2026, 3, 8, 8, 0, 0, 0, time.UTC)
	return []ChronicleEvent{
		{
			Type: EventObserve, Title: "Repository cloned",
			Content: "Cloned niuu/volundr (feat/niu-130-go-tui) — 847 files, 52MB",
			Session: "feat/tui-client", Timestamp: base,
			Duration: 12 * time.Second,
		},
		{
			Type: EventThink, Title: "Analyzing project structure",
			Content: "Examined existing REST API, domain models, and web UI patterns. Identified 14 API endpoints to integrate with.",
			Session: "feat/tui-client", Timestamp: base.Add(30 * time.Second),
			Duration: 8 * time.Second, Tokens: 4200,
		},
		{
			Type: EventDecide, Title: "Architecture decision: Go module layout",
			Content: "Chose cmd/ + internal/ structure with separated api, tui, and config packages. Using bubbletea v2 alpha for latest features.",
			Session: "feat/tui-client", Timestamp: base.Add(2 * time.Minute),
			Duration: 15 * time.Second, Tokens: 6800,
		},
		{
			Type: EventAct, Title: "Created project skeleton",
			Content: "Initialized Go module, created 28 files across cmd/, internal/api/, internal/tui/, internal/config/",
			Session: "feat/tui-client", Timestamp: base.Add(5 * time.Minute),
			Duration: 45 * time.Second, Tokens: 12400,
		},
		{
			Type: EventAct, Title: "Implemented theme system",
			Content: "Defined zinc dark palette with 7 accent colors matching web UI tokens.css. Created 15 reusable lipgloss styles.",
			Session: "feat/tui-client", Timestamp: base.Add(12 * time.Minute),
			Duration: 30 * time.Second, Tokens: 8900,
		},
		{
			Type: EventThink, Title: "Evaluating component architecture",
			Content: "Compared flat vs nested Bubble Tea model approaches. Nested models (one per page) provide better encapsulation and independent state management.",
			Session: "feat/tui-client", Timestamp: base.Add(20 * time.Minute),
			Duration: 10 * time.Second, Tokens: 3400,
		},
		{
			Type: EventAct, Title: "Built sidebar navigation",
			Content: "Created sidebar component with 9 pages, unicode icons, keyboard shortcuts (1-9), and collapsed/expanded modes.",
			Session: "feat/tui-client", Timestamp: base.Add(25 * time.Minute),
			Duration: 35 * time.Second, Tokens: 7600,
		},
		{
			Type: EventAct, Title: "Implemented sessions page",
			Content: "Session list with status badges, metric cards, search/filter, and cursor navigation. Includes 7 demo sessions.",
			Session: "feat/tui-client", Timestamp: base.Add(40 * time.Minute),
			Duration: 60 * time.Second, Tokens: 15200,
		},
		{
			Type: EventObserve, Title: "Checked API response format",
			Content: "Verified session JSON schema matches SessionResponse model in rest.py. All 18 fields mapped correctly.",
			Session: "feat/tui-client", Timestamp: base.Add(42 * time.Minute),
			Duration: 5 * time.Second, Tokens: 2100,
		},
		{
			Type: EventAct, Title: "Built chat interface",
			Content: "Chat page with message viewport, markdown support placeholder, input with cursor, model/thinking budget indicators.",
			Session: "feat/tui-client", Timestamp: base.Add(55 * time.Minute),
			Duration: 50 * time.Second, Tokens: 18700,
		},
		{
			Type: EventDecide, Title: "Terminal implementation approach",
			Content: "Will use charmbracelet/x/vt for VT emulation. Created placeholder with simulated output for now.",
			Session: "feat/tui-client", Timestamp: base.Add(65 * time.Minute),
			Duration: 8 * time.Second, Tokens: 2800,
		},
		{
			Type: EventAct, Title: "Implemented chronicles timeline",
			Content: "Timeline-style event log with type filtering, date separators, duration/token metadata, and color-coded event types.",
			Session: "feat/tui-client", Timestamp: base.Add(80 * time.Minute),
			Duration: 55 * time.Second, Tokens: 21000,
		},
		{
			Type: EventAct, Title: "WebSocket reconnection logic",
			Content: "Added exponential backoff (1s-30s) with jitter, pending message queue, and max 10 retries.",
			Session: "fix/ws-reconnect", Timestamp: base.Add(90 * time.Minute),
			Duration: 40 * time.Second, Tokens: 9800,
		},
		{
			Type: EventComplete, Title: "All tests passing",
			Content: "42 tests pass, 91% coverage on internal/api, 87% on internal/tui. Zero warnings.",
			Session: "feat/tui-client", Timestamp: base.Add(100 * time.Minute),
			Duration: 18 * time.Second, Tokens: 4200,
		},
		{
			Type: EventThink, Title: "Reviewing diff visualization",
			Content: "Evaluating side-by-side vs unified diff display. Unified fits better in terminal width constraints.",
			Session: "feat/tui-client", Timestamp: base.Add(110 * time.Minute),
			Duration: 6 * time.Second, Tokens: 2400,
		},
		{
			Type: EventAct, Title: "Built diff viewer",
			Content: "Split-pane layout with file tree (left) and color-coded unified diff (right). Supports scroll and file switching.",
			Session: "feat/tui-client", Timestamp: base.Add(120 * time.Minute),
			Duration: 45 * time.Second, Tokens: 14300,
		},
		{
			Type: EventMerge, Title: "PR #127 merged",
			Content: "feat(tui): Go TUI client with Cobra CLI and Bubble Tea — 34 files changed, +3,847 -0",
			Session: "feat/tui-client", Timestamp: base.Add(140 * time.Minute),
			Duration: 2 * time.Second,
		},
		{
			Type: EventError, Title: "Pod OOMKilled",
			Content: "Session fix/migration-lock exceeded 4.2GB memory limit. Root cause: unbounded query result set.",
			Session: "fix/migration-lock", Timestamp: base.Add(180 * time.Minute),
			Duration: 0,
		},
	}
}
