package components

import (
	"image/color"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// StatusBadge renders a colored status indicator.
type StatusBadge struct {
	Status string
}

// NewStatusBadge creates a new StatusBadge for the given status.
func NewStatusBadge(status string) StatusBadge {
	return StatusBadge{Status: status}
}

// View renders the status badge.
func (s StatusBadge) View() string {
	theme := tui.DefaultTheme

	var clr color.Color
	var dot string

	switch s.Status {
	case "running":
		clr = theme.AccentEmerald
		dot = "●"
	case "starting", "provisioning":
		clr = theme.AccentAmber
		dot = "◐"
	case "stopped":
		clr = theme.TextMuted
		dot = "○"
	case "error", "failed":
		clr = theme.AccentRed
		dot = "●"
	case "completed":
		clr = theme.AccentCyan
		dot = "●"
	case "pending":
		clr = theme.AccentPurple
		dot = "◌"
	case "connected":
		clr = theme.AccentEmerald
		dot = "●"
	case "disconnected":
		clr = theme.TextMuted
		dot = "○"
	default:
		clr = theme.TextMuted
		dot = "○"
	}

	return lipgloss.NewStyle().
		Foreground(clr).
		Render(dot + " " + s.Status)
}
