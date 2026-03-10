package pages

import (
	"encoding/json"
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/glamour"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
)

// ChatStreamEventMsg carries an incoming stream event from the WS.
type ChatStreamEventMsg struct {
	Event api.StreamEvent
}

// ChatConnectedMsg signals that the chat WS connected.
type ChatConnectedMsg struct{}

// ChatDisconnectedMsg signals that the chat WS disconnected.
type ChatDisconnectedMsg struct {
	Err error
}

// ChatMessage represents a single message in the chat view.
type ChatMessage struct {
	Role      string // "user", "assistant", "system"
	Content   string
	Timestamp time.Time
	Thinking  bool
	Status    string // "running", "complete", "error"
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

	// Session & connection state
	session   *api.Session
	ws        *api.WSClient
	token     string
	connected bool
	connErr   error
	eventCh   chan ChatStreamEventMsg
	connCh    chan tea.Msg

	// Streaming state: tracks the in-flight assistant message
	streamingIdx  int    // index into messages, -1 when not streaming
	streamingText string // accumulated text for current stream
}

// NewChatPage creates a new chat page.
func NewChatPage(token string) ChatPage {
	return ChatPage{
		model:        "claude-sonnet-4",
		thinking:     50,
		inputActive:  true,
		token:        token,
		eventCh:      make(chan ChatStreamEventMsg, 256),
		connCh:       make(chan tea.Msg, 16),
		streamingIdx: -1,
	}
}

// Init starts listening for async messages.
func (c ChatPage) Init() tea.Cmd {
	return tea.Batch(
		c.waitForEvent(),
		c.waitForConn(),
	)
}

// waitForEvent returns a command that waits for incoming stream events.
func (c ChatPage) waitForEvent() tea.Cmd {
	ch := c.eventCh
	return func() tea.Msg {
		return <-ch
	}
}

// waitForConn returns a command that waits for connection state changes.
func (c ChatPage) waitForConn() tea.Cmd {
	ch := c.connCh
	return func() tea.Msg {
		return <-ch
	}
}

// SetSession connects to a session's chat WebSocket.
func (c *ChatPage) SetSession(sess api.Session) {
	// Close any existing connection.
	if c.ws != nil {
		_ = c.ws.Close()
	}

	c.session = &sess
	c.messages = nil
	c.connected = false
	c.connErr = nil
	c.streamingIdx = -1
	c.streamingText = ""

	// No chat endpoint means session isn't running or doesn't support chat.
	if sess.ChatEndpoint == "" {
		c.connErr = fmt.Errorf("session has no chat endpoint (status: %s)", sess.Status)
		return
	}

	c.ws = api.NewWSClient("", c.token)

	eventCh := c.eventCh
	connCh := c.connCh

	c.ws.OnMessage = func(event api.StreamEvent) {
		select {
		case eventCh <- ChatStreamEventMsg{Event: event}:
		default:
		}
	}

	c.ws.OnStateChange = func(state api.WSState) {
		switch state {
		case api.WSConnected:
			select {
			case connCh <- ChatConnectedMsg{}:
			default:
			}
		case api.WSDisconnected:
			select {
			case connCh <- ChatDisconnectedMsg{}:
			default:
			}
		}
	}

	c.ws.OnError = func(err error) {
		select {
		case connCh <- ChatDisconnectedMsg{Err: err}:
		default:
		}
	}

	// Connect directly to the session pod's chat WS endpoint.
	// WSClient.Connect handles token injection for full wss:// URLs.
	chatEndpoint := sess.ChatEndpoint
	go func() {
		if err := c.ws.Connect(chatEndpoint); err != nil {
			select {
			case connCh <- ChatDisconnectedMsg{Err: err}:
			default:
			}
		}
	}()
}

// Update handles messages for the chat page.
func (c ChatPage) Update(msg tea.Msg) (ChatPage, tea.Cmd) {
	switch msg := msg.(type) {
	case ChatStreamEventMsg:
		c.handleStreamEvent(msg.Event)
		// Auto-scroll to bottom on new content.
		c.scrollPos = 0
		return c, c.waitForEvent()

	case ChatConnectedMsg:
		c.connected = true
		c.connErr = nil
		return c, c.waitForConn()

	case ChatDisconnectedMsg:
		c.connected = false
		c.connErr = msg.Err
		// Finalize any in-flight streaming message.
		c.finalizeStreaming()
		return c, c.waitForConn()

	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if !c.inputActive {
				c.scrollPos++
			}
		case "down", "j":
			if !c.inputActive {
				if c.scrollPos > 0 {
					c.scrollPos--
				}
			}
		case "pgup":
			if !c.inputActive {
				c.scrollPos += 10
			}
		case "pgdown":
			if !c.inputActive {
				c.scrollPos -= 10
				if c.scrollPos < 0 {
					c.scrollPos = 0
				}
			}
		case "G":
			// Jump to bottom (latest messages)
			if !c.inputActive {
				c.scrollPos = 0
			}
		case "g":
			// Jump to top
			if !c.inputActive {
				c.scrollPos = 999999
			}
		case "tab":
			c.inputActive = !c.inputActive
		case "enter":
			if c.inputActive && c.input != "" {
				userMsg := ChatMessage{
					Role:      "user",
					Content:   c.input,
					Timestamp: time.Now(),
					Status:    "complete",
				}
				c.messages = append(c.messages, userMsg)

				// Send over WS if connected.
				if c.ws != nil && c.connected {
					_ = c.ws.SendText(c.input)
				}
				c.input = ""
			}
		case "backspace":
			if c.inputActive && len(c.input) > 0 {
				c.input = c.input[:len(c.input)-1]
			}
		case "space":
			if c.inputActive {
				c.input += " "
			}
		default:
			if c.inputActive && len(msg.String()) == 1 {
				c.input += msg.String()
			}
		}
	}
	return c, nil
}

// handleStreamEvent processes a single Claude CLI stream-json event.
func (c *ChatPage) handleStreamEvent(event api.StreamEvent) {
	switch event.Type {
	case "assistant":
		// Start of a new assistant turn — finalize any previous streaming message.
		c.finalizeStreaming()

		// Extract any initial text from the assistant event's message.content blocks.
		// The session pod often sends the complete response here (no content_block_delta).
		var initialText string
		if event.Message != nil {
			for _, block := range event.Message.Content {
				if block.Type == "text" && block.Text != "" {
					initialText += block.Text
				}
			}
		}

		c.streamingText = initialText
		c.streamingIdx = len(c.messages)
		c.messages = append(c.messages, ChatMessage{
			Role:      "assistant",
			Content:   initialText,
			Timestamp: time.Now(),
			Status:    "running",
		})

	case "content_block_delta":
		if event.Delta == nil {
			return
		}

		// Accumulate text deltas
		if event.Delta.Text != "" {
			c.streamingText += event.Delta.Text
			if c.streamingIdx >= 0 && c.streamingIdx < len(c.messages) {
				c.messages[c.streamingIdx].Content = c.streamingText
			}
		}

		// Accumulate thinking deltas (show as thinking indicator)
		if event.Delta.Thinking != "" && c.streamingIdx >= 0 && c.streamingIdx < len(c.messages) {
			c.messages[c.streamingIdx].Thinking = true
		}

	case "content_block_start":
		// Reset thinking flag when a text block starts
		if event.ContentBlock != nil && event.ContentBlock.Type == "text" {
			if c.streamingIdx >= 0 && c.streamingIdx < len(c.messages) {
				c.messages[c.streamingIdx].Thinking = false
			}
		}

	case "content_block_stop":
		// Block finished, nothing special to do

	case "message_delta":
		// Message-level delta (e.g., stop_reason) — nothing to render

	case "result":
		// The result event carries the final text in its Result field.
		// Use it if the streaming message has no content yet (no deltas arrived).
		if event.Result != "" && c.streamingIdx >= 0 && c.streamingIdx < len(c.messages) {
			if c.streamingText == "" {
				c.streamingText = event.Result
				c.messages[c.streamingIdx].Content = event.Result
			}
		}
		c.finalizeStreaming()

	case "error":
		errText := string(event.Error)
		if errText == "" || errText == "null" {
			errText = "unknown error"
		}
		c.finalizeStreaming()
		c.messages = append(c.messages, ChatMessage{
			Role:      "system",
			Content:   "Error: " + errText,
			Timestamp: time.Now(),
			Status:    "error",
		})

	case "system":
		// System events (hook output, etc.) — show as system message.
		// Content is json.RawMessage; try to unquote if it's a JSON string.
		content := string(event.Content)
		var unquoted string
		if json.Unmarshal(event.Content, &unquoted) == nil {
			content = unquoted
		}
		if content != "" && content != "null" {
			c.messages = append(c.messages, ChatMessage{
				Role:      "system",
				Content:   content,
				Timestamp: time.Now(),
				Status:    "complete",
			})
		}
	}
}

// finalizeStreaming marks the current streaming message as complete.
func (c *ChatPage) finalizeStreaming() {
	if c.streamingIdx < 0 || c.streamingIdx >= len(c.messages) {
		return
	}
	c.messages[c.streamingIdx].Content = c.streamingText
	c.messages[c.streamingIdx].Status = "complete"
	c.messages[c.streamingIdx].Thinking = false
	c.streamingIdx = -1
}

// InputActive returns whether the chat input field is focused.
func (c ChatPage) InputActive() bool {
	return c.inputActive
}

// SetSize updates the page dimensions.
func (c *ChatPage) SetSize(w, h int) {
	c.width = w
	c.height = h
}

// View renders the chat page.
func (c ChatPage) View() string {
	theme := tui.DefaultTheme

	// No session selected
	if c.session == nil {
		return lipgloss.NewStyle().
			Width(c.width).
			Height(c.height).
			Padding(1, 2).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				lipgloss.NewStyle().Foreground(theme.TextPrimary).Bold(true).Render("  Chat"),
				"",
				lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("  Select a session first (press 1 to go to Sessions, then Enter)"),
			))
	}

	// Model indicator bar
	modelBar := c.renderModelBar()

	// Chat messages viewport
	viewportHeight := c.height - 8
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
			lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  Tab: scroll/input  Enter: send  ↑↓/j/k: scroll  PgUp/PgDn: page  G/g: bottom/top"),
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

	// Session info
	var sessionInfo string
	if c.session != nil {
		sessionInfo = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render(fmt.Sprintf("  %s", c.session.Name))
	}

	// Connection status
	var connStatus string
	if c.connected {
		connStatus = lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render("● Connected")
	} else if c.connErr != nil {
		connStatus = lipgloss.NewStyle().Foreground(theme.AccentRed).Render("○ " + friendlyConnError(c.connErr))
	} else if c.session != nil {
		connStatus = lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("◌ Connecting...")
	} else {
		connStatus = lipgloss.NewStyle().Foreground(theme.TextMuted).Render("○ No session")
	}

	modelName := c.model
	if c.session != nil && c.session.Model != "" {
		modelName = c.session.Model
	}

	// Streaming status indicator
	var streamStatus string
	if c.streamingIdx >= 0 {
		if c.streamingIdx < len(c.messages) && c.messages[c.streamingIdx].Thinking {
			streamStatus = thinkingStyle.Render("  ◐ Thinking...")
		} else {
			streamStatus = lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render("  ▸ Streaming...")
		}
	}

	return fmt.Sprintf("  %s%s  %s%s",
		modelStyle.Render("◈ "+modelName),
		sessionInfo,
		connStatus,
		streamStatus,
	)
}

// renderMessages renders the chat message history.
func (c ChatPage) renderMessages(maxHeight int) string {
	theme := tui.DefaultTheme

	if len(c.messages) == 0 {
		hint := "  Send a message to start the conversation"
		if !c.connected {
			hint = "  Waiting for connection..."
		}
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.BorderSubtle).
			Width(c.width - 6).
			Height(maxHeight).
			Padding(2, 1).
			Foreground(theme.TextMuted).
			Render(hint)
	}

	var lines []string
	for _, msg := range c.messages {
		rendered := c.renderMessage(msg)
		lines = append(lines, rendered)
		lines = append(lines, "")
	}

	content := strings.Join(lines, "\n")

	// Scroll viewport: scrollPos=0 means bottom (latest), higher means further back.
	contentLines := strings.Split(content, "\n")
	if len(contentLines) > maxHeight {
		// Default: show the last maxHeight lines (bottom-anchored).
		end := len(contentLines)
		start := end - maxHeight

		// Apply scroll offset (scroll up from bottom).
		if c.scrollPos > 0 {
			end -= c.scrollPos
			start = end - maxHeight
		}

		// Clamp bounds.
		if start < 0 {
			start = 0
		}
		if end < maxHeight {
			end = min(maxHeight, len(contentLines))
			start = 0
		}
		if end > len(contentLines) {
			end = len(contentLines)
		}
		contentLines = contentLines[start:end]
	}

	// Scroll position indicator
	scrollHint := ""
	totalLines := len(strings.Split(content, "\n"))
	if totalLines > maxHeight && c.scrollPos > 0 {
		scrollHint = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render(fmt.Sprintf(" ↑ %d lines above", c.scrollPos))
	}

	rendered := strings.Join(contentLines, "\n")
	if scrollHint != "" {
		rendered = scrollHint + "\n" + rendered
	}

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(c.width - 6).
		Height(maxHeight).
		Padding(0, 1).
		Render(rendered)
}

// renderMessage renders a single chat message.
func (c ChatPage) renderMessage(msg ChatMessage) string {
	theme := tui.DefaultTheme

	timeStr := msg.Timestamp.Format("15:04")

	var roleStyle lipgloss.Style
	var roleIcon string

	switch msg.Role {
	case "user":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentAmber).Bold(true)
		roleIcon = "▸ You"
	case "assistant":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentPurple).Bold(true)
		roleIcon = "◈ Assistant"
		if msg.Thinking {
			roleIcon = "◈ Assistant (thinking...)"
		}
		if msg.Status == "running" && !msg.Thinking {
			roleIcon = "◈ Assistant ▍"
		}
	case "system":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentAmber).Bold(true)
		roleIcon = "⚙ System"
	}

	header := fmt.Sprintf("%s  %s", roleStyle.Render(roleIcon), timeStr)

	maxWidth := c.width - 12
	if maxWidth < 20 {
		maxWidth = 20
	}

	var renderedContent string
	if msg.Role == "assistant" && msg.Content != "" {
		// Render assistant messages as markdown with glamour.
		renderedContent = renderMarkdown(msg.Content, maxWidth)
	} else {
		renderedContent = lipgloss.NewStyle().
			Foreground(theme.TextPrimary).
			PaddingLeft(2).
			Render(wrapText(msg.Content, maxWidth))
	}

	return header + "\n" + renderedContent
}

// renderInput renders the chat input area.
func (c ChatPage) renderInput() string {
	theme := tui.DefaultTheme

	var borderColor color.Color
	if c.inputActive {
		borderColor = theme.AccentAmber
	} else {
		borderColor = theme.BorderSubtle
	}

	prompt := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Bold(true).
		Render("▸ ")

	cursor := ""
	if c.inputActive {
		cursor = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("█")
	}

	inputContent := prompt + c.input + cursor

	// Show connection badge
	var badge string
	if c.connected {
		badge = components.NewStatusBadge("running").View()
	} else {
		badge = components.NewStatusBadge("stopped").View()
	}

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Width(c.width - 6).
		Padding(0, 1).
		Render(inputContent + "  " + badge)
}

// renderMarkdown renders markdown content for terminal display using glamour.
func renderMarkdown(content string, width int) string {
	r, err := glamour.NewTermRenderer(
		glamour.WithAutoStyle(),
		glamour.WithWordWrap(width),
	)
	if err != nil {
		// Fallback to plain text.
		return "  " + content
	}

	rendered, err := r.Render(content)
	if err != nil {
		return "  " + content
	}

	// Glamour adds trailing newlines; trim them.
	return strings.TrimRight(rendered, "\n")
}

// friendlyConnError converts a raw WebSocket/connection error into a user-friendly message.
func friendlyConnError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "bad handshake"):
		return "Connection refused (auth may have expired — try: volundr login)"
	case strings.Contains(msg, "connection refused"):
		return "Session unreachable (is it running?)"
	case strings.Contains(msg, "no such host"):
		return "Session host not found"
	case strings.Contains(msg, "no chat endpoint"):
		return msg // already friendly
	case strings.Contains(msg, "i/o timeout"):
		return "Connection timed out"
	}
	return msg
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
