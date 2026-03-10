package components

import (
	"fmt"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Header renders the top application header bar.
type Header struct {
	Width       int
	Title       string
	ServerURL   string
	Connected   bool
	PoolSummary string
}

// NewHeader creates a new Header component.
func NewHeader(serverURL string) Header {
	return Header{
		Title:     "Volundr",
		ServerURL: serverURL,
		Connected: false,
	}
}

// NewHeaderWithPool creates a new Header component showing multi-cluster status.
func NewHeaderWithPool(pool *tui.ClientPool) Header {
	server := ""
	if len(pool.Entries) == 1 {
		for _, entry := range pool.Entries {
			server = entry.Server
		}
	}

	connected := len(pool.ConnectedClients()) > 0

	return Header{
		Title:       "Volundr",
		ServerURL:   server,
		Connected:   connected,
		PoolSummary: pool.Summary(),
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

	// Right side: show pool summary if available, otherwise single server URL.
	var rightText string
	if h.PoolSummary != "" {
		rightText = h.PoolSummary
		if h.ServerURL != "" {
			rightText = h.ServerURL + "  " + rightText
		}
	} else {
		rightText = h.ServerURL
	}

	right := fmt.Sprintf("%s %s",
		statusDot,
		serverStyle.Render(rightText),
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
