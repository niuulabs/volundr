package components

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// HelpBinding describes a single keybinding for the help overlay.
type HelpBinding struct {
	Key  string
	Desc string
}

// HelpOverlay renders a centered help dialog showing all keybindings.
type HelpOverlay struct {
	Visible  bool
	Bindings []HelpBinding
}

// DefaultBindings returns the global keybindings.
func DefaultBindings() []HelpBinding {
	return []HelpBinding{
		{Key: "1-7", Desc: "Switch page"},
		{Key: "?", Desc: "Toggle help"},
		{Key: "/", Desc: "Search"},
		{Key: "Tab", Desc: "Next focus"},
		{Key: "Shift+Tab", Desc: "Previous focus"},
		{Key: "Esc", Desc: "Back / Close"},
		{Key: "q", Desc: "Quit"},
		{Key: "Ctrl+C", Desc: "Force quit"},
		{Key: "", Desc: ""},
		{Key: "Sessions", Desc: ""},
		{Key: "Enter", Desc: "Open session"},
		{Key: "n", Desc: "New session"},
		{Key: "s", Desc: "Start session"},
		{Key: "x", Desc: "Stop session"},
		{Key: "d", Desc: "Delete session"},
		{Key: "", Desc: ""},
		{Key: "Chat", Desc: ""},
		{Key: "Enter", Desc: "Send message"},
		{Key: "Ctrl+L", Desc: "Clear chat"},
	}
}

// NewHelpOverlay creates a new help overlay.
func NewHelpOverlay() HelpOverlay {
	return HelpOverlay{
		Bindings: DefaultBindings(),
	}
}

// View renders the help overlay.
func (h HelpOverlay) View(termWidth, termHeight int) string {
	if !h.Visible {
		return ""
	}

	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true)

	keyStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		Width(14).
		Align(lipgloss.Right)

	descStyle := lipgloss.NewStyle().
		Foreground(theme.TextSecondary).
		PaddingLeft(2)

	sectionStyle := lipgloss.NewStyle().
		Foreground(theme.AccentPurple).
		Bold(true).
		MarginTop(1)

	var lines []string
	lines = append(lines, titleStyle.Render("⚒ Volundr Keybindings"))
	lines = append(lines, "")

	for _, b := range h.Bindings {
		if b.Key == "" && b.Desc == "" {
			lines = append(lines, "")
			continue
		}
		if b.Desc == "" {
			// Section header
			lines = append(lines, sectionStyle.Render("── "+b.Key+" ──"))
			continue
		}
		lines = append(lines, fmt.Sprintf("%s %s",
			keyStyle.Render(b.Key),
			descStyle.Render(b.Desc),
		))
	}

	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Align(lipgloss.Center).
		Render("Press ? or Esc to close"))

	content := strings.Join(lines, "\n")

	modal := lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.AccentAmber).
		Padding(1, 3).
		Width(50).
		Render(content)

	return lipgloss.Place(
		termWidth, termHeight,
		lipgloss.Center, lipgloss.Center,
		modal,
	)
}
