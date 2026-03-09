package pages

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// ChatMessage represents a single message in the chat view.
type ChatMessage struct {
	Role      string // "user", "assistant", "system"
	Content   string
	Timestamp time.Time
	Thinking  bool
}

// ChatPage implements the chat interface for a session.
type ChatPage struct {
	messages    []ChatMessage
	input       string
	model       string
	thinking    int // thinking budget percentage
	scrollPos   int
	inputActive bool
	width       int
	height      int
}

// NewChatPage creates a new chat page with demo data.
func NewChatPage() ChatPage {
	return ChatPage{
		messages:    demoChatMessages(),
		model:       "claude-sonnet-4",
		thinking:    50,
		inputActive: true,
	}
}

// Init initializes the chat page.
func (c ChatPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the chat page.
func (c ChatPage) Update(msg tea.Msg) (ChatPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up":
			if !c.inputActive && c.scrollPos > 0 {
				c.scrollPos--
			}
		case "down":
			if !c.inputActive {
				c.scrollPos++
			}
		case "tab":
			c.inputActive = !c.inputActive
		case "enter":
			if c.inputActive && c.input != "" {
				c.messages = append(c.messages, ChatMessage{
					Role:      "user",
					Content:   c.input,
					Timestamp: time.Now(),
				})
				c.input = ""
			}
		case "backspace":
			if c.inputActive && len(c.input) > 0 {
				c.input = c.input[:len(c.input)-1]
			}
		default:
			if c.inputActive && len(msg.String()) == 1 {
				c.input += msg.String()
			}
		}
	}
	return c, nil
}

// SetSize updates the page dimensions.
func (c *ChatPage) SetSize(w, h int) {
	c.width = w
	c.height = h
}

// View renders the chat page.
func (c ChatPage) View() string {
	theme := tui.DefaultTheme

	// Model indicator bar
	modelBar := c.renderModelBar()

	// Chat messages viewport
	viewportHeight := c.height - 8 // Reserve space for header, input, model bar
	messages := c.renderMessages(viewportHeight)

	// Input area
	inputArea := c.renderInput()

	return lipgloss.NewStyle().
		Width(c.width).
		Height(c.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			modelBar,
			"",
			messages,
			"",
			inputArea,
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  Tab: toggle focus  Enter: send  ↑↓: scroll"),
		))
}

// renderModelBar renders the model and thinking budget indicators.
func (c ChatPage) renderModelBar() string {
	theme := tui.DefaultTheme

	modelStyle := lipgloss.NewStyle().
		Foreground(theme.AccentPurple).
		Bold(true)

	thinkingStyle := lipgloss.NewStyle().
		Foreground(theme.AccentAmber)

	// Thinking budget bar
	budgetWidth := 20
	filled := budgetWidth * c.thinking / 100
	bar := strings.Repeat("█", filled) + strings.Repeat("░", budgetWidth-filled)

	return fmt.Sprintf("  %s  %s %s %s",
		modelStyle.Render("◈ "+c.model),
		thinkingStyle.Render("Thinking:"),
		thinkingStyle.Render(bar),
		lipgloss.NewStyle().Foreground(theme.TextMuted).Render(fmt.Sprintf("%d%%", c.thinking)),
	)
}

// renderMessages renders the chat message history.
func (c ChatPage) renderMessages(maxHeight int) string {
	theme := tui.DefaultTheme

	var lines []string
	for _, msg := range c.messages {
		rendered := c.renderMessage(msg)
		lines = append(lines, rendered)
		lines = append(lines, "")
	}

	content := strings.Join(lines, "\n")

	// Truncate to viewport
	contentLines := strings.Split(content, "\n")
	if len(contentLines) > maxHeight {
		start := len(contentLines) - maxHeight
		if c.scrollPos > 0 && c.scrollPos < start {
			start = len(contentLines) - maxHeight - c.scrollPos
		}
		if start < 0 {
			start = 0
		}
		contentLines = contentLines[start : start+maxHeight]
	}

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(c.width - 6).
		Height(maxHeight).
		Padding(0, 1).
		Render(strings.Join(contentLines, "\n"))
}

// renderMessage renders a single chat message.
func (c ChatPage) renderMessage(msg ChatMessage) string {
	theme := tui.DefaultTheme

	timeStr := msg.Timestamp.Format("15:04")
	timeStyle := lipgloss.NewStyle().Foreground(theme.TextMuted)

	var roleStyle lipgloss.Style
	var roleIcon string

	switch msg.Role {
	case "user":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentCyan).Bold(true)
		roleIcon = "▸ You"
	case "assistant":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentPurple).Bold(true)
		roleIcon = "◈ Assistant"
	case "system":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentAmber).Bold(true)
		roleIcon = "⚙ System"
	}

	header := fmt.Sprintf("%s  %s", roleStyle.Render(roleIcon), timeStr)

	contentStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		PaddingLeft(2)

	// Wrap long content
	maxWidth := c.width - 12
	wrappedContent := wrapText(msg.Content, maxWidth)

	return header + "\n" + contentStyle.Render(wrappedContent) + "\n" + timeStyle.Render("")
}

// renderInput renders the chat input area.
func (c ChatPage) renderInput() string {
	theme := tui.DefaultTheme

	var borderColor color.Color
	if c.inputActive {
		borderColor = theme.AccentCyan
	} else {
		borderColor = theme.BorderSubtle
	}

	prompt := lipgloss.NewStyle().
		Foreground(theme.AccentCyan).
		Bold(true).
		Render("▸ ")

	cursor := ""
	if c.inputActive {
		cursor = lipgloss.NewStyle().
			Foreground(theme.AccentCyan).
			Render("█")
	}

	inputContent := prompt + c.input + cursor

	badge := components.NewStatusBadge("running")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Width(c.width - 6).
		Padding(0, 1).
		Render(inputContent + "  " + badge.View())
}

// wrapText wraps text to the given width.
func wrapText(text string, width int) string {
	if width <= 0 {
		return text
	}

	var lines []string
	for _, paragraph := range strings.Split(text, "\n") {
		if len(paragraph) <= width {
			lines = append(lines, paragraph)
			continue
		}

		words := strings.Fields(paragraph)
		var line string
		for _, word := range words {
			if len(line)+len(word)+1 > width {
				lines = append(lines, line)
				line = word
			} else if line == "" {
				line = word
			} else {
				line += " " + word
			}
		}
		if line != "" {
			lines = append(lines, line)
		}
	}

	return strings.Join(lines, "\n")
}

// demoChatMessages returns realistic demo chat data.
func demoChatMessages() []ChatMessage {
	base := time.Date(2026, 3, 8, 14, 0, 0, 0, time.UTC)
	return []ChatMessage{
		{
			Role:      "user",
			Content:   "Can you add WebSocket reconnection logic to the API client? It should automatically retry with exponential backoff when the connection drops.",
			Timestamp: base,
		},
		{
			Role:      "assistant",
			Content:   "I'll implement WebSocket reconnection with exponential backoff. Let me start by examining the current WebSocket client implementation.\n\nI can see the client in `internal/api/ws.go`. I'll add:\n\n1. A reconnection loop with configurable max retries\n2. Exponential backoff starting at 1s, capping at 30s\n3. A jitter factor to prevent thundering herd\n4. State change notifications so the UI can show connection status\n\nLet me make the changes now.",
			Timestamp: base.Add(15 * time.Second),
		},
		{
			Role:      "system",
			Content:   "Modified: internal/api/ws.go (+47 lines, -3 lines)",
			Timestamp: base.Add(45 * time.Second),
		},
		{
			Role:      "assistant",
			Content:   "Done. The reconnection logic is now in place. Key changes:\n\n- Added `reconnect()` method with exponential backoff (1s -> 2s -> 4s -> ... -> 30s cap)\n- Added jitter of 0-500ms to prevent synchronized reconnection storms\n- The `OnStateChange` callback now fires with `WSReconnecting` state\n- Max 10 retry attempts before giving up (configurable via `MaxRetries` field)\n\nWould you like me to add unit tests for the reconnection logic?",
			Timestamp: base.Add(90 * time.Second),
		},
		{
			Role:      "user",
			Content:   "Yes, please add tests. Also make sure the reconnection preserves any pending message queue.",
			Timestamp: base.Add(120 * time.Second),
		},
		{
			Role:      "assistant",
			Content:   "Good call on the message queue. I'll add a buffered channel that holds messages during disconnection, and flush them on reconnect. Let me implement both the queue and the tests.",
			Timestamp: base.Add(135 * time.Second),
		},
	}
}
