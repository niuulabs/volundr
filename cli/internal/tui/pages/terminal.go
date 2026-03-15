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

// TerminalSessionsLoadedMsg carries discovered/spawned sessions from a goroutine
// back into the Update loop so tabs can be created synchronously.
type TerminalSessionsLoadedMsg struct {
	Sessions []api.CliSession
}

// TerminalSpawnedMsg carries a single newly spawned session into the Update loop.
type TerminalSpawnedMsg struct {
	Session api.CliSession
}

// terminalTab represents a single terminal tab with its own vt emulator and WS connection.
type terminalTab struct {
	label      string
	terminalID string // server-side tmux session ID (for kill calls)
	sessionID  string
	wsURL      string // WebSocket URL for reconnecting on tab switch
	emulator   *vt.Emulator
	ws         *api.TerminalWSClient
	connState  string
	connErr    error
	mu         sync.Mutex

	// history keeps rendered screen snapshots for scrollback.
	// On each output event, the current screen lines are appended
	// (deduplicating against the previous snapshot). This allows
	// scrolling even when the emulator is in alternate screen mode
	// (tmux), where the native scrollback buffer is unavailable.
	history    []string
	lastRender string // previous Render() output for dedup
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

	// activeSession is stored so new tabs can be spawned from ctrl+t.
	activeSession *api.Session
	activeToken   string

	// insertMode tracks whether keystrokes are forwarded to the PTY (true)
	// or handled as navigation commands (false). Esc exits insert mode,
	// i re-enters it — mirroring the chat page's input/scroll modes.
	insertMode bool

	// scrollPos tracks scroll offset in normal mode. 0 = live view (bottom),
	// >0 = scrolled up into scrollback history. Mirrors chat page behavior.
	scrollPos int
}

// defaultTermWidth and defaultTermHeight are initial vt emulator dimensions
// before the first WindowSizeMsg arrives.
const (
	defaultTermWidth  = 80
	defaultTermHeight = 24
)

// scrollbackMaxLines is the number of scrollback lines retained per terminal tab.
const scrollbackMaxLines = 10000

// NewTerminalPage creates a new terminal page.
func NewTerminalPage(serverURL string, client *api.Client, pool *tui.ClientPool) TerminalPage {
	outputCh := make(chan TerminalOutputMsg, 256)
	connCh := make(chan tea.Msg, 16)

	return TerminalPage{
		tabs:       nil,
		activeTab:  0,
		serverURL:  serverURL,
		client:     client,
		pool:       pool,
		outputCh:   outputCh,
		connCh:     connCh,
		insertMode: false,
	}
}

// Init initializes the terminal page and starts listening for async messages.
func (t TerminalPage) Init() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	return tea.Batch(
		t.waitForOutput(),
		t.waitForConn(),
	)
}

// waitForOutput returns a command that waits for terminal output messages.
func (t TerminalPage) waitForOutput() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	ch := t.outputCh
	return func() tea.Msg {
		return <-ch
	}
}

// waitForConn returns a command that waits for connection state messages.
func (t TerminalPage) waitForConn() tea.Cmd { //nolint:gocritic // value receiver needed for page interface consistency
	ch := t.connCh
	return func() tea.Msg {
		return <-ch
	}
}

// Update handles messages for the terminal page.
func (t TerminalPage) Update(msg tea.Msg) (TerminalPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	switch msg := msg.(type) {
	case TerminalOutputMsg:
		// Capture rendered lines into scrollback history.
		if msg.TabIndex >= 0 && msg.TabIndex < len(t.tabs) {
			tab := t.tabs[msg.TabIndex]
			tab.mu.Lock()
			t.captureHistory(tab)
			tab.mu.Unlock()
		}
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

	case TerminalSessionsLoadedMsg:
		// Sessions discovered by the background goroutine — create tabs.
		t.handleSessionsLoaded(msg.Sessions)
		return t, t.waitForConn()

	case TerminalSpawnedMsg:
		// A single new session was spawned — create a tab and switch to it.
		t.handleSpawned(msg.Session)
		return t, t.waitForConn()

	case tea.WindowSizeMsg:
		t.width = msg.Width
		t.height = msg.Height
		t.resizeAllEmulators()
		return t, nil

	case tea.KeyMsg:
		return t.handleKey(msg)
	}

	return t, nil
}

// handleKey processes keyboard input.
func (t TerminalPage) handleKey(msg tea.KeyMsg) (TerminalPage, tea.Cmd) { //nolint:gocritic // value receiver needed for page interface consistency
	key := msg.String()

	// Esc always exits insert mode (consistent with chat page).
	if key == "esc" && t.insertMode {
		t.insertMode = false
		return t, nil
	}

	// Ctrl+] toggles between insert and normal mode (classic telnet escape).
	// Match both "ctrl+]" (Kitty protocol) and raw 0x1D (legacy terminals).
	if key == "ctrl+]" || msg.Key().Code == 0x1D {
		t.insertMode = !t.insertMode
		return t, nil
	}

	// Full-screen toggle: F11 or ctrl+f (works in both modes).
	if key == "f11" || key == "ctrl+f" {
		t.fullScreen = !t.fullScreen
		t.resizeAllEmulators()
		return t, nil
	}

	// Tab management works in both modes.
	if key == "ctrl+t" {
		t.spawnNewTab()
		return t, nil
	}
	if key == "ctrl+n" && len(t.tabs) > 1 {
		t.activeTab = (t.activeTab + 1) % len(t.tabs)
		t.connectTab(t.activeTab)
		return t, nil
	}
	if key == "ctrl+p" && len(t.tabs) > 1 {
		t.activeTab = (t.activeTab - 1 + len(t.tabs)) % len(t.tabs)
		t.connectTab(t.activeTab)
		return t, nil
	}
	if key == "ctrl+w" && len(t.tabs) > 0 {
		t.closeTab(t.activeTab)
		return t, nil
	}

	// --- Normal mode ---
	if !t.insertMode {
		switch key {
		case "i":
			t.insertMode = true
			t.scrollPos = 0 // snap to live view on insert
		case "up", "k":
			t.scrollPos++
			t.clampScroll()
		case "down", "j":
			t.scrollPos--
			if t.scrollPos < 0 {
				t.scrollPos = 0
			}
		case "pgup":
			_, h := t.termDimensions()
			t.scrollPos += h / 2
			t.clampScroll()
		case "pgdown":
			_, h := t.termDimensions()
			t.scrollPos -= h / 2
			if t.scrollPos < 0 {
				t.scrollPos = 0
			}
		case "G":
			t.scrollPos = 0 // jump to bottom (live view)
		case "g":
			if len(t.tabs) > 0 {
				tab := t.tabs[t.activeTab]
				tab.mu.Lock()
				t.scrollPos = len(tab.history)
				tab.mu.Unlock()
			}
		// Tab navigation consistent with other pages
		case "tab":
			if len(t.tabs) > 1 {
				t.activeTab = (t.activeTab + 1) % len(t.tabs)
				t.connectTab(t.activeTab)
				t.scrollPos = 0
			}
		case "shift+tab":
			if len(t.tabs) > 1 {
				t.activeTab = (t.activeTab - 1 + len(t.tabs)) % len(t.tabs)
				t.connectTab(t.activeTab)
				t.scrollPos = 0
			}
		}
		// All other keys fall through to the app layer for page nav (1-7, q, ?, [).
		return t, nil
	}

	// --- Insert mode: forward keys to the active PTY ---
	if len(t.tabs) == 0 {
		return t, nil
	}

	tab := t.tabs[t.activeTab]
	if tab.ws == nil {
		return t, nil
	}

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
func (t *TerminalPage) ConnectSessionOnCluster(sess api.Session, contextKey string) { //nolint:gocritic // hugeParam acceptable for API type
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
func (t *TerminalPage) ConnectSession(sess api.Session) { //nolint:gocritic // hugeParam acceptable for API type
	// Detach callbacks and close asynchronously to avoid deadlock —
	// Close() fires OnStateChange which calls p.Send() and blocks
	// when called from inside Update().
	for _, tab := range t.tabs {
		if tab.ws != nil {
			tab.ws.OnData = nil
			tab.ws.OnStateChange = nil
			tab.ws.OnError = nil
			oldWS := tab.ws
			go func() { _ = oldWS.Close() }()
		}
		oldEmu := tab.emulator
		go func() { _ = oldEmu.Close() }()
	}
	t.tabs = nil
	t.activeTab = 0
	token := ""
	if t.client != nil {
		token = t.client.Token()
	}
	t.connectSessionWith(sess, t.serverURL, token)
}

// ConnectCliSession creates a new terminal tab connected to a persistent CLI session.
// It derives the WebSocket URL from the Volundr session's chat or code endpoint
// and connects to /terminal/ws/{terminalId} on the session pod via devrunner.
func (t *TerminalPage) ConnectCliSession(sess api.Session, sessionName string) { //nolint:gocritic // hugeParam acceptable for API type
	// Close existing tabs to prevent goroutine leaks.
	for _, tab := range t.tabs {
		if tab.ws != nil {
			tab.ws.OnData = nil
			tab.ws.OnStateChange = nil
			tab.ws.OnError = nil
			oldWS := tab.ws
			go func() { _ = oldWS.Close() }()
		}
		oldEmu := tab.emulator
		go func() { _ = oldEmu.Close() }()
	}
	t.tabs = nil
	t.activeTab = 0

	token := ""
	if t.client != nil {
		token = t.client.Token()
	}

	t.connectCliSessionWith(sess, t.serverURL, token, sessionName)
}

// ConnectCliSessionOnCluster creates a terminal tab for a CLI session using
// the specified cluster's server and token.
func (t *TerminalPage) ConnectCliSessionOnCluster(sess api.Session, contextKey, sessionName string) { //nolint:gocritic // hugeParam acceptable for API type
	if t.pool == nil {
		t.ConnectCliSession(sess, sessionName)
		return
	}

	entry := t.pool.GetEntry(contextKey)
	if entry == nil {
		t.ConnectCliSession(sess, sessionName)
		return
	}

	t.connectCliSessionWith(sess, entry.Server, entry.Client.Token(), sessionName)
}

// connectCliSessionWith creates a terminal tab connected to a CLI session WebSocket.
func (t *TerminalPage) connectCliSessionWith(sess api.Session, _, token, sessionName string) { //nolint:gocritic // hugeParam acceptable for API type
	t.activeSession = &sess
	t.activeToken = token

	label := fmt.Sprintf("cli:%s", sessionName)
	wsURL := api.CliSessionWSURL(sess.CodeEndpoint, sessionName)
	t.createTab(sess.ID, label, sessionName, wsURL)
	t.activeTab = len(t.tabs) - 1
	t.connectTab(t.activeTab)
}

// connectSessionWith discovers existing terminal sessions (or spawns one) and
// sends a message back to the Update loop to create tabs synchronously.
func (t *TerminalPage) connectSessionWith(sess api.Session, _, token string) { //nolint:gocritic // hugeParam acceptable for API type
	// Store session context so ctrl+t can spawn additional tabs.
	t.activeSession = &sess
	t.activeToken = token

	connCh := t.connCh

	// Discover sessions in the background; Update will create the tabs.
	go func() {
		podClient := api.NewSessionPodClient(sess.CodeEndpoint, token)

		var sessions []api.CliSession

		// Try listing existing sessions first.
		if list, err := podClient.ListCliSessions(); err == nil && len(list.Sessions) > 0 {
			sessions = list.Sessions
		} else {
			// No existing sessions — spawn a fresh shell.
			req := api.CreateCliSessionRequest{CliType: "shell"}
			if created, err := podClient.CreateCliSession(req); err == nil {
				sessions = []api.CliSession{*created}
			}
		}

		if len(sessions) == 0 {
			select {
			case connCh <- TerminalDisconnectedMsg{TabIndex: 0, Err: fmt.Errorf("failed to resolve terminal sessions")}:
			default:
			}
			return
		}

		select {
		case connCh <- TerminalSessionsLoadedMsg{Sessions: sessions}:
		default:
		}
	}()
}

// handleSessionsLoaded creates tabs for all discovered sessions.
// Only the first tab's WebSocket is connected (server multiplexes all
// connections to the active tmux window, so only one can be connected).
// Called from Update so tab creation is synchronous with Bubble Tea.
func (t *TerminalPage) handleSessionsLoaded(sessions []api.CliSession) {
	if t.activeSession == nil || len(sessions) == 0 {
		return
	}

	// Clear any stale tabs from a previous session.
	for _, tab := range t.tabs {
		if tab.ws != nil {
			tab.ws.OnData = nil
			tab.ws.OnStateChange = nil
			tab.ws.OnError = nil
			oldWS := tab.ws
			go func() { _ = oldWS.Close() }()
		}
		_ = tab.emulator.Close()
	}
	t.tabs = nil
	t.activeTab = 0

	for _, s := range sessions {
		label := s.Label
		if label == "" {
			label = s.TerminalID
		}
		wsURL := api.CliSessionWSURL(t.activeSession.CodeEndpoint, s.TerminalID)
		t.createTab(t.activeSession.ID, label, s.TerminalID, wsURL)
	}

	// Connect only the first tab.
	if len(t.tabs) > 0 {
		t.connectTab(0)
	}
}

// handleSpawned creates a tab for a newly spawned session and switches to it.
// Called from Update so tab creation is synchronous with Bubble Tea.
func (t *TerminalPage) handleSpawned(s api.CliSession) {
	if t.activeSession == nil {
		return
	}

	label := s.Label
	if label == "" {
		label = s.TerminalID
	}
	wsURL := api.CliSessionWSURL(t.activeSession.CodeEndpoint, s.TerminalID)
	t.createTab(t.activeSession.ID, label, s.TerminalID, wsURL)
	t.activeTab = len(t.tabs) - 1
	t.connectTab(t.activeTab)
}

// createTab creates a terminal tab with an emulator but does NOT connect
// the WebSocket. Call connectTab to start the WebSocket connection.
// Must be called from the Update loop.
func (t *TerminalPage) createTab(sessionID, label, terminalID, wsURL string) {
	w, h := t.termDimensions()

	emu := vt.NewEmulator(w, h)
	emu.SetScrollbackSize(scrollbackMaxLines)

	tab := &terminalTab{
		label:      label,
		terminalID: terminalID,
		sessionID:  sessionID,
		wsURL:      wsURL,
		emulator:   emu,
		connState:  connStatusDisconnected,
	}

	t.tabs = append(t.tabs, tab)

	// Drain emulator responses to prevent pipe deadlock.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := tab.emulator.Read(buf)
			if err != nil {
				return
			}
			// Forward terminal query responses back via WebSocket.
			if n > 0 && tab.ws != nil && tab.ws.State() == api.WSConnected {
				_ = tab.ws.SendRaw(buf[:n])
			}
		}
	}()
}

// connectTab connects the WebSocket for the tab at the given index.
// Any previously connected tab's WebSocket is disconnected first,
// matching the web UI's single-connection-at-a-time approach
// (the server multiplexes all connections to the active tmux window).
func (t *TerminalPage) connectTab(index int) {
	if index < 0 || index >= len(t.tabs) {
		return
	}

	// Disconnect all other tabs' WebSockets.
	for i, tab := range t.tabs {
		if i == index {
			continue
		}
		if tab.ws != nil && tab.ws.State() != api.WSDisconnected {
			tab.ws.OnData = nil
			tab.ws.OnStateChange = nil
			tab.ws.OnError = nil
			oldWS := tab.ws
			tab.ws = nil
			go func() { _ = oldWS.Close() }()
			tab.mu.Lock()
			tab.connState = connStatusDisconnected
			tab.mu.Unlock()
		}
	}

	tab := t.tabs[index]
	outputCh := t.outputCh
	connCh := t.connCh
	wsURL := tab.wsURL
	w, h := t.termDimensions()

	// Create a fresh WebSocket client for this tab.
	tab.ws = api.NewTerminalWSClient(t.serverURL, t.activeToken)
	tab.mu.Lock()
	tab.connState = connStatusConnecting
	tab.mu.Unlock()

	tab.ws.OnData = func(data []byte) {
		tab.mu.Lock()
		_, _ = tab.emulator.Write(data)
		tab.mu.Unlock()
		select {
		case outputCh <- TerminalOutputMsg{TabIndex: index}:
		default:
		}
	}

	tab.ws.OnStateChange = func(state api.WSState) {
		switch state {
		case api.WSConnected:
			select {
			case connCh <- TerminalConnectedMsg{TabIndex: index}:
			default:
			}
		case api.WSDisconnected:
			select {
			case connCh <- TerminalDisconnectedMsg{TabIndex: index}:
			default:
			}
		case api.WSConnecting, api.WSReconnecting:
			// Transitional states, no action needed.
		}
	}

	tab.ws.OnError = func(err error) {
		select {
		case connCh <- TerminalDisconnectedMsg{TabIndex: index, Err: err}:
		default:
		}
	}

	// Connect in the background.
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
		case connCh <- TerminalDisconnectedMsg{TabIndex: index, Err: err}:
		default:
		}
	}()
}

// spawnNewTab spawns a new shell terminal tab via the REST API.
func (t *TerminalPage) spawnNewTab() {
	if t.activeSession == nil {
		return
	}
	sess := *t.activeSession
	token := t.activeToken
	connCh := t.connCh

	// Spawn in the background; Update will create the tab when the message arrives.
	go func() {
		podClient := api.NewSessionPodClient(sess.CodeEndpoint, token)
		req := api.CreateCliSessionRequest{CliType: "shell"}
		created, err := podClient.CreateCliSession(req)
		if err != nil {
			select {
			case connCh <- TerminalDisconnectedMsg{TabIndex: 0, Err: fmt.Errorf("spawn failed: %w", err)}:
			default:
			}
			return
		}

		select {
		case connCh <- TerminalSpawnedMsg{Session: *created}:
		default:
		}
	}()
}

// closeTab closes and removes the tab at the given index,
// killing the server-side tmux session.
func (t *TerminalPage) closeTab(index int) {
	if index < 0 || index >= len(t.tabs) {
		return
	}

	tab := t.tabs[index]

	// Kill server-side session in the background.
	if tab.terminalID != "" && t.activeSession != nil {
		sess := *t.activeSession
		token := t.activeToken
		termID := tab.terminalID
		go func() {
			podClient := api.NewSessionPodClient(sess.CodeEndpoint, token)
			_ = podClient.KillCliSession(termID)
		}()
	}

	if tab.ws != nil {
		_ = tab.ws.Close()
	}
	_ = tab.emulator.Close()

	t.tabs = append(t.tabs[:index], t.tabs[index+1:]...)

	if t.activeTab >= len(t.tabs) && t.activeTab > 0 {
		t.activeTab = len(t.tabs) - 1
	}

	// Connect the new active tab if we closed the one that was connected.
	if len(t.tabs) > 0 {
		t.connectTab(t.activeTab)
	}
}

// Close cleans up all terminal connections.
func (t *TerminalPage) Close() {
	for _, tab := range t.tabs {
		if tab.ws != nil {
			_ = tab.ws.Close()
		}
		_ = tab.emulator.Close()
	}
	t.tabs = nil
}

// InsertMode returns whether the terminal is in insert mode (keys go to PTY).
func (t TerminalPage) InsertMode() bool { //nolint:gocritic // value receiver needed for page interface consistency
	return t.insertMode
}

// SetSize updates the page dimensions and resizes all emulators.
func (t *TerminalPage) SetSize(w, h int) {
	t.width = w
	t.height = h
	t.resizeAllEmulators()
}

// resizeAllEmulators updates all vt emulator sizes and notifies the
// active tab's WebSocket so tmux redraws at the new size.
func (t *TerminalPage) resizeAllEmulators() {
	if len(t.tabs) == 0 {
		return
	}

	w, h := t.termDimensions()

	for _, tab := range t.tabs {
		tab.mu.Lock()
		tab.emulator.Resize(w, h)
		tab.mu.Unlock()
	}

	// Only the active tab has a WebSocket connection.
	activeTab := t.tabs[t.activeTab]
	if activeTab.ws != nil && activeTab.ws.State() == api.WSConnected {
		_ = activeTab.ws.SendResize(w, h)
	}
}

// termDimensions returns the width and height available for the vt emulator.
func (t TerminalPage) termDimensions() (int, int) { //nolint:gocritic // value receiver needed for page interface consistency
	if t.width == 0 || t.height == 0 {
		return defaultTermWidth, defaultTermHeight
	}

	w := t.width - 4  // padding
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
func (t TerminalPage) View() string { //nolint:gocritic // value receiver needed for page interface consistency
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

	termW, termH := t.termDimensions()

	// Terminal content: live view or scrollback
	tab.mu.Lock()
	var content string
	if t.scrollPos > 0 {
		content = t.renderScrollback(tab, termW, termH)
	} else {
		content = tab.emulator.Render()
	}
	tab.mu.Unlock()

	termStyle := lipgloss.NewStyle().
		Width(termW).
		Height(termH)

	// Scroll indicator when scrolled up
	var scrollHint string
	if t.scrollPos > 0 {
		scrollHint = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Render(fmt.Sprintf("  ↑ scrolled up %d lines (G to return to live)", t.scrollPos))
	}

	elements := []string{tabBar, termStyle.Render(content)}
	if scrollHint != "" {
		elements = append(elements, scrollHint)
	}

	return lipgloss.NewStyle().
		Width(t.width).
		Height(t.height).
		Padding(0, 1).
		Render(lipgloss.JoinVertical(lipgloss.Left, elements...))
}

// captureHistory appends new lines from the current render to the tab's
// history buffer. Compares against lastRender to avoid duplicating the same
// screen. Must be called with tab.mu held.
func (t TerminalPage) captureHistory(tab *terminalTab) { //nolint:gocritic // value receiver
	rendered := tab.emulator.Render()
	if rendered == tab.lastRender {
		return
	}

	lines := strings.Split(rendered, "\n")

	// Append current screen lines to scrollback history.
	// Whether this is the first render or a subsequent one, the
	// behavior is the same: accumulate lines and let scroll handle dedup.
	tab.history = append(tab.history, lines...)

	tab.lastRender = rendered

	// Cap history size.
	if len(tab.history) > scrollbackMaxLines {
		excess := len(tab.history) - scrollbackMaxLines
		tab.history = tab.history[excess:]
	}
}

// renderScrollback renders from the history buffer at the current scroll offset.
// Must be called with tab.mu held.
func (t TerminalPage) renderScrollback(tab *terminalTab, _, height int) string { //nolint:gocritic // value receiver needed for page interface consistency
	if len(tab.history) == 0 {
		return tab.emulator.Render()
	}

	totalLines := len(tab.history)

	// scrollPos is lines scrolled up from the bottom.
	end := totalLines - t.scrollPos
	if end > totalLines {
		end = totalLines
	}
	if end < 0 {
		end = 0
	}
	start := end - height
	if start < 0 {
		start = 0
	}

	visible := tab.history[start:end]
	return strings.Join(visible, "\n")
}

// clampScroll ensures scrollPos doesn't exceed available history.
func (t *TerminalPage) clampScroll() {
	if len(t.tabs) == 0 {
		t.scrollPos = 0
		return
	}
	tab := t.tabs[t.activeTab]
	tab.mu.Lock()
	maxPos := len(tab.history)
	tab.mu.Unlock()
	if t.scrollPos > maxPos {
		t.scrollPos = maxPos
	}
}

// renderEmptyState renders the view when no terminals are open.
func (t TerminalPage) renderEmptyState() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true)

	var statusText, instructionText string
	if t.activeSession != nil {
		statusText = "  Loading terminal sessions…"
		instructionText = "  Connecting to session pod"
	} else {
		statusText = "  Select a running session to open a terminal"
		instructionText = "  Press 1 to go to Sessions, select a session, then open terminal"
	}

	statusLine := lipgloss.NewStyle().
		Foreground(theme.AccentAmber).
		Render(statusText)

	instructions := lipgloss.NewStyle().
		Foreground(theme.TextMuted).
		Render(instructionText)

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
func (t TerminalPage) renderFullScreen(tab *terminalTab) string { //nolint:gocritic // value receiver needed for page interface consistency
	tab.mu.Lock()
	content := tab.emulator.Render()
	tab.mu.Unlock()

	termStyle := lipgloss.NewStyle().
		Width(t.width).
		Height(t.height)

	return termStyle.Render(content)
}

// renderTabBar renders the tab strip at the top of the terminal.
func (t TerminalPage) renderTabBar() string { //nolint:gocritic // value receiver needed for page interface consistency
	theme := tui.DefaultTheme
	tabs := make([]string, 0, len(t.tabs))

	for i, tab := range t.tabs {
		tab.mu.Lock()
		label := tab.label
		tab.mu.Unlock()

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

// keyToBytes converts a bubbletea KeyMsg to raw bytes for the PTY.
func keyToBytes(msg tea.KeyMsg) []byte {
	// Use Keystroke() for matching — String() may return raw control chars
	// that don't match our "ctrl+n" style case labels.
	key := msg.Key().Keystroke()

	// If the key has printable text and no modifier (or only Shift), return it directly.
	// Shift is included because Kitty keyboard protocol explicitly reports Shift
	// for uppercase letters, but the text already contains the shifted character.
	if text := msg.Key().Text; text != "" && (msg.Key().Mod == 0 || msg.Key().Mod == tea.ModShift) {
		return []byte(text)
	}

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
