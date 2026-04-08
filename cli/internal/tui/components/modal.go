package components

import (
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Modal renders a centered overlay dialog.
type Modal struct {
	Title   string
	Content string
	Width   int
	Height  int
	Visible bool
}

// NewModal creates a new modal with the given title.
func NewModal(title string) Modal {
	return Modal{
		Title:   title,
		Width:   60,
		Height:  20,
		Visible: false,
	}
}

// View renders the modal if visible.
func (m Modal) View(termWidth, termHeight int) string {
	if !m.Visible {
		return ""
	}

	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		MarginBottom(1)

	contentStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary)

	modal := lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.AccentAmber).
		Padding(1, 2).
		Width(m.Width).
		MaxHeight(m.Height).
		Render(titleStyle.Render(m.Title) + "\n" + contentStyle.Render(m.Content))

	return lipgloss.Place(
		termWidth, termHeight,
		lipgloss.Center, lipgloss.Center,
		modal,
	)
}
