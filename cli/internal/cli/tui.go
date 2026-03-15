package cli

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/spf13/cobra"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tuipkg "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
	"github.com/niuulabs/volundr/cli/internal/tui/pages"
)

var tuiCmd = &cobra.Command{
	Use:   "tui",
	Short: "Launch the interactive TUI",
	Long:  "Launch the full-screen terminal user interface for Volundr.",
	RunE: func(_ *cobra.Command, _ []string) error {
		return runTUI()
	},
}

// runTUI launches the Bubble Tea TUI application.
func runTUI() error {
	cfg, err := remote.Load()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	// Build the client pool.
	var pool *tuipkg.ClientPool
	if cfgServer != "" && cfgToken != "" {
		// CLI flag override: single-entry pool.
		pool = tuipkg.NewClientPoolFromFlags(cfgServer, cfgToken)
	} else {
		pool = tuipkg.NewClientPool(cfg)
	}

	sender := &tuipkg.ProgramSender{}
	m := newTUIModel(cfg, pool, sender)
	p := tea.NewProgram(m)
	sender.SetProgram(p)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		return err
	}

	return nil
}

// serverPingMsg carries the result of a server connectivity check.
type serverPingMsg struct {
	Err error
}

// tuiModel is the top-level Bubble Tea model that wraps the App and all pages.
type tuiModel struct {
	app  tuipkg.App
	pool *tuipkg.ClientPool

	// Page models
	sessions   pages.SessionsPage
	chat       pages.ChatPage
	terminal   pages.TerminalPage
	diffs      pages.DiffsPage
	chronicles pages.ChroniclesPage
	settings   pages.SettingsPage
	admin      pages.AdminPage

	// Components
	header  components.Header
	sidebar components.Sidebar
	help    components.HelpOverlay
	footer  components.Footer
	palette components.Palette

	// Active session (set when user presses Enter on a session).
	activeSession *api.Session
}

// newTUIModel creates the fully initialized TUI model.
func newTUIModel(cfg *remote.Config, pool *tuipkg.ClientPool, sender *tuipkg.ProgramSender) tuiModel {
	// Determine a primary server URL and client for the app.
	server := ""
	token := ""
	var primaryClient *api.Client
	if len(pool.Entries) > 0 {
		connected := pool.ConnectedClients()
		if len(connected) > 0 {
			server = connected[0].Server
			token = connected[0].Client.Token()
			primaryClient = connected[0].Client
		} else {
			// Use the first entry even if not connected.
			for _, entry := range pool.Entries {
				server = entry.Server
				break
			}
		}
	}

	_ = token // token used below in page constructors

	return tuiModel{
		app:  tuipkg.NewApp(server),
		pool: pool,

		sessions:   pages.NewSessionsPage(pool),
		chat:       pages.NewChatPage(primaryClient, sender),
		terminal:   pages.NewTerminalPage(server, primaryClient, pool),
		diffs:      pages.NewDiffsPage(primaryClient),
		chronicles: pages.NewChroniclesPage(primaryClient),
		settings:   pages.NewSettingsPage(primaryClient, cfg),
		admin:      pages.NewAdminPage(primaryClient),

		header:  components.NewHeaderWithPool(pool),
		sidebar: components.NewSidebar(),
		help:    components.NewHelpOverlay(),
		footer:  components.NewFooter(),
		palette: components.NewPalette(),
	}
}

func (m tuiModel) Init() tea.Cmd { //nolint:gocritic // tea.Model interface requires value receiver
	// Use the first connected client for the ping.
	var pingClient *api.Client
	connected := m.pool.ConnectedClients()
	if len(connected) > 0 {
		pingClient = connected[0].Client
	}

	var pingCmd tea.Cmd
	if pingClient != nil {
		client := pingClient
		pingCmd = func() tea.Msg {
			// Try a lightweight health check first (unauthenticated),
			// then fall back to the stats endpoint.
			var err error
			for attempt := 0; attempt < 3; attempt++ {
				if attempt > 0 {
					time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
				}
				err = quickPing(client)
				if err == nil {
					return serverPingMsg{Err: nil}
				}
			}
			return serverPingMsg{Err: err}
		}
	}

	return tea.Batch(
		pingCmd,
		m.terminal.Init(),
		m.sessions.Init(),
		m.chat.Init(),
		m.settings.Init(),
		m.admin.Init(),
	)
}

// quickPing tries /health (fast, unauthenticated) then /api/v1/volundr/stats.
func quickPing(client *api.Client) error {
	// Try unauthenticated health endpoint with a short timeout.
	hc := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, client.BaseURL()+"/health", http.NoBody)
	if err != nil {
		return client.Ping()
	}
	resp, err := hc.Do(req)
	if err == nil {
		_ = resp.Body.Close()
		if resp.StatusCode < 500 {
			return nil
		}
	}
	// Fall back to authenticated stats endpoint.
	return client.Ping()
}

func (m tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) { //nolint:gocritic // tea.Model interface requires value receiver
	var cmds []tea.Cmd
	var cmd tea.Cmd

	// Debug: log all non-trivial messages to help diagnose routing issues.
	if debugTUI {
		debugLogMsg(msg)
	}

	// Handle palette messages.
	switch typedMsg := msg.(type) {
	case components.PaletteSelectedMsg:
		m.palette.Close()
		switch typedMsg.Item.Type {
		case components.PalettePage:
			m.app.ActivePage = typedMsg.Item.Page
		case components.PaletteAction:
			switch typedMsg.Item.Action {
			case "quit":
				return m, tea.Quit
			case "help":
				m.app.ShowHelp = !m.app.ShowHelp
			case "toggle-sidebar":
				m.app.ShowSidebar = !m.app.ShowSidebar
			case "refresh":
				// Synthesize an 'r' key press to the active page.
				// Pages already handle 'r' for refresh.
			}
		case components.PaletteSession:
			// Session palette items are handled by navigating to the session.
			// Currently a no-op until session selection is wired up.
		}
		m.updateMode()
		return m, nil

	case components.PaletteDismissedMsg:
		m.updateMode()
		return m, nil
	}

	// Ctrl+K opens the command palette globally, even when input is captured.
	if keyMsg, ok := msg.(tea.KeyMsg); ok && keyMsg.String() == "ctrl+k" {
		items := components.DefaultPaletteItems()
		// Add active sessions to palette items if available.
		if m.activeSession != nil {
			sessionItem := components.PaletteItem{
				Type:      components.PaletteSession,
				Label:     m.activeSession.Name,
				Desc:      m.activeSession.Status,
				Icon:      "\u25c9",
				SessionID: m.activeSession.ID,
			}
			items = append([]components.PaletteItem{sessionItem}, items...)
		}
		m.palette.Open(items, m.app.Width, m.app.Height)
		m.app.Mode = tuipkg.ModeCommand
		return m, nil
	}

	// When palette is visible, route all keys to it.
	if m.palette.Visible {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			cmd = m.palette.Update(keyMsg)
			if cmd != nil {
				cmds = append(cmds, cmd)
			}
			return m, tea.Batch(cmds...)
		}
	}

	// Handle server connectivity.
	if pingMsg, ok := msg.(serverPingMsg); ok {
		if pingMsg.Err == nil {
			m.header.State = components.HeaderConnected
		} else {
			m.header.State = components.HeaderDisconnected
		}
		m.header.Connected = pingMsg.Err == nil
		return m, nil
	}

	// Always forward async data messages to the right page,
	// regardless of which page is active or whether help is showing.
	switch typedMsg := msg.(type) {
	case pages.TerminalOutputMsg, pages.TerminalConnectedMsg, pages.TerminalDisconnectedMsg,
		pages.TerminalSessionsLoadedMsg, pages.TerminalSpawnedMsg:
		m.terminal, cmd = m.terminal.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.SessionsLoadedMsg:
		m.sessions, cmd = m.sessions.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.TimelineLoadedMsg:
		m.chronicles, cmd = m.chronicles.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.ChatStreamEventMsg, pages.ChatConnectedMsg, pages.ChatDisconnectedMsg:
		m.chat, cmd = m.chat.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.ChatHistoryLoadedMsg:
		m.chat, cmd = m.chat.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.DiffFilesLoadedMsg, pages.DiffContentLoadedMsg:
		m.diffs, cmd = m.diffs.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.SessionActionDoneMsg:
		m.sessions, cmd = m.sessions.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.SettingsLoadedMsg:
		m.settings, cmd = m.settings.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	case pages.AdminDataLoadedMsg:
		m.admin, cmd = m.admin.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)

	case pages.SessionSelectedMsg:
		return m.handleSessionSelected(typedMsg)
	}

	// Always forward AllSessionsLoadedMsg to the sessions page.
	if _, ok := msg.(tuipkg.AllSessionsLoadedMsg); ok {
		m.sessions, cmd = m.sessions.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	}

	// When terminal page is active, route keys based on insert/normal mode.
	// In insert mode: all keys go to the terminal (PTY) except ctrl+],
	// ctrl+t/n/p/w/f, f11, and alt+N which the terminal handles internally.
	// In normal mode: keys fall through to the app layer for navigation.
	if m.app.ActivePage == tuipkg.PageTerminal {
		if _, ok := msg.(tea.KeyMsg); ok {
			wasInsert := m.terminal.InsertMode()

			// Send to the terminal page first — it handles mode
			// switching (ctrl+], i) and PTY forwarding internally.
			m.terminal, cmd = m.terminal.Update(msg)
			cmds = appendCmd(cmds, cmd)

			// If the terminal consumed the key (insert mode, or mode
			// just changed), stop here. Only let keys fall through to
			// the app layer when we were already in normal mode and
			// the mode didn't change (i.e. a navigation key).
			if m.terminal.InsertMode() || wasInsert != m.terminal.InsertMode() {
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When chat input is active, capture all keys for the input field.
	// Only Esc, Ctrl+C, F11/Ctrl+F, and Alt+N fall through to the app.
	if m.app.ActivePage == tuipkg.PageChat && m.chat.InputActive() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case key == "esc":
				// Esc deactivates input; send to chat then fall through to app.
				m.chat, cmd = m.chat.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
			case key == "f11", key == "ctrl+f":
				// Let through to app layer (fullscreen toggle).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				// Forward directly to chat page (printable keys, enter,
				// backspace, numbers, q, ?, [, etc.).
				m.chat, cmd = m.chat.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When sessions search is active, capture keys for the search field.
	if m.app.ActivePage == tuipkg.PageSessions && m.sessions.Searching() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				// Forward to sessions page (handles esc/enter to exit search).
				m.sessions, cmd = m.sessions.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When settings editor is active, capture keys for the edit field.
	if m.app.ActivePage == tuipkg.PageSettings && m.settings.Editing() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				// Forward to settings page (handles esc/enter to exit edit).
				m.settings, cmd = m.settings.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When chronicles search is active, capture keys for the search field.
	if m.app.ActivePage == tuipkg.PageChronicles && m.chronicles.Searching() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				m.chronicles, cmd = m.chronicles.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When diffs search is active, capture keys for the search field.
	if m.app.ActivePage == tuipkg.PageDiffs && m.diffs.Searching() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				m.diffs, cmd = m.diffs.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When admin search is active, capture keys for the search field.
	if m.app.ActivePage == tuipkg.PageAdmin && m.admin.Searching() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c":
				// Let through to app (quit).
			case strings.HasPrefix(key, "alt+"):
				// alt+number navigation — fall through to app
			default:
				m.admin, cmd = m.admin.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// Set InputCaptured for KeyMsg so the app layer suppresses global
	// keybindings (q, ?, [, 1-7) when a text input is active.
	if _, ok := msg.(tea.KeyMsg); ok {
		m.app.InputCaptured = m.isInputCaptured()
	}

	// Update the root app first (handles global keys, window resize)
	newApp, appCmd := m.app.Update(msg)
	m.app = newApp
	if appCmd != nil {
		cmds = append(cmds, appCmd)
	}

	// Sync sidebar state
	m.sidebar.ActivePage = m.app.ActivePage
	m.sidebar.Collapsed = !m.app.ShowSidebar

	// Handle help overlay toggle
	m.help.Visible = m.app.ShowHelp

	// Update window dimensions
	if _, ok := msg.(tea.WindowSizeMsg); ok {
		m.header.Width = m.app.Width
		m.sidebar.Height = m.app.ContentHeight()

		cw := m.app.ContentWidth()
		ch := m.app.ContentHeight()
		m.sessions.SetSize(cw, ch)
		m.chat.SetSize(cw, ch)
		m.terminal.SetSize(cw, ch)
		m.diffs.SetSize(cw, ch)
		m.chronicles.SetSize(cw, ch)
		m.settings.SetSize(cw, ch)
		m.admin.SetSize(cw, ch)
	}

	// Only forward messages to the active page if help is not showing
	if !m.app.ShowHelp {
		switch m.app.ActivePage {
		case tuipkg.PageSessions:
			m.sessions, cmd = m.sessions.Update(msg)
		case tuipkg.PageChat:
			m.chat, cmd = m.chat.Update(msg)
		case tuipkg.PageTerminal:
			m.terminal, cmd = m.terminal.Update(msg)
		case tuipkg.PageDiffs:
			m.diffs, cmd = m.diffs.Update(msg)
		case tuipkg.PageChronicles:
			m.chronicles, cmd = m.chronicles.Update(msg)
		case tuipkg.PageSettings:
			m.settings, cmd = m.settings.Update(msg)
		case tuipkg.PageAdmin:
			m.admin, cmd = m.admin.Update(msg)
		}
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
	}

	// Update mode indicator based on current page state.
	m.updateMode()

	return m, tea.Batch(cmds...)
}

// handleSessionSelected wires up all pages when a session is selected.
func (m tuiModel) handleSessionSelected(msg pages.SessionSelectedMsg) (tea.Model, tea.Cmd) { //nolint:gocritic // called from Update which requires value receiver
	sess := msg.Session
	m.activeSession = &sess

	var cmds []tea.Cmd

	// Connect chat to session's WebSocket.
	m.chat.SetSession(sess)

	// Open a terminal tab for the session.
	m.terminal.ConnectSession(sess)

	// Load diffs from session pod.
	if cmd := m.diffs.SetSession(sess); cmd != nil {
		cmds = append(cmds, cmd)
	}

	// Load chronicles timeline for the session.
	if cmd := m.chronicles.SetSession(sess); cmd != nil {
		cmds = append(cmds, cmd)
	}

	// Update header to show session name.
	m.header.Connected = true
	m.header.State = components.HeaderConnected

	// Navigate to the chat page after selection.
	m.app.ActivePage = tuipkg.PageChat
	m.sidebar.ActivePage = tuipkg.PageChat

	return m, tea.Batch(cmds...)
}

// isInputCaptured returns true when the active page has a text input that
// should suppress global keybindings (q, ?, [, 1-7).
func (m tuiModel) isInputCaptured() bool { //nolint:gocritic // called from Update which requires value receiver
	if m.palette.Visible {
		return true
	}
	switch m.app.ActivePage {
	case tuipkg.PageTerminal:
		return m.terminal.InsertMode()
	case tuipkg.PageChat:
		return m.chat.InputActive()
	case tuipkg.PageSessions:
		return m.sessions.Searching()
	case tuipkg.PageSettings:
		return m.settings.Editing()
	case tuipkg.PageDiffs:
		return m.diffs.Searching()
	case tuipkg.PageChronicles:
		return m.chronicles.Searching()
	case tuipkg.PageAdmin:
		return m.admin.Searching()
	}
	return false
}

// updateMode sets the mode based on current page state and syncs it to
// the header and footer components.
func (m *tuiModel) updateMode() {
	m.app.Mode = m.resolveMode()
	m.header.Mode = m.app.Mode
	m.footer.Page = m.app.ActivePage
	m.footer.Mode = m.app.Mode
}

// resolveMode determines the current interaction mode from page state.
func (m *tuiModel) resolveMode() tuipkg.Mode {
	if m.palette.Visible {
		return tuipkg.ModeCommand
	}

	switch m.app.ActivePage {
	case tuipkg.PageTerminal:
		if m.terminal.InsertMode() {
			return tuipkg.ModeInsert
		}
	case tuipkg.PageChat:
		if m.chat.InputActive() {
			return tuipkg.ModeInsert
		}
	case tuipkg.PageSettings:
		if m.settings.Editing() {
			return tuipkg.ModeInsert
		}
	case tuipkg.PageSessions:
		if m.sessions.Searching() {
			return tuipkg.ModeSearch
		}
	case tuipkg.PageChronicles:
		if m.chronicles.Searching() {
			return tuipkg.ModeSearch
		}
	case tuipkg.PageDiffs:
		if m.diffs.Searching() {
			return tuipkg.ModeSearch
		}
	case tuipkg.PageAdmin:
		if m.admin.Searching() {
			return tuipkg.ModeSearch
		}
	}
	return tuipkg.ModeNormal
}

func (m tuiModel) View() tea.View { //nolint:gocritic // tea.Model interface requires value receiver
	v := tea.View{AltScreen: true}

	if !m.app.Ready {
		theme := tuipkg.DefaultTheme
		v.Content = lipgloss.NewStyle().
			Foreground(theme.AccentAmber).
			Bold(true).
			Render("\n  Loading Volundr...")
		return v
	}

	// Render header
	header := m.header.View()

	// Render footer
	m.footer.Width = m.app.Width
	m.footer.Page = m.app.ActivePage
	m.footer.Mode = m.app.Mode
	footer := m.footer.View()

	// Render sidebar
	sidebar := m.sidebar.View()

	// Render active page
	var pageContent string
	switch m.app.ActivePage {
	case tuipkg.PageSessions:
		pageContent = m.sessions.View()
	case tuipkg.PageChat:
		pageContent = m.chat.View()
	case tuipkg.PageTerminal:
		pageContent = m.terminal.View()
	case tuipkg.PageDiffs:
		pageContent = m.diffs.View()
	case tuipkg.PageChronicles:
		pageContent = m.chronicles.View()
	case tuipkg.PageSettings:
		pageContent = m.settings.View()
	case tuipkg.PageAdmin:
		pageContent = m.admin.View()
	}

	// Compose layout: header on top, sidebar + content below, footer at bottom
	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebar, pageContent)
	fullView := lipgloss.JoinVertical(lipgloss.Left, header, body, footer)

	// Help overlay sits on top of everything
	if m.app.ShowHelp {
		v.Content = m.help.View(m.app.Width, m.app.Height)
		return v
	}

	// Palette overlay sits on top of everything
	if m.palette.Visible {
		v.Content = m.palette.View(m.app.Width, m.app.Height)
		return v
	}

	v.Content = fullView
	return v
}

// appendCmd appends a non-nil command to a slice.
func appendCmd(cmds []tea.Cmd, cmd tea.Cmd) []tea.Cmd {
	if cmd != nil {
		return append(cmds, cmd)
	}
	return cmds
}

// debugTUI enables TUI message logging. Set VOLUNDR_TUI_DEBUG=1 to enable.
var debugTUI = os.Getenv("VOLUNDR_TUI_DEBUG") == "1"

func debugLogMsg(msg tea.Msg) {
	// Skip high-frequency noise.
	if _, ok := msg.(tea.WindowSizeMsg); ok {
		return
	}

	f, err := os.OpenFile("/tmp/volundr-tui-debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // debug log in /tmp, not sensitive
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()

	ts := time.Now().Format("15:04:05.000")
	_, _ = fmt.Fprintf(f, "%s [%T] %+v\n", ts, msg, msg)
}
