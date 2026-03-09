package components

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Sidebar renders the navigation sidebar with page links.
type Sidebar struct {
	ActivePage tui.Page
	Height     int
	Width      int
	Collapsed  bool
}

// NewSidebar creates a new Sidebar component.
func NewSidebar() Sidebar {
	return Sidebar{
		ActivePage: tui.PageSessions,
		Width:      24,
	}
}

// View renders the sidebar.
func (s Sidebar) View() string {
	theme := tui.DefaultTheme

	if s.Collapsed {
		return s.viewCollapsed()
	}

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		Padding(0, 1).
		MarginBottom(1)

	activeStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Background(theme.BgTertiary).
		Bold(true).
		Width(s.Width - 4).
		Padding(0, 1)

	itemStyle := lipgloss.NewStyle().
		Foreground(theme.TextSecondary).
		Width(s.Width - 4).
		Padding(0, 1)

	dimKeyStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	var items []string

	// Title
	items = append(items, titleStyle.Render("⚒ VOLUNDR"))
	items = append(items, "")

	// Navigation items — number key aligned in a column on the right
	nameWidth := 12 // fixed width for name column
	for _, page := range tui.PageOrder {
		info := tui.Pages[page]

		// Pad name to fixed width so numbers align
		name := info.Name
		if len(name) < nameWidth {
			name += strings.Repeat(" ", nameWidth-len(name))
		}

		label := fmt.Sprintf("%s %s%s", info.Icon, name, dimKeyStyle.Render(info.Key))

		if page == s.ActivePage {
			items = append(items, activeStyle.Render(label))
		} else {
			items = append(items, itemStyle.Render(label))
		}
	}

	// Bottom help hint
	availableHeight := s.Height - len(items) - 2
	if availableHeight > 0 {
		items = append(items, strings.Repeat("\n", availableHeight-1))
	}

	helpStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Padding(0, 1)

	items = append(items, helpStyle.Render("? help  q quit"))

	content := strings.Join(items, "\n")

	return lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Width(s.Width).
		Height(s.Height).
		BorderRight(true).
		BorderStyle(lipgloss.NormalBorder()).
		BorderRightForeground(theme.BorderSubtle).
		Render(content)
}

// viewCollapsed renders the minimal collapsed sidebar with only icons.
func (s Sidebar) viewCollapsed() string {
	theme := tui.DefaultTheme
	collapsedWidth := 5

	activeStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Background(theme.BgTertiary).
		Bold(true).
		Width(collapsedWidth - 2).
		Align(lipgloss.Center)

	itemStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Width(collapsedWidth - 2).
		Align(lipgloss.Center)

	var items []string
	items = append(items, lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		Width(collapsedWidth - 2).
		Align(lipgloss.Center).
		Render("⚒"))
	items = append(items, "")

	for _, page := range tui.PageOrder {
		info := tui.Pages[page]
		if page == s.ActivePage {
			items = append(items, activeStyle.Render(info.Icon))
		} else {
			items = append(items, itemStyle.Render(info.Icon))
		}
	}

	content := strings.Join(items, "\n")

	return lipgloss.NewStyle().
		Background(theme.BgSecondary).
		Width(collapsedWidth).
		Height(s.Height).
		BorderRight(true).
		BorderStyle(lipgloss.NormalBorder()).
		BorderRightForeground(theme.BorderSubtle).
		Render(content)
}
