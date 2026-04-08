package components

import (
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Tabs renders a horizontal tab bar.
type Tabs struct {
	Items     []string
	ActiveTab int
	Width     int
}

// NewTabs creates a new Tabs component.
func NewTabs(items []string) Tabs {
	return Tabs{
		Items:     items,
		ActiveTab: 0,
	}
}

// View renders the tab bar.
func (t Tabs) View() string {
	theme := tui.DefaultTheme

	activeStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		Underline(true).
		Padding(0, 2)

	inactiveStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Padding(0, 2)

	separatorStyle := lipgloss.NewStyle().
		Foreground(theme.BorderSubtle)

	var tabs []string
	for i, item := range t.Items {
		if i == t.ActiveTab {
			tabs = append(tabs, activeStyle.Render(item))
		} else {
			tabs = append(tabs, inactiveStyle.Render(item))
		}
		if i < len(t.Items)-1 {
			tabs = append(tabs, separatorStyle.Render("│"))
		}
	}

	content := strings.Join(tabs, "")

	bar := lipgloss.NewStyle().
		Width(t.Width).
		BorderBottom(true).
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottomForeground(theme.BorderSubtle).
		Render(content)

	return bar
}
