package components

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// HeaderState represents the server connection state shown in the header.
type HeaderState int

const (
	// HeaderConnecting is the initial state before the ping completes.
	HeaderConnecting HeaderState = iota
	// HeaderConnected means the server ping succeeded.
	HeaderConnected
	// HeaderDisconnected means the server ping failed.
	HeaderDisconnected
)

// Header renders the top application header bar.
type Header struct {
	Width      int
	Title      string
	ServerURL  string
	Connected  bool        // kept for backward compat; use State instead
	State     HeaderState
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
		Foreground(theme.AccentAmber).
		Bold(true)

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	serverStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	var statusDot string
	switch h.State {
	case HeaderConnected:
		statusDot = lipgloss.NewStyle().
			Foreground(theme.AccentEmerald).
			Render("●")
	case HeaderDisconnected:
		statusDot = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render("●")
	default: // HeaderConnecting
		statusDot = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("◌")
	}

	left := fmt.Sprintf("%s %s",
		logoStyle.Render("⚒"),
		titleStyle.Render(h.Title),
	)

	// Strip protocol for a cleaner display.
	displayURL := strings.TrimPrefix(h.ServerURL, "https://")
	displayURL = strings.TrimPrefix(displayURL, "http://")

	right := fmt.Sprintf("%s %s",
		statusDot,
		serverStyle.Render(displayURL),
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
