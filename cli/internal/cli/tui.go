package cli

import (
	"fmt"
	"net/http"
	"os"
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
	RunE: func(cmd *cobra.Command, args []string) error {
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
	}
}

func (m tuiModel) Init() tea.Cmd {
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
	resp, err := hc.Get(client.BaseURL() + "/health")
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode < 500 {
			return nil
		}
	}
	// Fall back to authenticated stats endpoint.
	return client.Ping()
}

func (m tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	// Debug: log all non-trivial messages to help diagnose routing issues.
	if debugTUI {
		debugLogMsg(msg)
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
	switch msg.(type) {
	case pages.TerminalOutputMsg, pages.TerminalConnectedMsg, pages.TerminalDisconnectedMsg:
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
		return m.handleSessionSelected(msg.(pages.SessionSelectedMsg))
	}

	// Always forward AllSessionsLoadedMsg to the sessions page.
	if _, ok := msg.(tuipkg.AllSessionsLoadedMsg); ok {
		m.sessions, cmd = m.sessions.Update(msg)
		if cmd != nil {
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	}

	// When terminal page is active, intercept most keys and forward to PTY.
	// Esc returns focus to app-level navigation so the user can switch pages.
	if m.app.ActivePage == tuipkg.PageTerminal {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			// Let these keys through to the app layer:
			switch {
			case key == "ctrl+c", key == "f11", key == "ctrl+f",
				key == "?", key == "esc", key == "[":
				// fall through to app
			case len(key) == 1 && key >= "1" && key <= "7":
				// number keys for page navigation
			default:
				m.terminal, cmd = m.terminal.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
	}

	// When chat input is active, intercept printable keys so they go to the
	// input field instead of being swallowed by the app (e.g., "?" opening help).
	if m.app.ActivePage == tuipkg.PageChat && m.chat.InputActive() {
		if keyMsg, ok := msg.(tea.KeyMsg); ok {
			key := keyMsg.String()
			switch {
			case key == "ctrl+c", key == "esc":
				// Esc deactivates input, let it through to chat then app.
				m.chat, cmd = m.chat.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				// Fall through to app layer too.
			case key == "f11", key == "ctrl+f":
				// Let through to app layer (fullscreen toggle).
			case len(key) == 1 && key >= "1" && key <= "7":
				// Number keys for page navigation — let through to app layer.
			default:
				// Forward directly to chat page (printable keys, enter, backspace, etc.).
				m.chat, cmd = m.chat.Update(msg)
				if cmd != nil {
					cmds = append(cmds, cmd)
				}
				return m, tea.Batch(cmds...)
			}
		}
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

	return m, tea.Batch(cmds...)
}

// handleSessionSelected wires up all pages when a session is selected.
func (m tuiModel) handleSessionSelected(msg pages.SessionSelectedMsg) (tea.Model, tea.Cmd) {
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

func (m tuiModel) View() tea.View {
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

	// Compose layout: header on top, sidebar + content below
	body := lipgloss.JoinHorizontal(lipgloss.Top, sidebar, pageContent)
	fullView := lipgloss.JoinVertical(lipgloss.Left, header, body)

	// Help overlay sits on top of everything
	if m.app.ShowHelp {
		v.Content = m.help.View(m.app.Width, m.app.Height)
		return v
	}

	v.Content = fullView
	return v
}

// debugTUI enables TUI message logging. Set VOLUNDR_TUI_DEBUG=1 to enable.
var debugTUI = os.Getenv("VOLUNDR_TUI_DEBUG") == "1"

func debugLogMsg(msg tea.Msg) {
	// Skip high-frequency noise.
	switch msg.(type) {
	case tea.WindowSizeMsg:
		return
	}

	f, err := os.OpenFile("/tmp/volundr-tui-debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	ts := time.Now().Format("15:04:05.000")
	_, _ = fmt.Fprintf(f, "%s [%T] %+v\n", ts, msg, msg)
}
