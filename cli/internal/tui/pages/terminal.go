package pages

import (
	"fmt"
	"strings"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/vt"
	"github.com/niuulabs/volundr/cli/internal/api"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Connection status constants for terminal tabs.
const (
	connStatusDisconnected = "disconnected"
	connStatusConnecting   = "connecting"
	connStatusConnected    = "connected"
)

// TerminalOutputMsg signals that new PTY output is available in the vt emulator.
type TerminalOutputMsg struct {
	TabIndex int
}

// TerminalConnectedMsg signals that a terminal tab has connected.
type TerminalConnectedMsg struct {
	TabIndex int
}

// TerminalDisconnectedMsg signals that a terminal tab has disconnected.
type TerminalDisconnectedMsg struct {
	TabIndex int
	Err      error
}

// terminalTab represents a single terminal tab with its own vt emulator and WS connection.
type terminalTab struct {
	label     string
	sessionID string
	emulator  *vt.Emulator
	ws        *api.TerminalWSClient
	connState string
	connErr   error
	mu        sync.Mutex
}

// TerminalPage implements a full remote PTY terminal via WebSocket and x/vt.
type TerminalPage struct {
	width      int
	height     int
	tabs       []*terminalTab
	activeTab  int
	fullScreen bool
	serverURL  string
	client     *api.Client
	pool       *tui.ClientPool
	outputCh   chan TerminalOutputMsg
	connCh     chan tea.Msg
}

// defaultTermWidth and defaultTermHeight are initial vt emulator dimensions
// before the first WindowSizeMsg arrives.
const (
	defaultTermWidth  = 80
	defaultTermHeight = 24
)

// NewTerminalPage creates a new terminal page.
func NewTerminalPage(serverURL string, client *api.Client, pool *tui.ClientPool) TerminalPage {
	outputCh := make(chan TerminalOutputMsg, 256)
	connCh := make(chan tea.Msg, 16)

	return TerminalPage{
		tabs:      nil,
		activeTab: 0,
		serverURL: serverURL,
		client:    client,
		pool:      pool,
		outputCh:  outputCh,
		connCh:    connCh,
	}
}

// Init initializes the terminal page and starts listening for async messages.
func (t TerminalPage) Init() tea.Cmd {
	return tea.Batch(
		t.waitForOutput(),
		t.waitForConn(),
	)
}

// waitForOutput returns a command that waits for terminal output messages.
func (t TerminalPage) waitForOutput() tea.Cmd {
	ch := t.outputCh
	return func() tea.Msg {
		return <-ch
	}
}

// waitForConn returns a command that waits for connection state messages.
func (t TerminalPage) waitForConn() tea.Cmd {
	ch := t.connCh
	return func() tea.Msg {
		return <-ch
	}
}

// Update handles messages for the terminal page.
func (t TerminalPage) Update(msg tea.Msg) (TerminalPage, tea.Cmd) {
	switch msg := msg.(type) {
	case TerminalOutputMsg:
		// New PTY output was written to the vt emulator; re-render.
		return t, t.waitForOutput()

	case TerminalConnectedMsg:
		if msg.TabIndex >= 0 && msg.TabIndex < len(t.tabs) {
			tab := t.tabs[msg.TabIndex]
			tab.mu.Lock()
			tab.connState = connStatusConnected
			tab.connErr = nil
			tab.mu.Unlock()
		}
		return t, t.waitForConn()

	case TerminalDisconnectedMsg:
		if msg.TabIndex >= 0 && msg.TabIndex < len(t.tabs) {
			tab := t.tabs[msg.TabIndex]
			tab.mu.Lock()
			tab.connState = connStatusDisconnected
			tab.connErr = msg.Err
			tab.mu.Unlock()
		}
		return t, t.waitForConn()

	case tea.WindowSizeMsg:
		t.width = msg.Width
		t.height = msg.Height
		t.resizeActiveEmulator()
		return t, nil

	case tea.KeyMsg:
		return t.handleKey(msg)
	}

	return t, nil
}

// handleKey processes keyboard input.
func (t TerminalPage) handleKey(msg tea.KeyMsg) (TerminalPage, tea.Cmd) {
	key := msg.String()

	// Full-screen toggle: F11 or ctrl+f
	if key == "f11" || key == "ctrl+f" {
		t.fullScreen = !t.fullScreen
		t.resizeActiveEmulator()
		return t, nil
	}

	// Tab management: ctrl+t to create new tab
	if key == "ctrl+t" {
		return t, nil // No-op without session; caller should set session first.
	}

	// Tab switching: ctrl+] for next, ctrl+[ for previous
	if key == "ctrl+]" && len(t.tabs) > 1 {
		t.activeTab = (t.activeTab + 1) % len(t.tabs)
		return t, nil
	}
	if key == "ctrl+\\" && len(t.tabs) > 1 {
		t.activeTab = (t.activeTab - 1 + len(t.tabs)) % len(t.tabs)
		return t, nil
	}

	// Close tab: ctrl+w
	if key == "ctrl+w" && len(t.tabs) > 0 {
		t.closeTab(t.activeTab)
		return t, nil
	}

	// Forward all other keys to the active terminal's WebSocket
	if len(t.tabs) == 0 {
		return t, nil
	}

	tab := t.tabs[t.activeTab]
	tab.mu.Lock()
	connected := tab.connState == connStatusConnected
	tab.mu.Unlock()

	if !connected {
		return t, nil
	}

	raw := keyToBytes(msg)
	if len(raw) > 0 {
		_ = tab.ws.SendRaw(raw)
	}

	return t, nil
}

// ConnectSessionOnCluster creates a new terminal tab using the specified cluster's
// server and token. This is used when launching a terminal from a multi-cluster
// session selection.
func (t *TerminalPage) ConnectSessionOnCluster(sess api.Session, contextKey string) {
	if t.pool == nil {
		t.ConnectSession(sess)
		return
	}

	entry := t.pool.GetEntry(contextKey)
	if entry == nil {
		t.ConnectSession(sess)
		return
	}

	t.connectSessionWith(sess, entry.Server, entry.Client.Token())
}

// ConnectSession creates a new terminal tab and connects to the given session.
// It uses the session's CodeEndpoint to connect directly to the session pod.
// If CodeEndpoint is empty, it falls back to the control-plane proxy.
// Any existing tabs are closed first to prevent goroutine leaks.
func (t *TerminalPage) ConnectSession(sess api.Session) {
	// Detach callbacks and close asynchronously to avoid deadlock —
	// Close() fires OnStateChange which calls p.Send() and blocks
	// when called from inside Update().
	for _, tab := range t.tabs {
		tab.ws.OnData = nil
		tab.ws.OnStateChange = nil
		tab.ws.OnError = nil
		oldWS := tab.ws
		oldEmu := tab.emulator
		go func() {
			_ = oldWS.Close()
			_ = oldEmu.Close()
		}()
	}
	t.tabs = nil
	t.activeTab = 0
	token := ""
	if t.client != nil {
		token = t.client.Token()
	}
	t.connectSessionWith(sess, t.serverURL, token)
}

// connectSessionWith creates a new terminal tab with the given server and token.
func (t *TerminalPage) connectSessionWith(sess api.Session, serverURL, token string) {
	w, h := t.termDimensions()

	tab := &terminalTab{
		label:     fmt.Sprintf("term-%d", len(t.tabs)+1),
		sessionID: sess.ID,
		emulator:  vt.NewEmulator(w, h),
		ws:        api.NewTerminalWSClient(serverURL, token),
		connState: connStatusConnecting,
	}

	tabIndex := len(t.tabs)
	t.tabs = append(t.tabs, tab)
	t.activeTab = tabIndex

	outputCh := t.outputCh
	connCh := t.connCh

	// Derive terminal WS URL from chat endpoint (matches web UI pattern).
	// Fallback to control-plane proxy if no endpoint is available.
	var wsURL string
	if sess.ChatEndpoint != "" {
		wsURL = api.TerminalWSURLFromChat(sess.ChatEndpoint)
	} else if sess.CodeEndpoint != "" {
		wsURL = api.SessionWSURL(sess.CodeEndpoint, "/terminal/ws")
	} else {
		wsURL = fmt.Sprintf("/api/v1/volundr/sessions/%s/terminal", sess.ID)
	}

	// Wire up WebSocket callbacks BEFORE Connect() so the readLoop goroutine
	// (started inside Connect) can immediately deliver data and state changes.
	tab.ws.OnData = func(data []byte) {
		tab.mu.Lock()
		_, _ = tab.emulator.Write(data)
		tab.mu.Unlock()
		select {
		case outputCh <- TerminalOutputMsg{TabIndex: tabIndex}:
		default:
		}
	}

	tab.ws.OnStateChange = func(state api.WSState) {
		switch state {
		case api.WSConnected:
			select {
			case connCh <- TerminalConnectedMsg{TabIndex: tabIndex}:
			default:
			}
		case api.WSDisconnected:
			select {
			case connCh <- TerminalDisconnectedMsg{TabIndex: tabIndex}:
			default:
			}
		}
	}

	tab.ws.OnError = func(err error) {
		select {
		case connCh <- TerminalDisconnectedMsg{TabIndex: tabIndex, Err: err}:
		default:
		}
	}

	// Read terminal responses from the vt emulator and send them back to the
	// remote PTY. The emulator writes responses (CPR, color queries, device
	// attributes, etc.) to its internal pipe when the remote application sends
	// terminal queries. Without this reader the pipe blocks, deadlocking
	// emulator.Write() and freezing the WebSocket reader goroutine.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := tab.emulator.Read(buf)
			if err != nil {
				return // emulator closed
			}
			if n > 0 && tab.ws != nil {
				_ = tab.ws.SendRaw(buf[:n])
			}
		}
	}()

	// Connect in the background with retries.
	go func() {
		var err error
		for attempt := 0; attempt < 5; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt) * 2 * time.Second)
			}
			err = tab.ws.Connect(wsURL)
			if err == nil {
				_ = tab.ws.SendResize(w, h)
				return
			}
		}
		select {
		case connCh <- TerminalDisconnectedMsg{TabIndex: tabIndex, Err: err}:
		default:
		}
	}()
}

// closeTab closes and removes the tab at the given index.
func (t *TerminalPage) closeTab(index int) {
	if index < 0 || index >= len(t.tabs) {
		return
	}

	tab := t.tabs[index]
	_ = tab.ws.Close()
	_ = tab.emulator.Close()

	t.tabs = append(t.tabs[:index], t.tabs[index+1:]...)

	if t.activeTab >= len(t.tabs) && t.activeTab > 0 {
		t.activeTab = len(t.tabs) - 1
	}
}

// Close cleans up all terminal connections.
func (t *TerminalPage) Close() {
	for _, tab := range t.tabs {
		_ = tab.ws.Close()
		_ = tab.emulator.Close()
	}
	t.tabs = nil
}

// SetSize updates the page dimensions and resizes the active emulator.
func (t *TerminalPage) SetSize(w, h int) {
	t.width = w
	t.height = h
	t.resizeActiveEmulator()
}

// resizeActiveEmulator updates the vt emulator size and sends a resize message.
func (t *TerminalPage) resizeActiveEmulator() {
	if len(t.tabs) == 0 {
		return
	}

	w, h := t.termDimensions()
	tab := t.tabs[t.activeTab]

	tab.mu.Lock()
	tab.emulator.Resize(w, h)
	tab.mu.Unlock()

	if tab.connState == connStatusConnected {
		_ = tab.ws.SendResize(w, h)
	}
}

// termDimensions returns the width and height available for the vt emulator.
func (t TerminalPage) termDimensions() (int, int) {
	if t.width == 0 || t.height == 0 {
		return defaultTermWidth, defaultTermHeight
	}

	w := t.width - 4 // padding
	h := t.height - 4 // status line + tab bar + padding

	if t.fullScreen {
		w = t.width
		h = t.height - 1 // just status line
	}

	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}

	return w, h
}

// View renders the terminal page.
func (t TerminalPage) View() string {
	theme := tui.DefaultTheme

	// No tabs: show empty state
	if len(t.tabs) == 0 {
		return t.renderEmptyState()
	}

	tab := t.tabs[t.activeTab]

	// Full-screen mode: just terminal + minimal status
	if t.fullScreen {
		return t.renderFullScreen(tab)
	}

	// Tab bar
	tabBar := t.renderTabBar()

	// Connection status line
	statusLine := t.renderStatusLine(tab)

	// Terminal content from vt emulator
	tab.mu.Lock()
	content := tab.emulator.Render()
	tab.mu.Unlock()

	termW, termH := t.termDimensions()
	termStyle := lipgloss.NewStyle().
		Width(termW).
		Height(termH)

	helpText := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Render("  ctrl+t: new tab  ctrl+w: close  ctrl+]/\\: switch tabs  ctrl+f: fullscreen")

	return lipgloss.NewStyle().
		Width(t.width).
		Height(t.height).
		Padding(0, 1).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			tabBar,
			statusLine,
			termStyle.Render(content),
			helpText,
		))
}

// renderEmptyState renders the view when no terminals are open.
func (t TerminalPage) renderEmptyState() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	statusLine := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Render("  Select a running session to open a terminal")

	instructions := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Render("  Press 1 to go to Sessions, select a session, then open terminal")

	return lipgloss.NewStyle().
		Width(t.width).
		Height(t.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("  Terminal"),
			"",
			statusLine,
			"",
			instructions,
		))
}

// renderFullScreen renders the terminal in full-screen mode.
func (t TerminalPage) renderFullScreen(tab *terminalTab) string {
	tab.mu.Lock()
	content := tab.emulator.Render()
	tab.mu.Unlock()

	statusLine := t.renderStatusLine(tab)

	termStyle := lipgloss.NewStyle().
		Width(t.width).
		Height(t.height - 1)

	return lipgloss.JoinVertical(lipgloss.Left,
		termStyle.Render(content),
		statusLine,
	)
}

// renderTabBar renders the tab strip at the top of the terminal.
func (t TerminalPage) renderTabBar() string {
	theme := tui.DefaultTheme
	var tabs []string

	for i, tab := range t.tabs {
		label := tab.label
		if tab.sessionID != "" && len(tab.sessionID) > 8 {
			label = tab.sessionID[:8]
		}

		var style lipgloss.Style
		if i == t.activeTab {
			style = lipgloss.NewStyle().
				Foreground(theme.AccentAmber).
				Bold(true).
				Underline(true).
				Padding(0, 1)
		} else {
			style = lipgloss.NewStyle().
				Foreground(theme.TextMuted).
				Padding(0, 1)
		}

		// Connection indicator
		var indicator string
		tab.mu.Lock()
		state := tab.connState
		tab.mu.Unlock()

		switch state {
		case connStatusConnected:
			indicator = lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render("●")
		case connStatusConnecting:
			indicator = lipgloss.NewStyle().Foreground(theme.AccentAmber).Render("◌")
		default:
			indicator = lipgloss.NewStyle().Foreground(theme.AccentRed).Render("○")
		}

		tabs = append(tabs, fmt.Sprintf("%s %s", indicator, style.Render(label)))
	}

	return "  " + strings.Join(tabs, "  │  ")
}

// renderStatusLine renders the connection status at the bottom.
func (t TerminalPage) renderStatusLine(tab *terminalTab) string {
	theme := tui.DefaultTheme

	tab.mu.Lock()
	state := tab.connState
	connErr := tab.connErr
	sessionID := tab.sessionID
	tab.mu.Unlock()

	var status string
	switch state {
	case connStatusConnected:
		status = lipgloss.NewStyle().
			Foreground(theme.AccentEmerald).
			Render("● Connected")
	case connStatusConnecting:
		status = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render("◌ Connecting...")
	default:
		errMsg := "Disconnected"
		if connErr != nil {
			errMsg = fmt.Sprintf("Disconnected: %v", connErr)
		}
		status = lipgloss.NewStyle().
			Foreground(theme.AccentRed).
			Render("○ " + errMsg)
	}

	sessionInfo := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Render(fmt.Sprintf("session: %s", sessionID))

	w, h := t.termDimensions()
	dims := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Render(fmt.Sprintf("%dx%d", w, h))

	return fmt.Sprintf("  %s  %s  %s", status, sessionInfo, dims)
}

// keyToBytes converts a bubbletea KeyMsg to raw bytes for the PTY.
func keyToBytes(msg tea.KeyMsg) []byte {
	key := msg.String()

	// Map special keys to their ANSI escape sequences.
	switch key {
	case "enter":
		return []byte{'\r'}
	case "tab":
		return []byte{'\t'}
	case "backspace":
		return []byte{0x7f}
	case "delete":
		return []byte{0x1b, '[', '3', '~'}
	case "escape", "esc":
		return []byte{0x1b}
	case "up":
		return []byte{0x1b, '[', 'A'}
	case "down":
		return []byte{0x1b, '[', 'B'}
	case "right":
		return []byte{0x1b, '[', 'C'}
	case "left":
		return []byte{0x1b, '[', 'D'}
	case "home":
		return []byte{0x1b, '[', 'H'}
	case "end":
		return []byte{0x1b, '[', 'F'}
	case "pgup":
		return []byte{0x1b, '[', '5', '~'}
	case "pgdown":
		return []byte{0x1b, '[', '6', '~'}
	case "insert":
		return []byte{0x1b, '[', '2', '~'}
	case "space":
		return []byte{' '}

	// Ctrl+key combinations
	case "ctrl+a":
		return []byte{0x01}
	case "ctrl+b":
		return []byte{0x02}
	case "ctrl+c":
		return []byte{0x03}
	case "ctrl+d":
		return []byte{0x04}
	case "ctrl+e":
		return []byte{0x05}
	case "ctrl+g":
		return []byte{0x07}
	case "ctrl+h":
		return []byte{0x08}
	case "ctrl+k":
		return []byte{0x0b}
	case "ctrl+l":
		return []byte{0x0c}
	case "ctrl+n":
		return []byte{0x0e}
	case "ctrl+o":
		return []byte{0x0f}
	case "ctrl+p":
		return []byte{0x10}
	case "ctrl+r":
		return []byte{0x12}
	case "ctrl+s":
		return []byte{0x13}
	case "ctrl+u":
		return []byte{0x15}
	case "ctrl+v":
		return []byte{0x16}
	case "ctrl+x":
		return []byte{0x18}
	case "ctrl+y":
		return []byte{0x19}
	case "ctrl+z":
		return []byte{0x1a}

	// Function keys
	case "f1":
		return []byte{0x1b, 'O', 'P'}
	case "f2":
		return []byte{0x1b, 'O', 'Q'}
	case "f3":
		return []byte{0x1b, 'O', 'R'}
	case "f4":
		return []byte{0x1b, 'O', 'S'}
	case "f5":
		return []byte{0x1b, '[', '1', '5', '~'}
	case "f6":
		return []byte{0x1b, '[', '1', '7', '~'}
	case "f7":
		return []byte{0x1b, '[', '1', '8', '~'}
	case "f8":
		return []byte{0x1b, '[', '1', '9', '~'}
	case "f9":
		return []byte{0x1b, '[', '2', '0', '~'}
	case "f10":
		return []byte{0x1b, '[', '2', '1', '~'}
	case "f12":
		return []byte{0x1b, '[', '2', '4', '~'}
	}

	// Single printable characters
	if len(key) == 1 {
		return []byte(key)
	}

	// Multi-byte runes (unicode)
	runes := []rune(key)
	if len(runes) == 1 {
		return []byte(string(runes))
	}

	return nil
}
