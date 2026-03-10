// Package tui contains the Bubble Tea TUI application for Volundr.
package tui

import (
	"image/color"

	"charm.land/lipgloss/v2"
)

// Theme defines the complete visual theme matching the Volundr web UI dark palette.
type Theme struct {
	// Background colors
	BgPrimary   color.Color
	BgSecondary color.Color
	BgTertiary  color.Color
	BgElevated  color.Color

	// Text colors
	TextPrimary   color.Color
	TextSecondary color.Color
	TextMuted     color.Color

	// Border colors
	Border       color.Color
	BorderSubtle color.Color

	// Accent colors
	AccentAmber   color.Color
	AccentCyan    color.Color
	AccentEmerald color.Color
	AccentPurple  color.Color
	AccentRed     color.Color
	AccentIndigo  color.Color
	AccentOrange  color.Color
}

// DefaultTheme returns the dark zinc theme matching the web UI.
var DefaultTheme = Theme{
	BgPrimary:   lipgloss.Color("#09090b"),
	BgSecondary: lipgloss.Color("#18181b"),
	BgTertiary:  lipgloss.Color("#27272a"),
	BgElevated:  lipgloss.Color("#3f3f46"),

	TextPrimary:   lipgloss.Color("#fafafa"),
	TextSecondary: lipgloss.Color("#a1a1aa"),
	TextMuted:     lipgloss.Color("#71717a"),

	Border:       lipgloss.Color("#3f3f46"),
	BorderSubtle: lipgloss.Color("#27272a"),

	AccentAmber:   lipgloss.Color("#f59e0b"),
	AccentCyan:    lipgloss.Color("#06b6d4"),
	AccentEmerald: lipgloss.Color("#10b981"),
	AccentPurple:  lipgloss.Color("#a855f7"),
	AccentRed:     lipgloss.Color("#ef4444"),
	AccentIndigo:  lipgloss.Color("#6366f1"),
	AccentOrange:  lipgloss.Color("#f97316"),
}

// Commonly used styles derived from the theme.
var (
	// SidebarStyle is the base style for the navigation sidebar.
	SidebarStyle = lipgloss.NewStyle().
			Background(DefaultTheme.BgSecondary).
			Foreground(DefaultTheme.TextSecondary).
			Padding(1, 2)

	// SidebarActiveStyle highlights the currently selected sidebar item.
	SidebarActiveStyle = lipgloss.NewStyle().
				Background(DefaultTheme.BgTertiary).
				Foreground(DefaultTheme.AccentCyan).
				Bold(true).
				Padding(0, 2)

	// SidebarItemStyle is the default style for sidebar items.
	SidebarItemStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.TextSecondary).
				Padding(0, 2)

	// HeaderStyle is the style for the top header bar.
	HeaderStyle = lipgloss.NewStyle().
			Background(DefaultTheme.BgSecondary).
			Foreground(DefaultTheme.TextPrimary).
			Bold(true).
			Padding(0, 2).
			Width(100)

	// ContentStyle is the base style for the main content area.
	ContentStyle = lipgloss.NewStyle().
			Background(DefaultTheme.BgPrimary).
			Foreground(DefaultTheme.TextPrimary).
			Padding(1, 2)

	// StatusRunning is the style for running status indicators.
	StatusRunning = lipgloss.NewStyle().
			Foreground(DefaultTheme.AccentEmerald).
			Bold(true)

	// StatusStopped is the style for stopped status indicators.
	StatusStopped = lipgloss.NewStyle().
			Foreground(DefaultTheme.TextMuted)

	// StatusError is the style for error status indicators.
	StatusError = lipgloss.NewStyle().
			Foreground(DefaultTheme.AccentRed).
			Bold(true)

	// AccentCyanStyle styles text with the cyan accent color.
	AccentCyanStyle = lipgloss.NewStyle().
			Foreground(DefaultTheme.AccentCyan)

	// AccentAmberStyle styles text with the amber accent color.
	AccentAmberStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.AccentAmber)

	// AccentPurpleStyle styles text with the purple accent color.
	AccentPurpleStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.AccentPurple)

	// AccentEmeraldStyle styles text with the emerald accent color.
	AccentEmeraldStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.AccentEmerald)

	// AccentIndigoStyle styles text with the indigo accent color.
	AccentIndigoStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.AccentIndigo)

	// MutedStyle styles text with the muted color.
	MutedStyle = lipgloss.NewStyle().
			Foreground(DefaultTheme.TextMuted)

	// BorderStyle adds a rounded border with the theme border color.
	BorderStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(DefaultTheme.Border)

	// CardStyle is a bordered container for card-like content.
	CardStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(DefaultTheme.BorderSubtle).
			Padding(1, 2)

	// TabActiveStyle highlights the active tab.
	TabActiveStyle = lipgloss.NewStyle().
			Foreground(DefaultTheme.AccentCyan).
			Bold(true).
			Underline(true).
			Padding(0, 2)

	// TabInactiveStyle is the default tab style.
	TabInactiveStyle = lipgloss.NewStyle().
				Foreground(DefaultTheme.TextMuted).
				Padding(0, 2)

	// DimBorderStyle uses the subtle border color.
	DimBorderStyle = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder()).
			BorderForeground(DefaultTheme.BorderSubtle)
)

// HammerLogo is the ASCII art claw hammer logo for Volundr.
const HammerLogo = `
          ╭───╮
         ╱    ╰──────╮
        ╱  ╭─╮       │
       ╱  ╱   ╰──────╯
      ╱  ╱
     ╱  ╱
    ╱  ╱
   ╱  ╱
  ╱  ╱
 ╱  ╱
╱  ╱
╰─╯
`

// HammerLogoSmall is a compact version of the hammer for inline use.
const HammerLogoSmall = `    ╭─╮──╮
   ╱╭╯  │
  ╱╱╰───╯
 ╱╱
╱╱
╰╯`

// VolundrBanner is the full startup banner with name and tagline.
const VolundrBanner = `
 ╦  ╦╔═╗╦  ╦ ╦╔╗╔╔╦╗╦═╗
 ╚╗╔╝║ ║║  ║ ║║║║ ║║╠╦╝
  ╚╝ ╚═╝╚═╝╚═╝╝╚╝═╩╝╩╚═
`
