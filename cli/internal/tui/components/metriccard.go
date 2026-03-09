package components

import (
	"fmt"
	"image/color"

	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// MetricCard displays a single metric with a label and value.
type MetricCard struct {
	Label string
	Value string
	Icon  string
	Color color.Color
	Width int
}

// NewMetricCard creates a new MetricCard.
func NewMetricCard(label, value, icon string, color color.Color) MetricCard {
	return MetricCard{
		Label: label,
		Value: value,
		Icon:  icon,
		Color: color,
		Width: 20,
	}
}

// View renders the metric card.
func (m MetricCard) View() string {
	theme := tui.DefaultTheme

	valueStyle := lipgloss.NewStyle().
		Foreground(m.Color).
		Bold(true)

	labelStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	iconStyle := lipgloss.NewStyle().
		Foreground(m.Color)

	content := fmt.Sprintf("%s %s\n%s",
		iconStyle.Render(m.Icon),
		valueStyle.Render(m.Value),
		labelStyle.Render(m.Label),
	)

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Padding(0, 2).
		Width(m.Width).
		Render(content)
}

// MetricRow renders a horizontal row of metric cards.
func MetricRow(cards []MetricCard) string {
	var rendered []string
	for _, card := range cards {
		rendered = append(rendered, card.View())
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, rendered...)
}
