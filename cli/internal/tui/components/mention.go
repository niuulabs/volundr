package components

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// defaultMaxVisible is the default number of items shown in the mention dropdown.
const defaultMaxVisible = 10

// MentionItem represents a single autocomplete result.
type MentionItem struct {
	Label    string // Display text
	Value    string // Text to insert
	Detail   string // Secondary info (type, status, etc.)
	Icon     string // Unicode icon
	Category string // For grouping
}

// MentionMenu is the autocomplete dropdown state.
type MentionMenu struct {
	Active     bool
	Trigger    rune          // '@', '/', '!'
	Query      string        // Text typed after trigger
	Items      []MentionItem // Current results
	Selected   int           // Cursor position
	MaxVisible int           // Max items to show
	Loading    bool          // Fetching results
}

// NewMentionMenu creates a new mention menu for the given trigger character.
func NewMentionMenu(trigger rune) MentionMenu {
	return MentionMenu{
		Trigger:    trigger,
		MaxVisible: defaultMaxVisible,
	}
}

// Open activates the mention menu and resets state.
func (m *MentionMenu) Open() {
	m.Active = true
	m.Query = ""
	m.Selected = 0
	m.Items = nil
	m.Loading = false
}

// Close deactivates the mention menu.
func (m *MentionMenu) Close() {
	m.Active = false
	m.Query = ""
	m.Selected = 0
	m.Items = nil
	m.Loading = false
}

// IsActive returns whether the menu is currently open.
func (m *MentionMenu) IsActive() bool {
	return m.Active
}

// SetItems updates the item list and clamps the selection.
func (m *MentionMenu) SetItems(items []MentionItem) {
	m.Items = items
	m.Loading = false
	if m.Selected >= len(items) {
		m.Selected = max(0, len(items)-1)
	}
}

// SetQuery updates the filter query text.
func (m *MentionMenu) SetQuery(q string) {
	m.Query = q
}

// MoveUp moves the selection cursor up, wrapping around.
func (m *MentionMenu) MoveUp() {
	if len(m.Items) == 0 {
		return
	}
	m.Selected--
	if m.Selected < 0 {
		m.Selected = len(m.Items) - 1
	}
}

// MoveDown moves the selection cursor down, wrapping around.
func (m *MentionMenu) MoveDown() {
	if len(m.Items) == 0 {
		return
	}
	m.Selected++
	if m.Selected >= len(m.Items) {
		m.Selected = 0
	}
}

// SelectedItem returns the currently selected item, or nil if empty.
func (m *MentionMenu) SelectedItem() *MentionItem {
	if len(m.Items) == 0 {
		return nil
	}
	if m.Selected < 0 || m.Selected >= len(m.Items) {
		return nil
	}
	return &m.Items[m.Selected]
}

// View renders the mention dropdown menu.
func (m MentionMenu) View(width int) string {
	if !m.Active {
		return ""
	}

	theme := tui.DefaultTheme

	if m.Loading {
		loadingStyle := lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Italic(true).
			Padding(0, 1)
		content := loadingStyle.Render("Loading...")
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.Border).
			Width(min(width, 60)).
			Render(content)
	}

	if len(m.Items) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Italic(true).
			Padding(0, 1)
		content := emptyStyle.Render("No matches")
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.Border).
			Width(min(width, 60)).
			Render(content)
	}

	// Determine visible window around selected item.
	visible := m.MaxVisible
	if visible <= 0 {
		visible = defaultMaxVisible
	}

	startIdx := 0
	if len(m.Items) > visible {
		// Center the selected item in the window.
		startIdx = m.Selected - visible/2
		if startIdx < 0 {
			startIdx = 0
		}
		if startIdx+visible > len(m.Items) {
			startIdx = len(m.Items) - visible
		}
	}

	endIdx := startIdx + visible
	if endIdx > len(m.Items) {
		endIdx = len(m.Items)
	}

	// Style definitions.
	iconStyle := lipgloss.NewStyle().Width(3)
	selectedBg := lipgloss.NewStyle().
		Background(theme.AccentAmber).
		Foreground(theme.BgPrimary).
		Bold(true)
	normalLabel := lipgloss.NewStyle().
		Foreground(theme.TextPrimary)
	detailStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	menuWidth := min(width, 60)
	// Account for border (2) and icon column (3) and padding (2).
	labelWidth := menuWidth - 7

	var lines []string

	// Scroll indicator (top).
	if startIdx > 0 {
		lines = append(lines, lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Padding(0, 1).
			Render(fmt.Sprintf("  ... %d more above", startIdx)))
	}

	for i := startIdx; i < endIdx; i++ {
		item := m.Items[i]

		icon := iconStyle.Render(item.Icon)
		label := item.Label
		detail := ""
		if item.Detail != "" {
			detail = " " + item.Detail
		}

		// Truncate if needed.
		maxLabel := labelWidth
		if detail != "" {
			maxLabel -= len(detail) + 1
		}
		if maxLabel < 0 {
			maxLabel = 0
		}
		if len(label) > maxLabel {
			label = label[:max(0, maxLabel-1)] + "~"
		}

		var line string
		if i == m.Selected {
			text := icon + selectedBg.Render(label) + detailStyle.Render(detail)
			line = lipgloss.NewStyle().Padding(0, 1).Render(text)
		} else {
			text := icon + normalLabel.Render(label) + detailStyle.Render(detail)
			line = lipgloss.NewStyle().Padding(0, 1).Render(text)
		}

		lines = append(lines, line)
	}

	// Scroll indicator (bottom).
	remaining := len(m.Items) - endIdx
	if remaining > 0 {
		lines = append(lines, lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Padding(0, 1).
			Render(fmt.Sprintf("  ... %d more below", remaining)))
	}

	content := strings.Join(lines, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.Border).
		Width(menuWidth).
		Render(content)
}

// FuzzyMatch returns true if the query matches the text using a simple
// case-insensitive substring match.
func FuzzyMatch(text, query string) bool {
	if query == "" {
		return true
	}
	return strings.Contains(strings.ToLower(text), strings.ToLower(query))
}
