package tui

import (
	tea "charm.land/bubbletea/v2"
)

// ── Unified Keymap Constants ──────────────────────────────────────────
//
// All pages should reference these constants rather than hard-coding key
// strings. This ensures a consistent keyboard experience across the TUI.
//
// Navigation (list items):
//   j / ↓  — move cursor down in a list
//   k / ↑  — move cursor up in a list
//
// Scrolling (content pane):
//   J      — scroll content pane down (uppercase)
//   K      — scroll content pane up (uppercase)
//
// Jumping:
//   G      — jump to bottom (vim: Shift-G = end of file)
//   g      — jump to top (vim: gg = beginning, single-key shortcut)
//
// Search / filter:
//   /      — enter search mode
//
// Selection:
//   Enter  — open / select the item under the cursor
//
// Refresh:
//   r      — refresh the current view's data
//
// Filter cycling:
//   Tab       — next filter
//   Shift+Tab — previous filter

const (
	// KeyDown navigates down in a list.
	KeyDown = "j"
	// KeyDownArrow is the arrow-key alternative for down.
	KeyDownArrow = "down"

	// KeyUp navigates up in a list.
	KeyUp = "k"
	// KeyUpArrow is the arrow-key alternative for up.
	KeyUpArrow = "up"

	// KeyScrollDown scrolls the content pane down (uppercase J).
	KeyScrollDown = "J"
	// KeyScrollUp scrolls the content pane up (uppercase K).
	KeyScrollUp = "K"

	// KeyJumpBottom jumps to the bottom of a list or content pane (Shift-G).
	KeyJumpBottom = "G"
	// KeyJumpTop jumps to the top of a list or content pane.
	KeyJumpTop = "g"

	// KeySearch enters search/filter mode.
	KeySearch = "/"

	// KeySelect opens or selects the item under the cursor.
	KeySelect = "enter"

	// KeyRefresh refreshes the current view's data.
	KeyRefresh = "r"

	// KeyNextFilter cycles to the next filter.
	KeyNextFilter = "tab"
	// KeyPrevFilter cycles to the previous filter.
	KeyPrevFilter = "shift+tab"

	// KeyEscape exits the current mode (search, insert, etc.).
	KeyEscape = "esc"

	// KeyCommandPalette opens the command palette.
	KeyCommandPalette = "ctrl+k"
)

// Mode represents the current interaction mode of the TUI.
type Mode int

const (
	// ModeNormal is the default navigation mode.
	ModeNormal Mode = iota
	// ModeInsert indicates a text input is active.
	ModeInsert
	// ModeSearch indicates search/filter mode.
	ModeSearch
	// ModeCommand indicates the command palette is open.
	ModeCommand
)

// String returns a human-readable label for the mode.
func (m Mode) String() string {
	switch m {
	case ModeNormal:
		return "NORMAL"
	case ModeInsert:
		return "INSERT"
	case ModeSearch:
		return "SEARCH"
	case ModeCommand:
		return "COMMAND"
	}
	return "NORMAL"
}

// Page represents a navigable page in the TUI.
type Page int

// Page constants for TUI navigation.
const (
	PageSessions   Page = iota // Sessions list and detail
	PageChat                   // Chat interface
	PageTerminal               // Remote terminal
	PageDiffs                  // Git diff viewer
	PageChronicles             // Event log / timeline
	PageSettings               // Settings and configuration
	PageAdmin                  // Admin panel
)

// PageCount is the total number of pages.
const PageCount = 7

// PageInfo holds display metadata for a page.
type PageInfo struct {
	Name string
	Icon string
	Key  string
}

// Pages maps page constants to their display info.
var Pages = map[Page]PageInfo{
	PageSessions:   {Name: "Sessions", Icon: "◉", Key: "1"},
	PageChat:       {Name: "Chat", Icon: "◈", Key: "2"},
	PageTerminal:   {Name: "Terminal", Icon: "▣", Key: "3"},
	PageDiffs:      {Name: "Diffs", Icon: "◧", Key: "4"},
	PageChronicles: {Name: "Chronicles", Icon: "◷", Key: "5"},
	PageSettings:   {Name: "Settings", Icon: "◎", Key: "6"},
	PageAdmin:      {Name: "Admin", Icon: "◈", Key: "7"},
}

// PageOrder defines the display order of pages in the sidebar.
var PageOrder = []Page{
	PageSessions,
	PageChat,
	PageTerminal,
	PageDiffs,
	PageChronicles,
	PageSettings,
	PageAdmin,
}

// IsNavigationKey checks if a key message is a page navigation shortcut.
func IsNavigationKey(msg tea.KeyMsg) (Page, bool) {
	switch msg.String() {
	case "1":
		return PageSessions, true
	case "2":
		return PageChat, true
	case "3":
		return PageTerminal, true
	case "4":
		return PageDiffs, true
	case "5":
		return PageChronicles, true
	case "6":
		return PageSettings, true
	case "7":
		return PageAdmin, true
	}
	return 0, false
}

// IsAltNavigationKey checks if a key message is an alt+number page navigation
// shortcut. These work even when input is captured (e.g. terminal PTY, chat
// input, search, settings edit).
func IsAltNavigationKey(msg tea.KeyMsg) (Page, bool) {
	switch msg.String() {
	case "alt+1":
		return PageSessions, true
	case "alt+2":
		return PageChat, true
	case "alt+3":
		return PageTerminal, true
	case "alt+4":
		return PageDiffs, true
	case "alt+5":
		return PageChronicles, true
	case "alt+6":
		return PageSettings, true
	case "alt+7":
		return PageAdmin, true
	}
	return 0, false
}
