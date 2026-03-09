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
		// Global keybindings that work on any page
		switch msg.String() {
		case "ctrl+c":
			return a, tea.Quit
		case "q":
			if !a.ShowHelp {
				return a, tea.Quit
			}
			a.ShowHelp = false
			return a, nil
		case "?":
			a.ShowHelp = !a.ShowHelp
			return a, nil
		case "esc":
			if a.ShowHelp {
				a.ShowHelp = false
				return a, nil
			}
		case "[":
			a.ShowSidebar = !a.ShowSidebar
			return a, nil
		}

		// Page navigation shortcuts
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
