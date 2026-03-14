package components

import (
	"fmt"
	"image/color"
	"strings"
	"unicode"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// PaletteResultType classifies command palette results.
type PaletteResultType int

const (
	// PaletteSession is a session result.
	PaletteSession PaletteResultType = iota
	// PalettePage is a page navigation result.
	PalettePage
	// PaletteAction is a general action result.
	PaletteAction
)

// PaletteItem represents a single item in the command palette.
type PaletteItem struct {
	Type  PaletteResultType
	Label string
	Desc  string
	Icon  string
	// Page is set for PalettePage items.
	Page tui.Page
	// Action is an identifier for PaletteAction items.
	Action string
	// SessionID is set for PaletteSession items.
	SessionID string
}

// PaletteSelectedMsg is sent when a palette item is selected.
type PaletteSelectedMsg struct {
	Item PaletteItem
}

// PaletteDismissedMsg is sent when the palette is dismissed.
type PaletteDismissedMsg struct{}

// Palette implements a command palette overlay with fuzzy matching.
type Palette struct {
	Visible bool
	query   string
	cursor  int
	items   []PaletteItem
	matched []PaletteItem
	width   int
	height  int
}

// NewPalette creates a new command palette.
func NewPalette() Palette {
	return Palette{}
}

// Open shows the palette and populates it with items.
func (p *Palette) Open(items []PaletteItem, width, height int) {
	p.Visible = true
	p.query = ""
	p.cursor = 0
	p.items = items
	p.width = width
	p.height = height
	p.applyFilter()
}

// Close hides the palette.
func (p *Palette) Close() {
	p.Visible = false
	p.query = ""
	p.cursor = 0
	p.matched = nil
}

// Update handles key events for the palette.
func (p *Palette) Update(msg tea.KeyMsg) tea.Cmd {
	if !p.Visible {
		return nil
	}

	switch msg.String() {
	case "esc":
		p.Close()
		return func() tea.Msg { return PaletteDismissedMsg{} }

	case "enter":
		if len(p.matched) > 0 && p.cursor < len(p.matched) {
			item := p.matched[p.cursor]
			p.Close()
			return func() tea.Msg { return PaletteSelectedMsg{Item: item} }
		}
		return nil

	case "up", "k":
		// k only navigates when query is empty (otherwise it's a character).
		if msg.String() == "k" && p.query != "" {
			p.query += "k"
			p.cursor = 0
			p.applyFilter()
			return nil
		}
		if p.cursor > 0 {
			p.cursor--
		}
		return nil

	case "down", "j":
		// j only navigates when query is empty.
		if msg.String() == "j" && p.query != "" {
			p.query += "j"
			p.cursor = 0
			p.applyFilter()
			return nil
		}
		if p.cursor < len(p.matched)-1 {
			p.cursor++
		}
		return nil

	case "backspace":
		if p.query != "" {
			p.query = p.query[:len(p.query)-1]
			p.cursor = 0
			p.applyFilter()
		}
		return nil

	case "space":
		p.query += " "
		p.cursor = 0
		p.applyFilter()
		return nil

	default:
		if text := msg.Key().Text; text != "" {
			p.query += text
			p.cursor = 0
			p.applyFilter()
		}
		return nil
	}
}

// applyFilter runs fuzzy matching on items against the query.
func (p *Palette) applyFilter() {
	if p.query == "" {
		p.matched = p.items
		return
	}

	p.matched = nil
	for _, item := range p.items {
		if fuzzyMatch(p.query, item.Label) || fuzzyMatch(p.query, item.Desc) {
			p.matched = append(p.matched, item)
		}
	}
}

// fuzzyMatch checks if the query characters appear in order within the target.
func fuzzyMatch(query, target string) bool {
	query = strings.ToLower(query)
	target = strings.ToLower(target)

	qi := 0
	for _, ch := range target {
		if qi >= len(query) {
			return true
		}
		if unicode.ToLower(ch) == rune(query[qi]) {
			qi++
		}
	}
	return qi >= len(query)
}

// View renders the command palette overlay.
func (p Palette) View(termWidth, termHeight int) string { //nolint:gocritic // value receiver for rendering
	if !p.Visible {
		return ""
	}

	theme := tui.DefaultTheme

	// Palette dimensions
	paletteWidth := 60
	if paletteWidth > termWidth-4 {
		paletteWidth = termWidth - 4
	}

	// Input bar
	inputStyle := lipgloss.NewStyle().
		Foreground(theme.AccentPurple).
		Bold(true)

	cursor := lipgloss.NewStyle().
		Foreground(theme.AccentPurple).
		Render("\u2588")

	inputLine := inputStyle.Render("> ") + p.query + cursor

	// Results
	maxResults := 10
	if maxResults > termHeight-8 {
		maxResults = termHeight - 8
	}

	var resultLines []string

	// Group results by type
	var lastType PaletteResultType = -1

	for i, item := range p.matched {
		if i >= maxResults {
			remaining := len(p.matched) - maxResults
			resultLines = append(resultLines, lipgloss.NewStyle().
				Foreground(theme.TextMuted).
				Render(fmt.Sprintf("  ... and %d more", remaining)))
			break
		}

		// Section header
		if item.Type != lastType {
			var sectionLabel string
			switch item.Type {
			case PaletteSession:
				sectionLabel = "Sessions"
			case PalettePage:
				sectionLabel = "Pages"
			case PaletteAction:
				sectionLabel = "Actions"
			}
			if sectionLabel != "" {
				resultLines = append(resultLines,
					lipgloss.NewStyle().
						Foreground(theme.TextMuted).
						Bold(true).
						Render("  "+sectionLabel))
			}
			lastType = item.Type
		}

		iconStyle := lipgloss.NewStyle().Foreground(p.iconColor(item.Type))
		labelStyle := lipgloss.NewStyle().Foreground(theme.TextPrimary)
		descStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

		line := fmt.Sprintf("  %s %s  %s",
			iconStyle.Render(item.Icon),
			labelStyle.Render(item.Label),
			descStyle.Render(item.Desc),
		)

		if i == p.cursor {
			resultLines = append(resultLines,
				lipgloss.NewStyle().
					Background(theme.BgTertiary).
					Width(paletteWidth-4).
					Render(line))
		} else {
			resultLines = append(resultLines, line)
		}
	}

	if len(p.matched) == 0 && p.query != "" {
		resultLines = append(resultLines,
			lipgloss.NewStyle().
				Foreground(theme.TextMuted).
				Render("  No matches"))
	}

	content := lipgloss.JoinVertical(lipgloss.Left,
		inputLine,
		"",
		strings.Join(resultLines, "\n"),
	)

	modal := lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.AccentPurple).
		Padding(1, 2).
		Width(paletteWidth).
		Render(content)

	// Place at top-center (like VS Code)
	topOffset := termHeight / 5
	if topOffset < 2 {
		topOffset = 2
	}

	return lipgloss.Place(
		termWidth, termHeight,
		lipgloss.Center, lipgloss.Top,
		modal,
		lipgloss.WithWhitespaceChars(" "),
	)
}

// iconColor returns the accent color for a result type.
func (p Palette) iconColor(t PaletteResultType) color.Color { //nolint:gocritic // value receiver for rendering
	theme := tui.DefaultTheme
	switch t {
	case PaletteSession:
		return theme.AccentEmerald
	case PalettePage:
		return theme.AccentCyan
	case PaletteAction:
		return theme.AccentAmber
	}
	return theme.TextMuted
}

// DefaultPaletteItems returns the standard palette items (pages + common actions).
func DefaultPaletteItems() []PaletteItem {
	items := make([]PaletteItem, 0, tui.PageCount+5) //nolint:mnd // preallocated capacity

	// Pages
	for _, page := range tui.PageOrder {
		info := tui.Pages[page]
		items = append(items, PaletteItem{
			Type:  PalettePage,
			Label: info.Name,
			Desc:  "Go to " + info.Name,
			Icon:  info.Icon,
			Page:  page,
		})
	}

	// Common actions
	items = append(items,
		PaletteItem{Type: PaletteAction, Label: "Refresh", Desc: "Reload current page", Icon: "⟳", Action: "refresh"},
		PaletteItem{Type: PaletteAction, Label: "Toggle Sidebar", Desc: "Show/hide sidebar", Icon: "◧", Action: "toggle-sidebar"},
		PaletteItem{Type: PaletteAction, Label: "Help", Desc: "Show keybindings", Icon: "?", Action: "help"},
		PaletteItem{Type: PaletteAction, Label: "Quit", Desc: "Exit Volundr", Icon: "✕", Action: "quit"},
	)

	return items
}
