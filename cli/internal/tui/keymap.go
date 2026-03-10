package tui

import (
	tea "charm.land/bubbletea/v2"
)

// Page represents a navigable page in the TUI.
type Page int

const (
	PageSessions    Page = iota // Sessions list and detail
	PageChat                   // Chat interface
	PageTerminal               // Remote terminal
	PageDiffs                  // Git diff viewer
	PageChronicles             // Event log / timeline
	PageSettings               // Settings and configuration
	PageRealms                 // Infrastructure overview
	PageCampaigns              // Campaign tracking
	PageAdmin                  // Admin panel
)

// PageCount is the total number of pages.
const PageCount = 9

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
	PageRealms:     {Name: "Realms", Icon: "◆", Key: "7"},
	PageCampaigns:  {Name: "Campaigns", Icon: "◇", Key: "8"},
	PageAdmin:      {Name: "Admin", Icon: "◈", Key: "9"},
}

// PageOrder defines the display order of pages in the sidebar.
var PageOrder = []Page{
	PageSessions,
	PageChat,
	PageTerminal,
	PageDiffs,
	PageChronicles,
	PageSettings,
	PageRealms,
	PageCampaigns,
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
		return PageRealms, true
	case "8":
		return PageCampaigns, true
	case "9":
		return PageAdmin, true
	}
	return 0, false
}
