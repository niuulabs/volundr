package pages

import (
	"image/color"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Settings page tests.

func TestNewSettingsPage(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	if page.section != SectionConnection {
		t.Errorf("expected section Connection, got %v", page.section)
	}
	if page.rctx != nil {
		t.Error("expected nil rctx for nil config")
	}
}

func TestSettingsPage_Init(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	cmd := page.Init()
	if cmd != nil {
		t.Error("expected nil cmd")
	}
}

func TestSettingsPage_Update_TabCycle(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.cursor = 2

	// Tab cycles forward and resets cursor.
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.section != SectionCredentials {
		t.Errorf("expected section Credentials after tab, got %v", page.section)
	}
	if page.cursor != 0 {
		t.Errorf("expected cursor 0 after tab, got %d", page.cursor)
	}

	// Shift+tab cycles backward.
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift})
	if page.section != SectionConnection {
		t.Errorf("expected section Connection after shift+tab, got %v", page.section)
	}
}

func TestSettingsPage_Update_Navigation(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.cursor = 1

	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0 after 'k', got %d", page.cursor)
	}

	// Can't go below 0
	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0 still, got %d", page.cursor)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1 after 'j', got %d", page.cursor)
	}
}

func TestSettingsPage_SetSize(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.SetSize(100, 50)
	if page.width != 100 {
		t.Errorf("expected width 100, got %d", page.width)
	}
	if page.height != 50 {
		t.Errorf("expected height 50, got %d", page.height)
	}
}

func TestSettingsPage_View_AllSections(t *testing.T) {
	for _, section := range []SettingsSection{SectionConnection, SectionCredentials, SectionIntegrations, SectionAppearance} {
		page := NewSettingsPage(nil, nil)
		page.section = section
		page.width = 80
		page.height = 24
		view := page.View()
		if view == "" {
			t.Errorf("expected non-empty view for section %v", section)
		}
	}
}

func TestSettingsPage_Editing(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	if page.Editing() {
		t.Error("expected not editing initially")
	}
	page.editing = true
	if !page.Editing() {
		t.Error("expected editing after setting flag")
	}
}

func TestMaskToken(t *testing.T) {
	tests := []struct {
		token string
		want  string
	}{
		{"", "(not set)"},
		{"short", "●●●●●●●●"},
		{"12345678", "●●●●●●●●"},
		{"a-very-long-token-here", "●●●●●●●●●●●●here"},
	}
	for _, tt := range tests {
		got := maskToken(tt.token)
		if got != tt.want {
			t.Errorf("maskToken(%q) = %q, want %q", tt.token, got, tt.want)
		}
	}
}

// Terminal page tests.

func TestNewTerminalPage(t *testing.T) {
	page := NewTerminalPage("http://localhost:8000", nil, nil)
	if page.serverURL != "http://localhost:8000" {
		t.Errorf("expected server URL, got %q", page.serverURL)
	}
	if len(page.tabs) != 0 {
		t.Errorf("expected 0 tabs, got %d", len(page.tabs))
	}
}

func TestTerminalPage_SetSize(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.SetSize(120, 40)
	if page.width != 120 {
		t.Errorf("expected width 120, got %d", page.width)
	}
	if page.height != 40 {
		t.Errorf("expected height 40, got %d", page.height)
	}
}

func TestTerminalPage_termDimensions_Default(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	w, h := page.termDimensions()
	if w != defaultTermWidth || h != defaultTermHeight {
		t.Errorf("expected defaults %dx%d, got %dx%d", defaultTermWidth, defaultTermHeight, w, h)
	}
}

func TestTerminalPage_termDimensions_Normal(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 100
	page.height = 40
	w, h := page.termDimensions()
	if w != 96 {
		t.Errorf("expected width 96, got %d", w)
	}
	if h != 36 {
		t.Errorf("expected height 36, got %d", h)
	}
}

func TestTerminalPage_termDimensions_FullScreen(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 100
	page.height = 40
	page.fullScreen = true
	w, h := page.termDimensions()
	if w != 100 {
		t.Errorf("expected width 100, got %d", w)
	}
	if h != 39 {
		t.Errorf("expected height 39, got %d", h)
	}
}

func TestTerminalPage_termDimensions_Clamped(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 2
	page.height = 2
	w, h := page.termDimensions()
	if w < 1 || h < 1 {
		t.Errorf("expected dimensions >= 1, got %dx%d", w, h)
	}
}

func TestTerminalPage_View_Empty(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24
	view := page.View()
	if view == "" {
		t.Error("expected non-empty empty state view")
	}
}

func TestTerminalPage_Close_NoTabs(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.Close() // should not panic
	if len(page.tabs) != 0 {
		t.Error("expected 0 tabs after close")
	}
}

func TestKeyToBytes_SpecialKeys(t *testing.T) {
	tests := []struct {
		key  string
		want []byte
	}{
		{"enter", []byte{'\r'}},
		{"tab", []byte{'\t'}},
		{"backspace", []byte{0x7f}},
		{"esc", []byte{0x1b}},
		{"up", []byte{0x1b, '[', 'A'}},
		{"down", []byte{0x1b, '[', 'B'}},
		{"right", []byte{0x1b, '[', 'C'}},
		{"left", []byte{0x1b, '[', 'D'}},
		{"space", []byte{' '}},
		{"home", []byte{0x1b, '[', 'H'}},
		{"end", []byte{0x1b, '[', 'F'}},
	}

	for _, tt := range tests {
		msg := makeKeyMsg(tt.key)
		got := keyToBytes(msg)
		if len(got) != len(tt.want) {
			t.Errorf("keyToBytes(%q) len = %d, want %d", tt.key, len(got), len(tt.want))
			continue
		}
		for i := range got {
			if got[i] != tt.want[i] {
				t.Errorf("keyToBytes(%q)[%d] = %d, want %d", tt.key, i, got[i], tt.want[i])
			}
		}
	}
}

func TestKeyToBytes_CtrlKeys(t *testing.T) {
	// ctrl+c -> 0x03
	msg := tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}
	got := keyToBytes(msg)
	if len(got) != 1 || got[0] != 0x03 {
		t.Errorf("keyToBytes(ctrl+c) = %v, want [3]", got)
	}
}

func TestKeyToBytes_PrintableChar(t *testing.T) {
	msg := tea.KeyPressMsg{Code: 'a'}
	got := keyToBytes(msg)
	if string(got) != "a" {
		t.Errorf("keyToBytes('a') = %q, want %q", string(got), "a")
	}
}

func TestKeyToBytes_FunctionKeys(t *testing.T) {
	msg := makeKeyMsg("f1")
	got := keyToBytes(msg)
	if len(got) != 3 || got[0] != 0x1b || got[1] != 'O' || got[2] != 'P' {
		t.Errorf("keyToBytes(f1) = %v, want [27 79 80]", got)
	}
}

// Chat page tests.

func TestNewChatPage(t *testing.T) {
	page := NewChatPage(nil, nil)
	if page.model != "claude-sonnet-4" {
		t.Errorf("expected model %q, got %q", "claude-sonnet-4", page.model)
	}
	if page.inputActive {
		t.Error("expected normal mode (input inactive) by default")
	}
}

func TestChatPage_Update_Tab(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.inputActive {
		t.Error("expected input inactive after tab")
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if !page.inputActive {
		t.Error("expected input active after second tab")
	}
}

func TestChatPage_Update_EnterSendsMessage(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page.input = "hello"
	before := len(page.messages)

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if len(page.messages) != before+1 {
		t.Errorf("expected %d messages after enter, got %d", before+1, len(page.messages))
	}
	if page.input != "" {
		t.Errorf("expected empty input after send, got %q", page.input)
	}
}

func TestChatPage_Update_EnterEmptyNoop(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page.input = ""
	before := len(page.messages)

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if len(page.messages) != before {
		t.Error("expected no new message for empty input")
	}
}

func TestChatPage_Update_Backspace(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page.input = "ab"

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if page.input != "a" {
		t.Errorf("expected %q after backspace, got %q", "a", page.input)
	}
}

func TestChatPage_Update_TypeChar(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page.input = ""

	page, _ = page.Update(tea.KeyPressMsg{Code: 'x', Text: "x"})
	if page.input != "x" {
		t.Errorf("expected input %q, got %q", "x", page.input)
	}
}

func TestChatPage_SetSize(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.SetSize(100, 40)
	if page.width != 100 || page.height != 40 {
		t.Errorf("expected 100x40, got %dx%d", page.width, page.height)
	}
}

func TestChatPage_View(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.width = 80
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty chat view")
	}
}

func TestWrapText(t *testing.T) {
	tests := []struct {
		text  string
		width int
		lines int
	}{
		{"short", 80, 1},
		{"", 80, 0},
		{"hello world", 5, 2},
		{"abc", 0, 1}, // width=0 returns as-is
	}

	for _, tt := range tests {
		result := wrapText(tt.text, tt.width)
		if tt.text == "" {
			continue
		}
		// Just check it doesn't panic and returns something.
		if result == "" && tt.text != "" {
			t.Errorf("wrapText(%q, %d) returned empty", tt.text, tt.width)
		}
	}
}

// Chronicles page tests.

func TestNewChroniclesPage(t *testing.T) {
	page := NewChroniclesPage(nil)
	if page.filter != "all" {
		t.Errorf("expected filter 'all', got %q", page.filter)
	}
	if !page.noSession {
		t.Error("expected noSession true when created without client")
	}
}

func TestChroniclesPage_Init(t *testing.T) {
	page := NewChroniclesPage(nil)
	if page.Init() != nil {
		t.Error("expected nil cmd")
	}
}

func TestChroniclesPage_CountByType(t *testing.T) {
	page := NewChroniclesPage(nil)
	// Manually populate events for testing.
	page.events = []ChronicleEvent{
		{Type: EventMessage, Label: "msg1"},
		{Type: EventMessage, Label: "msg2"},
		{Type: EventFile, Label: "file1"},
	}
	counts := page.countByType()
	if len(counts) == 0 {
		t.Error("expected non-empty counts")
	}
	total := 0
	for _, c := range counts {
		total += c
	}
	if total != len(page.events) {
		t.Errorf("expected total %d, got %d", len(page.events), total)
	}
}

func TestChroniclesPage_FilterTabIndex(t *testing.T) {
	tests := []struct {
		filter string
		want   int
	}{
		{"all", 0},
		{"session", 1},
		{"message", 2},
		{"file", 3},
		{"git", 4},
		{"terminal", 5},
		{"error", 6},
		{"unknown", 0},
	}
	for _, tt := range tests {
		page := ChroniclesPage{filter: tt.filter}
		got := page.filterTabIndex()
		if got != tt.want {
			t.Errorf("filterTabIndex(%q) = %d, want %d", tt.filter, got, tt.want)
		}
	}
}

func TestChroniclesPage_View(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty chronicles view")
	}
}

func TestChroniclesPage_Update_Navigation(t *testing.T) {
	page := NewChroniclesPage(nil)
	// Populate events so navigation has something to work with.
	page.events = []ChronicleEvent{
		{Type: EventMessage, Label: "msg1"},
		{Type: EventFile, Label: "file1"},
		{Type: EventGit, Label: "git1"},
	}
	page.noSession = false
	page.applyFilter()
	page.cursor = 0

	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1 after 'j', got %d", page.cursor)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0 after 'k', got %d", page.cursor)
	}
}

func TestEventTypeStyle(t *testing.T) {
	types := []EventType{EventSession, EventMessage, EventFile, EventGit, EventTerminal, EventError}
	for _, et := range types {
		icon, c := eventTypeStyle(et)
		if icon == "" {
			t.Errorf("expected non-empty icon for %v", et)
		}
		if c == nil {
			t.Errorf("expected non-nil color for %v", et)
		}
	}

	// Unknown type
	icon, c := eventTypeStyle(EventType("unknown"))
	if icon == "" || c == nil {
		t.Error("expected fallback for unknown event type")
	}
}

// Diffs page tests.

func TestNewDiffsPage(t *testing.T) {
	page := NewDiffsPage(nil)
	// NewDiffsPage starts empty (no files until a session is selected).
	if len(page.files) != 0 {
		t.Errorf("expected 0 files, got %d", len(page.files))
	}
}

func TestDiffsPage_Init(t *testing.T) {
	page := NewDiffsPage(nil)
	if page.Init() != nil {
		t.Error("expected nil cmd")
	}
}

func TestDiffsPage_Update_Scroll(t *testing.T) {
	page := NewDiffsPage(nil)

	page, _ = page.Update(tea.KeyPressMsg{Code: 'J'})
	if page.scrollPos != 1 {
		t.Errorf("expected scroll 1 after 'J', got %d", page.scrollPos)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'K'})
	if page.scrollPos != 0 {
		t.Errorf("expected scroll 0 after 'K', got %d", page.scrollPos)
	}
}

func TestDiffsPage_SetSize(t *testing.T) {
	page := NewDiffsPage(nil)
	page.SetSize(120, 40)
	if page.width != 120 || page.height != 40 {
		t.Error("expected dimensions set")
	}
}

func TestDiffsPage_View(t *testing.T) {
	page := NewDiffsPage(nil)
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty diffs view")
	}
}

func TestDiffsPage_View_Empty(t *testing.T) {
	page := DiffsPage{width: 80, height: 24}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view even with no files")
	}
}

func TestTruncatePath(t *testing.T) {
	tests := []struct {
		path   string
		maxLen int
		want   string
	}{
		{"short.go", 20, "short.go"},
		{"a/very/long/path/file.go", 10, "...file.go"},
	}
	for _, tt := range tests {
		got := truncatePath(tt.path, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncatePath(%q, %d) = %q, want %q", tt.path, tt.maxLen, got, tt.want)
		}
	}
}

// Realms page tests.

func TestNewRealmsPage(t *testing.T) {
	page := NewRealmsPage()
	if len(page.realms) == 0 {
		t.Error("expected demo realms")
	}
}

func TestRealmsPage_Init(t *testing.T) {
	page := NewRealmsPage()
	if page.Init() != nil {
		t.Error("expected nil cmd")
	}
}

func TestRealmsPage_Update_Navigation(t *testing.T) {
	page := NewRealmsPage()
	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

func TestRealmsPage_SetSize(t *testing.T) {
	page := NewRealmsPage()
	page.SetSize(120, 40)
	if page.width != 120 || page.height != 40 {
		t.Error("expected dimensions set")
	}
}

func TestRealmsPage_View(t *testing.T) {
	page := NewRealmsPage()
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty realms view")
	}
}

func TestRenderBar(t *testing.T) {
	theme := tui.DefaultTheme

	// Normal bar
	bar := renderBar(5, 10, 20, theme.AccentEmerald, theme.BgTertiary)
	if bar == "" {
		t.Error("expected non-empty bar")
	}

	// Zero max
	bar = renderBar(0, 0, 10, theme.AccentEmerald, theme.BgTertiary)
	if bar == "" {
		t.Error("expected non-empty bar for zero max")
	}

	// Overflow
	bar = renderBar(20, 10, 10, theme.AccentEmerald, theme.BgTertiary)
	if bar == "" {
		t.Error("expected non-empty bar for overflow")
	}
}

func TestDemoRealms(t *testing.T) {
	realms := demoRealms()
	if len(realms) == 0 {
		t.Fatal("expected non-empty demo realms")
	}
	for i, r := range realms {
		if r.Name == "" {
			t.Errorf("realm %d has empty name", i)
		}
		if r.Cluster == "" {
			t.Errorf("realm %d has empty cluster", i)
		}
	}
}

// Admin page tests.

func TestNewAdminPage(t *testing.T) {
	page := NewAdminPage(nil)
	// NewAdminPage with nil client starts in loading state with no data.
	if page.tab != AdminUsers {
		t.Errorf("expected tab Users, got %v", page.tab)
	}
}

func TestAdminPage_Init(t *testing.T) {
	page := NewAdminPage(nil)
	if page.Init() != nil {
		t.Error("expected nil cmd")
	}
}

func TestAdminPage_Update_TabCycle(t *testing.T) {
	page := NewAdminPage(nil)

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.tab != AdminTenants {
		t.Errorf("expected tab Tenants, got %v", page.tab)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.tab != AdminStats {
		t.Errorf("expected tab Stats, got %v", page.tab)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.tab != AdminUsers {
		t.Errorf("expected tab Users (wrapped), got %v", page.tab)
	}
}

func TestAdminPage_Update_ShiftTab(t *testing.T) {
	page := NewAdminPage(nil)

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift})
	if page.tab != AdminStats {
		t.Errorf("expected tab Stats after shift+tab from Users, got %v", page.tab)
	}
}

func TestAdminPage_Update_Navigation(t *testing.T) {
	page := NewAdminPage(nil)
	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

func TestAdminPage_SetSize(t *testing.T) {
	page := NewAdminPage(nil)
	page.SetSize(120, 40)
	if page.width != 120 || page.height != 40 {
		t.Error("expected dimensions set")
	}
}

func TestAdminPage_View_AllTabs(t *testing.T) {
	for _, tab := range []AdminTab{AdminUsers, AdminTenants, AdminStats} {
		page := NewAdminPage(nil)
		page.tab = tab
		page.width = 120
		page.height = 40
		view := page.View()
		if view == "" {
			t.Errorf("expected non-empty view for tab %v", tab)
		}
	}
}

// Campaigns page tests.

func TestNewCampaignsPage(t *testing.T) {
	page := NewCampaignsPage()
	if len(page.campaigns) == 0 {
		t.Error("expected demo campaigns")
	}
}

func TestCampaignsPage_Init(t *testing.T) {
	page := NewCampaignsPage()
	if page.Init() != nil {
		t.Error("expected nil cmd")
	}
}

func TestCampaignsPage_Update_Navigation(t *testing.T) {
	page := NewCampaignsPage()
	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

func TestCampaignsPage_Update_Enter(t *testing.T) {
	page := NewCampaignsPage()

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !page.expanded {
		t.Error("expected expanded after enter")
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if page.expanded {
		t.Error("expected collapsed after second enter")
	}
}

func TestCampaignsPage_Update_Esc(t *testing.T) {
	page := NewCampaignsPage()
	page.expanded = true

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if page.expanded {
		t.Error("expected collapsed after esc")
	}
}

func TestCampaignsPage_SetSize(t *testing.T) {
	page := NewCampaignsPage()
	page.SetSize(120, 40)
	if page.width != 120 || page.height != 40 {
		t.Error("expected dimensions set")
	}
}

func TestCampaignsPage_View_List(t *testing.T) {
	page := NewCampaignsPage()
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty list view")
	}
}

func TestCampaignsPage_View_Detail(t *testing.T) {
	page := NewCampaignsPage()
	page.expanded = true
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty detail view")
	}
}

func TestDemoCampaigns(t *testing.T) {
	campaigns := demoCampaigns()
	if len(campaigns) == 0 {
		t.Fatal("expected non-empty demo campaigns")
	}
	for i, c := range campaigns {
		if c.Name == "" {
			t.Errorf("campaign %d has empty name", i)
		}
		if c.Status == "" {
			t.Errorf("campaign %d has empty status", i)
		}
		if len(c.Phases) == 0 {
			t.Errorf("campaign %d has no phases", i)
		}
	}
}

// Helpers.

// makeKeyMsg creates a KeyPressMsg from a key string.
// For special keys, use the appropriate tea.Key* constant.
func makeKeyMsg(key string) tea.KeyPressMsg {
	switch key {
	case "enter":
		return tea.KeyPressMsg{Code: tea.KeyEnter}
	case "tab":
		return tea.KeyPressMsg{Code: tea.KeyTab}
	case "backspace":
		return tea.KeyPressMsg{Code: tea.KeyBackspace}
	case "esc", "escape":
		return tea.KeyPressMsg{Code: tea.KeyEscape}
	case "up":
		return tea.KeyPressMsg{Code: tea.KeyUp}
	case "down":
		return tea.KeyPressMsg{Code: tea.KeyDown}
	case "right":
		return tea.KeyPressMsg{Code: tea.KeyRight}
	case "left":
		return tea.KeyPressMsg{Code: tea.KeyLeft}
	case "home":
		return tea.KeyPressMsg{Code: tea.KeyHome}
	case "end":
		return tea.KeyPressMsg{Code: tea.KeyEnd}
	case "space":
		return tea.KeyPressMsg{Code: ' '}
	case "delete":
		return tea.KeyPressMsg{Code: tea.KeyDelete}
	case "pgup":
		return tea.KeyPressMsg{Code: tea.KeyPgUp}
	case "pgdown":
		return tea.KeyPressMsg{Code: tea.KeyPgDown}
	case "insert":
		return tea.KeyPressMsg{Code: tea.KeyInsert}
	case "f1":
		return tea.KeyPressMsg{Code: tea.KeyF1}
	case "f2":
		return tea.KeyPressMsg{Code: tea.KeyF2}
	case "f5":
		return tea.KeyPressMsg{Code: tea.KeyF5}
	case "f11":
		return tea.KeyPressMsg{Code: tea.KeyF11}
	case "f12":
		return tea.KeyPressMsg{Code: tea.KeyF12}
	}
	if len(key) == 1 {
		return tea.KeyPressMsg{Code: rune(key[0])}
	}
	return tea.KeyPressMsg{}
}

// Additional coverage tests.

// Terminal Init, Update, handleKey.

func TestTerminalPage_Init(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	cmd := page.Init()
	if cmd == nil {
		t.Error("expected non-nil init cmd (batch of waitForOutput+waitForConn)")
	}
}

func TestTerminalPage_Update_NoTabs(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	// Sending a key with no tabs should be a no-op.
	page, _ = page.Update(tea.KeyPressMsg{Code: 'a'})
	if len(page.tabs) != 0 {
		t.Error("expected no tabs")
	}
}

func TestTerminalPage_Update_WindowSize(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page, _ = page.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if page.width != 120 || page.height != 40 {
		t.Errorf("expected 120x40, got %dx%d", page.width, page.height)
	}
}

func TestTerminalPage_HandleKey_FullScreenToggle(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	// F11 toggles fullscreen
	page, _ = page.handleKey(makeKeyMsg("f11"))
	if !page.fullScreen {
		t.Error("expected fullscreen after F11")
	}
	page, _ = page.handleKey(makeKeyMsg("f11"))
	if page.fullScreen {
		t.Error("expected not fullscreen after second F11")
	}
}

func TestTerminalPage_HandleKey_CtrlT(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page, cmd := page.handleKey(tea.KeyPressMsg{Code: 't', Mod: tea.ModCtrl})
	if cmd != nil {
		t.Error("expected nil cmd for ctrl+t without session")
	}
	_ = page
}

func TestTerminalPage_HandleKey_NoTabs(_ *testing.T) {
	page := NewTerminalPage("", nil, nil)
	_, _ = page.handleKey(tea.KeyPressMsg{Code: 'a'})
	// Should not panic with 0 tabs.
}

// Chronicles SetSize.

func TestChroniclesPage_SetSize(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.SetSize(120, 40)
	if page.width != 120 || page.height != 40 {
		t.Error("expected dimensions set")
	}
}

// Chat scroll.

func TestChatPage_Update_Scroll(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = false
	page.scrollPos = 1

	// "up"/"k" increments scrollPos (scrolls up, further from bottom)
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	if page.scrollPos != 2 {
		t.Errorf("expected scroll 2, got %d", page.scrollPos)
	}

	// "down"/"j" decrements scrollPos (scrolls down, closer to bottom)
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if page.scrollPos != 1 {
		t.Errorf("expected scroll 1, got %d", page.scrollPos)
	}
}

// Campaigns cursor boundary.

func TestCampaignsPage_Update_CursorBoundary(t *testing.T) {
	page := NewCampaignsPage()

	for i := 0; i < 100; i++ {
		page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	}
	if page.cursor >= len(page.campaigns) {
		t.Errorf("cursor %d should be < %d", page.cursor, len(page.campaigns))
	}

	for i := 0; i < 100; i++ {
		page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	}
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

// Realms cursor boundary.

func TestRealmsPage_Update_CursorBoundary(t *testing.T) {
	page := NewRealmsPage()

	for i := 0; i < 100; i++ {
		page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	}
	if page.cursor >= len(page.realms) {
		t.Errorf("cursor %d should be < %d", page.cursor, len(page.realms))
	}

	for i := 0; i < 100; i++ {
		page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	}
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

// Settings section cycle full.

func TestSettingsPage_Update_FullSectionCycle(t *testing.T) {
	page := NewSettingsPage(nil, nil)

	// Tab through all 4 sections
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.section != SectionCredentials {
		t.Error("expected Credentials")
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.section != SectionIntegrations {
		t.Error("expected Integrations")
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.section != SectionAppearance {
		t.Error("expected Appearance")
	}
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.section != SectionConnection {
		t.Error("expected Connection (wrapped)")
	}
}

// RenderTimeline empty filter.

func TestChroniclesPage_View_FilteredEmpty(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.width = 80
	page.height = 24
	page.noSession = false
	page.filter = "error"
	page.filtered = nil

	view := page.View()
	if view == "" {
		t.Error("expected non-empty view even with no filtered events")
	}
}

// Admin rendering with cursor on different rows.

func TestAdminPage_View_UsersCursor(t *testing.T) {
	page := NewAdminPage(nil)
	page.width = 120
	page.height = 40
	page.cursor = 2

	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with cursor on row 2")
	}
}

func TestAdminPage_View_TenantsCursor(t *testing.T) {
	page := NewAdminPage(nil)
	page.tab = AdminTenants
	page.width = 120
	page.height = 40
	page.cursor = 1

	view := page.View()
	if view == "" {
		t.Error("expected non-empty tenants view")
	}
}

func TestAdminPage_View_StatsCursor(t *testing.T) {
	page := NewAdminPage(nil)
	page.tab = AdminStats
	page.width = 120
	page.height = 40
	page.cursor = 3

	view := page.View()
	if view == "" {
		t.Error("expected non-empty stats view")
	}
}

// Suppress unused import warnings.
var _ color.Color
var _ time.Time
