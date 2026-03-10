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
	"github.com/charmbracelet/glamour/ansi"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"

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

// ChatHistoryLoadedMsg carries conversation history from the session pod.
type ChatHistoryLoadedMsg struct {
	Turns []api.ConversationTurn
	Err   error
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
	scrollPos   int
	inputActive bool
	width       int
	height      int

	// Session & connection state
	session   *api.Session
	ws        *api.WSClient
	client    *api.Client
	connected bool
	connErr   error
	sender    *tui.ProgramSender

	// Streaming state: tracks the in-flight assistant message
	streamingIdx  int    // index into messages, -1 when not streaming
	streamingText string // accumulated text for current stream
}

// NewChatPage creates a new chat page.
func NewChatPage(client *api.Client, sender *tui.ProgramSender) ChatPage {
	return ChatPage{
		model:        "claude-sonnet-4",
		inputActive:  true,
		client:       client,
		sender:       sender,
		streamingIdx: -1,
	}
}

// Init — no cmds needed; WS callbacks use ProgramSender.Send() directly.
func (c ChatPage) Init() tea.Cmd {
	return nil
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

	// Get a fresh token (auto-refreshes if expired).
	token := c.client.Token()
	c.ws = api.NewWSClient("", token)

	sender := c.sender

	c.ws.OnMessage = func(event api.StreamEvent) {
		sender.Send(ChatStreamEventMsg{Event: event})
	}

	c.ws.OnStateChange = func(state api.WSState) {
		switch state {
		case api.WSConnected:
			sender.Send(ChatConnectedMsg{})
		case api.WSDisconnected:
			sender.Send(ChatDisconnectedMsg{})
		}
	}

	c.ws.OnError = func(err error) {
		sender.Send(ChatDisconnectedMsg{Err: err})
	}

	// Load conversation history from the session pod.
	if sess.CodeEndpoint != "" {
		podClient := api.NewSessionPodClient(sess.CodeEndpoint, token)
		go func() {
			turns, err := podClient.GetConversationHistory()
			sender.Send(ChatHistoryLoadedMsg{Turns: turns, Err: err})
		}()
	}

	// Connect directly to the session pod's chat WS endpoint.
	chatEndpoint := sess.ChatEndpoint
	go func() {
		if err := c.ws.Connect(chatEndpoint); err != nil {
			sender.Send(ChatDisconnectedMsg{Err: err})
		}
	}()
}

// Update handles messages for the chat page.
func (c ChatPage) Update(msg tea.Msg) (ChatPage, tea.Cmd) {
	switch msg := msg.(type) {
	case ChatStreamEventMsg:
		c.handleStreamEvent(msg.Event)
		c.scrollPos = 0
		return c, nil

	case ChatConnectedMsg:
		c.connected = true
		c.connErr = nil
		return c, nil

	case ChatDisconnectedMsg:
		c.connected = false
		c.connErr = msg.Err
		c.finalizeStreaming()
		return c, nil

	case ChatHistoryLoadedMsg:
		if msg.Err != nil {
			c.messages = append(c.messages, ChatMessage{
				Role:      "system",
				Content:   "History: " + msg.Err.Error(),
				Timestamp: time.Now(),
				Status:    "complete",
			})
			return c, nil
		}
		if len(msg.Turns) > 0 {
			// Prepend history before any live messages (system connect msg, etc.)
			history := make([]ChatMessage, 0, len(msg.Turns))
			for _, turn := range msg.Turns {
				ts, _ := time.Parse(time.RFC3339Nano, turn.CreatedAt)
				history = append(history, ChatMessage{
					Role:      turn.Role,
					Content:   turn.Content,
					Timestamp: ts,
					Status:    "complete",
				})
			}
			c.messages = append(history, c.messages...)
			c.scrollPos = 0
		}
		return c, nil

	case tea.KeyMsg:
		key := msg.String()

		// Tab toggles focus between input and scroll mode.
		if key == "tab" {
			c.inputActive = !c.inputActive
			break
		}

		// Esc always deactivates input (switches to scroll mode).
		if key == "esc" {
			c.inputActive = false
			break
		}

		// When input is active, route keys to the text field.
		if c.inputActive {
			switch key {
			case "enter":
				if c.input != "" {
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
				if len(c.input) > 0 {
					c.input = c.input[:len(c.input)-1]
				}
			case "space":
				c.input += " "
			default:
				if len(key) == 1 {
					c.input += key
				}
			}
			break
		}

		// Scroll mode: input is not active.
		switch key {
		case "up", "k":
			c.scrollPos++
		case "down", "j":
			c.scrollPos--
			if c.scrollPos < 0 {
				c.scrollPos = 0
			}
		case "pgup":
			c.scrollPos += c.height / 2
		case "pgdown":
			c.scrollPos -= c.height / 2
			if c.scrollPos < 0 {
				c.scrollPos = 0
			}
		case "G":
			c.scrollPos = 0
		case "g":
			c.scrollPos = 999999
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

	// Chat messages viewport: total height minus all fixed elements.
	// Outer padding(2) + modelBar(1) + gap(1) + msgBorder(2) + gap(1) + input(3) + help(1) = 11
	viewportHeight := c.height - 11
	if viewportHeight < 3 {
		viewportHeight = 3
	}
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

	sessionStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	modelStyle := lipgloss.NewStyle().
		Foreground(theme.TextMuted)

	thinkingStyle := lipgloss.NewStyle().
		Foreground(theme.TextSecondary)

	// Session name — prominent
	var sessionName string
	if c.session != nil {
		sessionName = sessionStyle.Render(c.session.Name)
	}

	// Connection status
	var connStatus string
	if c.connected {
		connStatus = lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render("● Connected")
	} else if c.connErr != nil {
		connStatus = lipgloss.NewStyle().Foreground(theme.AccentRed).Render("○ " + friendlyConnError(c.connErr))
	} else if c.session != nil {
		connStatus = lipgloss.NewStyle().Foreground(theme.TextSecondary).Render("◌ Connecting...")
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

	return fmt.Sprintf("  %s  %s%s  %s",
		sessionName,
		connStatus,
		streamStatus,
		modelStyle.Render(modelName),
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
	totalLines := len(contentLines)

	// Clamp scrollPos to valid range.
	maxScroll := totalLines - maxHeight
	if maxScroll < 0 {
		maxScroll = 0
	}
	if c.scrollPos > maxScroll {
		c.scrollPos = maxScroll
	}

	if totalLines > maxHeight {
		// end is the last visible line (exclusive), start is first visible line.
		end := totalLines - c.scrollPos
		start := end - maxHeight
		if start < 0 {
			start = 0
			end = maxHeight
		}
		if end > totalLines {
			end = totalLines
		}
		contentLines = contentLines[start:end]
	}

	// Scroll position indicator
	scrollHint := ""
	if totalLines > maxHeight && c.scrollPos > 0 {
		linesBelow := c.scrollPos
		scrollHint = lipgloss.NewStyle().
			Foreground(theme.TextMuted).
			Render(fmt.Sprintf(" ↑ scrolled up %d lines (↓/G to return)", linesBelow))
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
		roleStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#d97706")).Bold(true)
		roleIcon = "▸ You"
	case "assistant":
		roleStyle = lipgloss.NewStyle().Foreground(theme.AccentCyan).Bold(true)
		roleIcon = "◈ Assistant"
		if msg.Thinking {
			roleIcon = "◈ Assistant (thinking...)"
		}
		if msg.Status == "running" && !msg.Thinking {
			roleIcon = "◈ Assistant ▍"
		}
	case "system":
		roleStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#d97706")).Bold(true)
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
		borderColor = lipgloss.Color("#d97706")
	} else {
		borderColor = theme.BorderSubtle
	}

	prompt := lipgloss.NewStyle().
		Foreground(lipgloss.Color("#d97706")).
		Bold(true).
		Render("▸ ")

	cursor := ""
	if c.inputActive {
		cursor = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#d97706")).
			Render("█")
	}

	inputContent := prompt + c.input + cursor

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Width(c.width - 6).
		Padding(0, 1).
		Render(inputContent)
}

// chatStyleConfig is a clean, subdued dark style for rendering chat markdown.
// Based on glamour's DarkStyleConfig but with proper headings (no raw ## prefixes)
// and toned-down colors that fit a dark TUI.
var chatStyleConfig = ansi.StyleConfig{
	Document: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			BlockPrefix: "\n",
			BlockSuffix: "\n",
		},
		Margin: uintPtr(2),
	},
	BlockQuote: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color: stringPtr("245"),
		},
		Indent:      uintPtr(1),
		IndentToken: stringPtr("│ "),
	},
	List: ansi.StyleList{
		LevelIndent: 2,
	},
	Heading: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			BlockSuffix: "\n",
			Bold:        boolPtr(true),
		},
	},
	H1: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color:  stringPtr("255"),
			Bold:   boolPtr(true),
			Prefix: "━━ ",
		},
	},
	H2: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color:  stringPtr("255"),
			Bold:   boolPtr(true),
			Prefix: "── ",
		},
	},
	H3: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color: stringPtr("252"),
			Bold:  boolPtr(true),
		},
	},
	H4: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color: stringPtr("250"),
			Bold:  boolPtr(true),
		},
	},
	H5: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color: stringPtr("248"),
			Bold:  boolPtr(true),
		},
	},
	H6: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color: stringPtr("245"),
			Bold:  boolPtr(false),
		},
	},
	Strikethrough: ansi.StylePrimitive{
		CrossedOut: boolPtr(true),
	},
	Emph: ansi.StylePrimitive{
		Italic: boolPtr(true),
	},
	Strong: ansi.StylePrimitive{
		Bold: boolPtr(true),
	},
	HorizontalRule: ansi.StylePrimitive{
		Color:  stringPtr("240"),
		Format: "\n────────\n",
	},
	Item: ansi.StylePrimitive{
		BlockPrefix: "• ",
	},
	Enumeration: ansi.StylePrimitive{
		BlockPrefix: ". ",
	},
	Task: ansi.StyleTask{
		StylePrimitive: ansi.StylePrimitive{},
		Ticked:         "[✓] ",
		Unticked:       "[ ] ",
	},
	Link: ansi.StylePrimitive{
		Color:     stringPtr("244"),
		Underline: boolPtr(true),
	},
	LinkText: ansi.StylePrimitive{
		Bold: boolPtr(true),
	},
	Image: ansi.StylePrimitive{
		Color:     stringPtr("244"),
		Underline: boolPtr(true),
	},
	ImageText: ansi.StylePrimitive{
		Color:  stringPtr("243"),
		Format: "Image: {{.text}} →",
	},
	Code: ansi.StyleBlock{
		StylePrimitive: ansi.StylePrimitive{
			Color:           stringPtr("203"),
			BackgroundColor: stringPtr("236"),
			Prefix:          " ",
			Suffix:          " ",
		},
	},
	CodeBlock: ansi.StyleCodeBlock{
		StyleBlock: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{
				Color: stringPtr("249"),
			},
			Margin: uintPtr(2),
		},
		Chroma: &ansi.Chroma{
			Text:    ansi.StylePrimitive{Color: stringPtr("#C4C4C4")},
			Error:   ansi.StylePrimitive{Color: stringPtr("#C4C4C4")},
			Comment: ansi.StylePrimitive{Color: stringPtr("#6A6A6A")},
			CommentPreproc: ansi.StylePrimitive{Color: stringPtr("#D7875F")},
			Keyword:         ansi.StylePrimitive{Color: stringPtr("#5F87D7")},
			KeywordReserved: ansi.StylePrimitive{Color: stringPtr("#D75FAF")},
			KeywordNamespace: ansi.StylePrimitive{Color: stringPtr("#D7875F")},
			KeywordType:     ansi.StylePrimitive{Color: stringPtr("#5F87AF")},
			Operator:        ansi.StylePrimitive{Color: stringPtr("#AFAFAF")},
			Punctuation:     ansi.StylePrimitive{Color: stringPtr("#AFAFAF")},
			Name:            ansi.StylePrimitive{Color: stringPtr("#C4C4C4")},
			NameBuiltin:     ansi.StylePrimitive{Color: stringPtr("#D7AF87")},
			NameTag:         ansi.StylePrimitive{Color: stringPtr("#5F87D7")},
			NameAttribute:   ansi.StylePrimitive{Color: stringPtr("#87AFD7")},
			NameClass:       ansi.StylePrimitive{Color: stringPtr("#D7D787"), Bold: boolPtr(true)},
			NameDecorator:   ansi.StylePrimitive{Color: stringPtr("#D7D787")},
			NameFunction:    ansi.StylePrimitive{Color: stringPtr("#87D7AF")},
			LiteralNumber:   ansi.StylePrimitive{Color: stringPtr("#87D7D7")},
			LiteralString:   ansi.StylePrimitive{Color: stringPtr("#D7AF87")},
			LiteralStringEscape: ansi.StylePrimitive{Color: stringPtr("#87D7AF")},
			GenericDeleted:  ansi.StylePrimitive{Color: stringPtr("#D75F5F")},
			GenericEmph:     ansi.StylePrimitive{Italic: boolPtr(true)},
			GenericInserted: ansi.StylePrimitive{Color: stringPtr("#87D7AF")},
			GenericStrong:   ansi.StylePrimitive{Bold: boolPtr(true)},
			GenericSubheading: ansi.StylePrimitive{Color: stringPtr("#6A6A6A")},
			Background:      ansi.StylePrimitive{BackgroundColor: stringPtr("#303030")},
		},
	},
	Table: ansi.StyleTable{
		StyleBlock: ansi.StyleBlock{
			StylePrimitive: ansi.StylePrimitive{},
		},
	},
	DefinitionDescription: ansi.StylePrimitive{
		BlockPrefix: "\n→ ",
	},
}

func boolPtr(b bool) *bool     { return &b }
func stringPtr(s string) *string { return &s }
func uintPtr(u uint) *uint     { return &u }

// renderMarkdown renders markdown content for terminal display using glamour.
func renderMarkdown(content string, width int) string {
	r, err := glamour.NewTermRenderer(
		glamour.WithStyles(chatStyleConfig),
		glamour.WithWordWrap(width),
	)
	if err != nil {
		return "  " + content
	}

	rendered, err := r.Render(content)
	if err != nil {
		return "  " + content
	}

	// Strip OSC sequences (hyperlinks, etc.) that cause terminal response
	// sequences which Bubble Tea misinterprets as phantom keypresses.
	rendered = stripOSC(rendered)

	return strings.TrimRight(rendered, "\n")
}

// stripOSC removes OSC (Operating System Command) escape sequences from text.
// These sequences (ESC ] ... ST) can cause terminals to send response sequences
// that Bubble Tea misinterprets as key input.
func stripOSC(s string) string {
	var result strings.Builder
	result.Grow(len(s))
	i := 0
	for i < len(s) {
		// Check for ESC ] (OSC start)
		if i+1 < len(s) && s[i] == '\x1b' && s[i+1] == ']' {
			// Skip until ST (ESC \ or BEL)
			j := i + 2
			for j < len(s) {
				if s[j] == '\x07' { // BEL
					j++
					break
				}
				if j+1 < len(s) && s[j] == '\x1b' && s[j+1] == '\\' { // ESC \
					j += 2
					break
				}
				j++
			}
			i = j
			continue
		}
		result.WriteByte(s[i])
		i++
	}
	return result.String()
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
