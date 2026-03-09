package components

import (
	"fmt"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Header renders the top application header bar.
type Header struct {
	Width      int
	Title      string
	ServerURL  string
	Connected  bool
}

// NewHeader creates a new Header component.
func NewHeader(serverURL string) Header {
	return Header{
		Title:     "Volundr",
		ServerURL: serverURL,
		Connected: false,
	}
}

// View renders the header bar.
func (h Header) View() string {
	theme := tui.DefaultTheme

	logoStyle := lipgloss.NewStyle().
		Foreground(theme.AccentCyan).
		Bold(true)

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	serverStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	var statusDot string
	if h.Connected {
		statusDot = lipgloss.NewStyle().
			Foreground(theme.AccentEmerald).
			Render("●")
	} else {
		statusDot = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render("●")
	}

	left := fmt.Sprintf("%s %s",
		logoStyle.Render("⚒"),
		titleStyle.Render(h.Title),
	)

	right := fmt.Sprintf("%s %s",
		statusDot,
		serverStyle.Render(h.ServerURL),
	)

	// Calculate gap to right-align the server info
	gap := h.Width - lipgloss.Width(left) - lipgloss.Width(right) - 4
	if gap < 1 {
		gap = 1
	}

	bar := lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Width(h.Width).
		Padding(0, 2).
		Render(fmt.Sprintf("%s%*s%s", left, gap, "", right))

	return bar
}
