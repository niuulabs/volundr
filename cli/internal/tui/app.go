package tui

import (
	"charm.land/lipgloss/v2"

	tea "charm.land/bubbletea/v2"
)

// App is the root Bubble Tea model for the Volundr TUI.
// It manages page routing, the sidebar, and global keybindings.
type App struct {
	// Current page
	ActivePage Page

	// Terminal dimensions
	Width  int
	Height int

	// UI state
	ShowHelp    bool
	ShowSidebar bool
	ServerURL   string

	// Ready signals that we've received the initial window size.
	Ready bool

	// InputCaptured is set by the tuiModel when a page has an active text
	// input (chat input, search bar, settings editor, terminal PTY). When
	// true, global keybindings (q, ?, [, 1-7) are suppressed so keystrokes
	// reach the input field. Alt+1-7 navigation always works.
	InputCaptured bool
}

// NewApp creates a new root TUI application model.
func NewApp(serverURL string) App {
	return App{
		ActivePage:  PageSessions,
		ShowSidebar: true,
		ServerURL:   serverURL,
	}
}

// Init returns the initial command for the TUI app.
func (a App) Init() tea.Cmd {
	return nil
}

// Update handles messages for the root app model.
func (a App) Update(msg tea.Msg) (App, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		a.Width = msg.Width
		a.Height = msg.Height
		a.Ready = true
		return a, nil

	case tea.KeyMsg:
		// Alt+number navigation always works, even when input is captured.
		if !a.ShowHelp {
			if page, ok := IsAltNavigationKey(msg); ok {
				a.ActivePage = page
				return a, nil
			}
		}

		// ctrl+c always quits.
		if msg.String() == "ctrl+c" {
			return a, tea.Quit
		}

		// Esc always closes help if showing.
		if msg.String() == "esc" && a.ShowHelp {
			a.ShowHelp = false
			return a, nil
		}

		// When input is captured, suppress all other global keybindings
		// so keystrokes reach the active text input.
		if a.InputCaptured {
			break
		}

		// Global keybindings (only active when input is NOT captured)
		switch msg.String() {
		case "q":
			if !a.ShowHelp {
				return a, tea.Quit
			}
			a.ShowHelp = false
			return a, nil
		case "?":
			a.ShowHelp = !a.ShowHelp
			return a, nil
		case "[":
			a.ShowSidebar = !a.ShowSidebar
			return a, nil
		}

		// Page navigation shortcuts (bare 1-7)
		if !a.ShowHelp {
			if page, ok := IsNavigationKey(msg); ok {
				a.ActivePage = page
				return a, nil
			}
		}
	}

	return a, nil
}

// View renders the full TUI application.
func (a App) View() string {
	if !a.Ready {
		return "\n  Loading Volundr..."
	}

	return lipgloss.NewStyle().
		Width(a.Width).
		Height(a.Height).
		Background(DefaultTheme.BgPrimary).
		Render("")
}

// ContentWidth returns the width available for the main content area.
func (a App) ContentWidth() int {
	if a.ShowSidebar {
		return a.Width - 26 // sidebar width + border
	}
	return a.Width - 7 // collapsed sidebar
}

// ContentHeight returns the height available for the main content area.
func (a App) ContentHeight() int {
	return a.Height - 2 // header bar
}
