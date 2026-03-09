package cli

import (
	"fmt"
	"os"

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

	// CLI flags override config
	if cfgServer != "" {
		cfg.Server = cfgServer
	}
	if cfgToken != "" {
		cfg.Token = cfgToken
	}

	m := newTUIModel(cfg)
	p := tea.NewProgram(m)

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
	app    tuipkg.App
	client *api.Client

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
func newTUIModel(cfg *remote.Config) tuiModel {
	client := api.NewClientWithConfig(cfg.Server, cfg.Token, cfg)

	return tuiModel{
		app:    tuipkg.NewApp(cfg.Server),
		client: client,

		sessions:   pages.NewSessionsPage(client),
		chat:       pages.NewChatPage(cfg.Token),
		terminal:   pages.NewTerminalPage(cfg.Server, cfg.Token),
		diffs:      pages.NewDiffsPage(cfg.Token),
		chronicles: pages.NewChroniclesPage(client),
		settings:   pages.NewSettingsPage(client, cfg),
		admin:      pages.NewAdminPage(client),

		header:  components.NewHeader(cfg.Server),
		sidebar: components.NewSidebar(),
		help:    components.NewHelpOverlay(),
	}
}

func (m tuiModel) Init() tea.Cmd {
	client := m.client
	pingCmd := func() tea.Msg {
		err := client.Ping()
		return serverPingMsg{Err: err}
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

func (m tuiModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd
	var cmd tea.Cmd

	// Handle server connectivity.
	if pingMsg, ok := msg.(serverPingMsg); ok {
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
