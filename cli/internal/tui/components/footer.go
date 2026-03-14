package components

import (
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// FooterHint represents a single key hint in the footer bar.
type FooterHint struct {
	Key  string
	Desc string
}

// Footer renders a context-sensitive keyboard shortcut bar at the bottom.
type Footer struct {
	Width int
	Page  tui.Page
	Mode  tui.Mode
}

// NewFooter creates a new Footer component.
func NewFooter() Footer {
	return Footer{}
}

// View renders the footer bar.
func (f Footer) View() string {
	theme := tui.DefaultTheme
	hints := f.hintsForContext()

	keyStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true)

	descStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	sepStyle := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle)

	var parts []string
	for _, h := range hints {
		parts = append(parts, keyStyle.Render(h.Key)+" "+descStyle.Render(h.Desc))
	}

	content := strings.Join(parts, sepStyle.Render("  "))

	return lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Width(f.Width).
		Padding(0, 2).
		Render(content)
}

// hintsForContext returns the relevant hints for the current page and mode.
func (f Footer) hintsForContext() []FooterHint {
	// Command mode overrides everything.
	if f.Mode == tui.ModeCommand {
		return []FooterHint{
			{Key: "j/k", Desc: "navigate"},
			{Key: "Enter", Desc: "select"},
			{Key: "Esc", Desc: "dismiss"},
		}
	}

	// Search mode hints (common to all pages with search).
	if f.Mode == tui.ModeSearch {
		return []FooterHint{
			{Key: "type", Desc: "filter"},
			{Key: "Enter", Desc: "confirm"},
			{Key: "Esc", Desc: "cancel"},
		}
	}

	switch f.Page {
	case tui.PageSessions:
		return f.sessionsHints()
	case tui.PageChat:
		return f.chatHints()
	case tui.PageTerminal:
		return f.terminalHints()
	case tui.PageDiffs:
		return f.diffsHints()
	case tui.PageChronicles:
		return f.chroniclesHints()
	case tui.PageSettings:
		return f.settingsHints()
	case tui.PageAdmin:
		return f.adminHints()
	}

	return f.defaultHints()
}

func (f Footer) sessionsHints() []FooterHint {
	return []FooterHint{
		{Key: "j/k", Desc: "navigate"},
		{Key: "Enter", Desc: "open"},
		{Key: "s", Desc: "start"},
		{Key: "x", Desc: "stop"},
		{Key: "d", Desc: "delete"},
		{Key: "/", Desc: "search"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) chatHints() []FooterHint {
	if f.Mode == tui.ModeInsert {
		return []FooterHint{
			{Key: "Enter", Desc: "send"},
			{Key: "Esc", Desc: "exit"},
			{Key: "Tab", Desc: "toggle focus"},
		}
	}
	return []FooterHint{
		{Key: "i", Desc: "insert"},
		{Key: "j/k", Desc: "scroll"},
		{Key: "G", Desc: "bottom"},
		{Key: "g", Desc: "top"},
		{Key: "Tab", Desc: "toggle focus"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) terminalHints() []FooterHint {
	if f.Mode == tui.ModeInsert {
		return []FooterHint{
			{Key: "Ctrl+]", Desc: "exit terminal"},
			{Key: "Alt+N", Desc: "navigate"},
		}
	}
	return []FooterHint{
		{Key: "i", Desc: "insert"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) diffsHints() []FooterHint {
	return []FooterHint{
		{Key: "j/k", Desc: "select"},
		{Key: "G/g", Desc: "bottom/top"},
		{Key: "J/K", Desc: "scroll diff"},
		{Key: "/", Desc: "search"},
		{Key: "r", Desc: "refresh"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) chroniclesHints() []FooterHint {
	return []FooterHint{
		{Key: "j/k", Desc: "navigate"},
		{Key: "G/g", Desc: "bottom/top"},
		{Key: "Tab", Desc: "filter"},
		{Key: "/", Desc: "search"},
		{Key: "r", Desc: "refresh"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) settingsHints() []FooterHint {
	if f.Mode == tui.ModeInsert {
		return []FooterHint{
			{Key: "Enter", Desc: "save"},
			{Key: "Esc", Desc: "cancel"},
		}
	}
	return []FooterHint{
		{Key: "j/k", Desc: "navigate"},
		{Key: "Enter", Desc: "edit"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) adminHints() []FooterHint {
	return []FooterHint{
		{Key: "j/k", Desc: "navigate"},
		{Key: "G/g", Desc: "bottom/top"},
		{Key: "Tab", Desc: "tab"},
		{Key: "/", Desc: "search"},
		{Key: "r", Desc: "refresh"},
		{Key: "Ctrl+K", Desc: "command"},
	}
}

func (f Footer) defaultHints() []FooterHint {
	return []FooterHint{
		{Key: "1-7", Desc: "page"},
		{Key: "?", Desc: "help"},
		{Key: "Ctrl+K", Desc: "command"},
		{Key: "q", Desc: "quit"},
	}
}
