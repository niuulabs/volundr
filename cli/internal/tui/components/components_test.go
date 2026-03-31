package components

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// StatusBadge tests.

func TestNewStatusBadge(t *testing.T) {
	badge := NewStatusBadge("running")
	if badge.Status != "running" {
		t.Errorf("expected status %q, got %q", "running", badge.Status)
	}
}

func TestStatusBadge_View_AllStatuses(t *testing.T) {
	statuses := []string{
		"running", "starting", "provisioning", "stopped",
		"error", "failed", "completed", "pending",
		"connected", "disconnected", "unknown",
	}

	for _, status := range statuses {
		badge := NewStatusBadge(status)
		view := badge.View()
		if view == "" {
			t.Errorf("expected non-empty view for status %q", status)
		}
	}
}

// MetricCard tests.

func TestNewMetricCard(t *testing.T) {
	theme := tui.DefaultTheme
	card := NewMetricCard("Total", "42", "X", theme.AccentCyan)

	if card.Label != "Total" {
		t.Errorf("expected label %q, got %q", "Total", card.Label)
	}
	if card.Value != "42" {
		t.Errorf("expected value %q, got %q", "42", card.Value)
	}
	if card.Icon != "X" {
		t.Errorf("expected icon %q, got %q", "X", card.Icon)
	}
	if card.Width != 20 {
		t.Errorf("expected width 20, got %d", card.Width)
	}
}

func TestMetricCard_View(t *testing.T) {
	card := NewMetricCard("Label", "Value", "I", tui.DefaultTheme.AccentAmber)
	view := card.View()
	if view == "" {
		t.Error("expected non-empty view")
	}
}

func TestMetricRow(t *testing.T) {
	theme := tui.DefaultTheme
	cards := []MetricCard{
		NewMetricCard("A", "1", "a", theme.AccentCyan),
		NewMetricCard("B", "2", "b", theme.AccentAmber),
	}
	view := MetricRow(cards)
	if view == "" {
		t.Error("expected non-empty metric row")
	}
}

func TestMetricRow_Empty(_ *testing.T) {
	view := MetricRow(nil)
	// Should not panic.
	_ = view
}

// Header tests.

func TestNewHeader(t *testing.T) {
	h := NewHeader("https://prod.example.com")
	if h.Title != "Volundr" {
		t.Errorf("expected title %q, got %q", "Volundr", h.Title)
	}
	if h.ServerURL != "https://prod.example.com" {
		t.Errorf("expected server URL, got %q", h.ServerURL)
	}
	if h.Connected {
		t.Error("expected not connected by default")
	}
	if h.PoolSummary != "" {
		t.Error("expected empty pool summary")
	}
}

func TestNewHeaderWithPool(t *testing.T) {
	pool := configWithContexts()
	h := NewHeaderWithPool(pool)

	if h.Title != "Volundr" {
		t.Errorf("expected title %q, got %q", "Volundr", h.Title)
	}
	if !h.Connected {
		t.Error("expected connected with token")
	}
	if h.PoolSummary == "" {
		t.Error("expected non-empty pool summary")
	}
}

func TestHeader_View(t *testing.T) {
	h := NewHeader("https://prod.example.com")
	h.Width = 80
	h.Connected = true
	view := h.View()
	if view == "" {
		t.Error("expected non-empty header view")
	}
}

func TestHeader_View_Disconnected(t *testing.T) {
	h := NewHeader("https://prod.example.com")
	h.Width = 80
	h.Connected = false
	view := h.View()
	if view == "" {
		t.Error("expected non-empty header view even when disconnected")
	}
}

func TestHeader_View_WithPoolSummary(t *testing.T) {
	h := Header{
		Title:       "Volundr",
		ServerURL:   "https://prod.com",
		Width:       80,
		Connected:   true,
		PoolSummary: "2 clusters (2 connected)",
	}
	view := h.View()
	if view == "" {
		t.Error("expected non-empty header view with pool summary")
	}
}

// Tabs tests.

func TestNewTabs(t *testing.T) {
	tabs := NewTabs([]string{"A", "B", "C"})
	if len(tabs.Items) != 3 {
		t.Errorf("expected 3 items, got %d", len(tabs.Items))
	}
	if tabs.ActiveTab != 0 {
		t.Errorf("expected active tab 0, got %d", tabs.ActiveTab)
	}
}

func TestTabs_View(t *testing.T) {
	tabs := Tabs{
		Items:     []string{"All", "Running", "Stopped"},
		ActiveTab: 1,
		Width:     80,
	}
	view := tabs.View()
	if view == "" {
		t.Error("expected non-empty tabs view")
	}
}

func TestTabs_View_Empty(_ *testing.T) {
	tabs := Tabs{Width: 80}
	view := tabs.View()
	_ = view // should not panic
}

// Sidebar tests.

func TestNewSidebar(t *testing.T) {
	sb := NewSidebar()
	if sb.ActivePage != tui.PageSessions {
		t.Errorf("expected active page Sessions, got %v", sb.ActivePage)
	}
	if sb.Width != 24 {
		t.Errorf("expected width 24, got %d", sb.Width)
	}
	if sb.Collapsed {
		t.Error("expected not collapsed by default")
	}
}

func TestSidebar_View(t *testing.T) {
	sb := Sidebar{
		ActivePage: tui.PageSessions,
		Height:     30,
		Width:      24,
		Collapsed:  false,
	}
	view := sb.View()
	if view == "" {
		t.Error("expected non-empty sidebar view")
	}
}

func TestSidebar_View_Collapsed(t *testing.T) {
	sb := Sidebar{
		ActivePage: tui.PageChat,
		Height:     30,
		Width:      24,
		Collapsed:  true,
	}
	view := sb.View()
	if view == "" {
		t.Error("expected non-empty collapsed sidebar view")
	}
}

// Modal tests.

func TestNewModal(t *testing.T) {
	m := NewModal("Test Modal")
	if m.Title != "Test Modal" {
		t.Errorf("expected title %q, got %q", "Test Modal", m.Title)
	}
	if m.Visible {
		t.Error("expected not visible by default")
	}
	if m.Width != 60 {
		t.Errorf("expected width 60, got %d", m.Width)
	}
}

func TestModal_View_Hidden(t *testing.T) {
	m := NewModal("Test")
	view := m.View(80, 24)
	if view != "" {
		t.Error("expected empty view when hidden")
	}
}

func TestModal_View_Visible(t *testing.T) {
	m := NewModal("Test")
	m.Visible = true
	m.Content = "Hello, world!"
	view := m.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view when visible")
	}
}

// HelpOverlay tests.

func TestNewHelpOverlay(t *testing.T) {
	h := NewHelpOverlay()
	if len(h.Bindings) == 0 {
		t.Error("expected non-empty default bindings")
	}
	if h.Visible {
		t.Error("expected not visible by default")
	}
}

func TestDefaultBindings(t *testing.T) {
	bindings := DefaultBindings()
	if len(bindings) == 0 {
		t.Fatal("expected non-empty bindings")
		return
	}

	// Check that at least some expected keys are present.
	found := false
	for _, b := range bindings {
		if b.Key == "q" {
			found = true
		}
	}
	if !found {
		t.Error("expected 'q' in default bindings")
	}
}

func TestHelpOverlay_View_Hidden(t *testing.T) {
	h := NewHelpOverlay()
	view := h.View(80, 24)
	if view != "" {
		t.Error("expected empty view when hidden")
	}
}

func TestHelpOverlay_View_Visible(t *testing.T) {
	h := NewHelpOverlay()
	h.Visible = true
	view := h.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view when visible")
	}
}

// MentionMenu tests.

func TestNewMentionMenu(t *testing.T) {
	m := NewMentionMenu('@')
	if m.Trigger != '@' {
		t.Errorf("expected trigger '@', got %q", m.Trigger)
	}
	if m.Active {
		t.Error("expected not active by default")
	}
	if m.MaxVisible != defaultMaxVisible {
		t.Errorf("expected max visible %d, got %d", defaultMaxVisible, m.MaxVisible)
	}
}

func TestMentionMenu_OpenClose(t *testing.T) {
	m := NewMentionMenu('/')
	m.Open()
	if !m.IsActive() {
		t.Error("expected active after Open()")
	}
	m.Close()
	if m.IsActive() {
		t.Error("expected not active after Close()")
	}
}

func TestMentionMenu_SetItems(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()

	items := []MentionItem{
		{Label: "file1.go", Value: "@file1.go", Icon: "F"},
		{Label: "file2.go", Value: "@file2.go", Icon: "F"},
	}
	m.SetItems(items)

	if len(m.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(m.Items))
	}
	if m.Loading {
		t.Error("expected loading false after SetItems")
	}
}

func TestMentionMenu_Navigation(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.SetItems([]MentionItem{
		{Label: "a", Value: "a"},
		{Label: "b", Value: "b"},
		{Label: "c", Value: "c"},
	})

	// Start at 0
	if m.Selected != 0 {
		t.Errorf("expected selected 0, got %d", m.Selected)
	}

	// Move down
	m.MoveDown()
	if m.Selected != 1 {
		t.Errorf("expected selected 1, got %d", m.Selected)
	}

	// Move down to end
	m.MoveDown()
	if m.Selected != 2 {
		t.Errorf("expected selected 2, got %d", m.Selected)
	}

	// Wrap around
	m.MoveDown()
	if m.Selected != 0 {
		t.Errorf("expected wrap to 0, got %d", m.Selected)
	}

	// Move up wraps from 0
	m.MoveUp()
	if m.Selected != 2 {
		t.Errorf("expected wrap to 2, got %d", m.Selected)
	}
}

func TestMentionMenu_SelectedItem(t *testing.T) {
	m := NewMentionMenu('@')

	// No items
	if m.SelectedItem() != nil {
		t.Error("expected nil when no items")
	}

	m.Open()
	m.SetItems([]MentionItem{
		{Label: "first", Value: "v1"},
		{Label: "second", Value: "v2"},
	})

	item := m.SelectedItem()
	if item == nil {
		t.Fatal("expected non-nil selected item")
		return
	}
	if item.Label != "first" {
		t.Errorf("expected 'first', got %q", item.Label)
	}

	m.MoveDown()
	item = m.SelectedItem()
	if item.Label != "second" {
		t.Errorf("expected 'second', got %q", item.Label)
	}
}

func TestMentionMenu_View_Inactive(t *testing.T) {
	m := NewMentionMenu('@')
	view := m.View(60)
	if view != "" {
		t.Error("expected empty view when inactive")
	}
}

func TestMentionMenu_View_Loading(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.Loading = true
	view := m.View(60)
	if view == "" {
		t.Error("expected non-empty view when loading")
	}
}

func TestMentionMenu_View_Empty(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	view := m.View(60)
	if view == "" {
		t.Error("expected non-empty view (no matches)")
	}
}

func TestMentionMenu_View_WithItems(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.SetItems([]MentionItem{
		{Label: "main.go", Value: "@main.go", Detail: "cmd/main.go", Icon: "F", Category: "file"},
		{Label: "utils.go", Value: "@utils.go", Detail: "pkg/utils.go", Icon: "F", Category: "file"},
	})
	view := m.View(60)
	if view == "" {
		t.Error("expected non-empty view with items")
	}
}

func TestMentionMenu_SetItems_ClampsSelection(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.SetItems([]MentionItem{
		{Label: "a"}, {Label: "b"}, {Label: "c"},
	})
	m.Selected = 2

	// Now set fewer items
	m.SetItems([]MentionItem{{Label: "x"}})
	if m.Selected != 0 {
		t.Errorf("expected selection clamped to 0, got %d", m.Selected)
	}
}

func TestMentionMenu_MoveOnEmpty(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	// Should not panic.
	m.MoveUp()
	m.MoveDown()
	if m.Selected != 0 {
		t.Errorf("expected selected 0 on empty, got %d", m.Selected)
	}
}

func TestFuzzyMatch(t *testing.T) {
	tests := []struct {
		text, query string
		want        bool
	}{
		{"main.go", "", true},
		{"main.go", "main", true},
		{"main.go", "MAIN", true},
		{"main.go", "xyz", false},
		{"README.md", "read", true},
		{"src/utils.go", "util", true},
	}

	for _, tt := range tests {
		got := FuzzyMatch(tt.text, tt.query)
		if got != tt.want {
			t.Errorf("FuzzyMatch(%q, %q) = %v, want %v", tt.text, tt.query, got, tt.want)
		}
	}
}

// Palette tests.

func TestNewPalette(t *testing.T) {
	p := NewPalette()
	if p.Visible {
		t.Error("expected not visible by default")
	}
}

func TestPalette_OpenClose(t *testing.T) {
	p := NewPalette()
	items := DefaultPaletteItems()
	p.Open(items, 80, 24)
	if !p.Visible {
		t.Error("expected visible after Open")
	}
	if len(p.matched) != len(items) {
		t.Errorf("expected %d matched, got %d", len(items), len(p.matched))
	}
	p.Close()
	if p.Visible {
		t.Error("expected not visible after Close")
	}
	if p.query != "" {
		t.Error("expected empty query after Close")
	}
}

func TestPalette_Update_Esc(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 80, 24)
	cmd := p.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if p.Visible {
		t.Error("expected closed after Esc")
	}
	if cmd == nil {
		t.Error("expected non-nil cmd for dismiss")
	}
	msg := cmd()
	if _, ok := msg.(PaletteDismissedMsg); !ok {
		t.Errorf("expected PaletteDismissedMsg, got %T", msg)
	}
}

func TestPalette_Update_Enter(t *testing.T) {
	p := NewPalette()
	items := DefaultPaletteItems()
	p.Open(items, 80, 24)
	cmd := p.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("expected non-nil cmd for select")
		return
	}
	msg := cmd()
	sel, ok := msg.(PaletteSelectedMsg)
	if !ok {
		t.Fatalf("expected PaletteSelectedMsg, got %T", msg)
		return
	}
	if sel.Item.Label != items[0].Label {
		t.Errorf("expected first item, got %q", sel.Item.Label)
	}
}

func TestPalette_Update_EnterEmpty(t *testing.T) {
	p := NewPalette()
	p.Open(nil, 80, 24)
	p.query = "zzzzz"
	p.applyFilter()
	cmd := p.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd != nil {
		t.Error("expected nil cmd when no matches")
	}
}

func TestPalette_Update_Navigation(t *testing.T) {
	p := NewPalette()
	items := DefaultPaletteItems()
	p.Open(items, 80, 24)

	// Move down
	p.Update(tea.KeyPressMsg{Code: tea.KeyDown})
	if p.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", p.cursor)
	}

	// Move up
	p.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	if p.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", p.cursor)
	}

	// Can't go below 0
	p.Update(tea.KeyPressMsg{Code: tea.KeyUp})
	if p.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", p.cursor)
	}
}

func TestPalette_Update_NavigationWithJK(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 80, 24)

	// j navigates when query is empty
	p.Update(tea.KeyPressMsg{Code: 'j'})
	if p.cursor != 1 {
		t.Errorf("expected cursor 1 after j, got %d", p.cursor)
	}

	// k navigates when query is empty
	p.Update(tea.KeyPressMsg{Code: 'k'})
	if p.cursor != 0 {
		t.Errorf("expected cursor 0 after k, got %d", p.cursor)
	}

	// j with query types instead of navigating
	p.query = "x"
	p.Update(tea.KeyPressMsg{Code: 'j'})
	if p.query != "xj" {
		t.Errorf("expected query 'xj', got %q", p.query)
	}

	// k with query types instead of navigating
	p.Update(tea.KeyPressMsg{Code: 'k'})
	if p.query != "xjk" {
		t.Errorf("expected query 'xjk', got %q", p.query)
	}
}

func TestPalette_Update_Typing(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 80, 24)

	p.Update(tea.KeyPressMsg{Code: 's', Text: "s"})
	if p.query != "s" {
		t.Errorf("expected query 's', got %q", p.query)
	}

	// Backspace
	p.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if p.query != "" {
		t.Errorf("expected empty query, got %q", p.query)
	}

	// Backspace on empty
	p.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if p.query != "" {
		t.Errorf("expected empty query still, got %q", p.query)
	}

	// Space
	p.Update(tea.KeyPressMsg{Code: ' '})
	if p.query != " " {
		t.Errorf("expected space, got %q", p.query)
	}
}

func TestPalette_FuzzyFilter(t *testing.T) {
	p := NewPalette()
	items := []PaletteItem{
		{Label: "Sessions", Type: PalettePage},
		{Label: "Chat", Type: PalettePage},
		{Label: "Quit", Desc: "Exit Volundr", Type: PaletteAction},
	}
	p.Open(items, 80, 24)

	p.query = "ses"
	p.applyFilter()
	if len(p.matched) != 1 {
		t.Errorf("expected 1 match for 'ses', got %d", len(p.matched))
	}

	p.query = "xit"
	p.applyFilter()
	if len(p.matched) != 1 {
		t.Errorf("expected 1 match for 'xit' (desc match), got %d", len(p.matched))
	}

	p.query = ""
	p.applyFilter()
	if len(p.matched) != len(items) {
		t.Errorf("expected all items with empty query, got %d", len(p.matched))
	}
}

func TestPalette_FuzzyMatchFunc(t *testing.T) {
	tests := []struct {
		query, target string
		want          bool
	}{
		{"ses", "Sessions", true},
		{"chat", "Chat", true},
		{"sx", "Sessions", false},
		{"", "anything", true},
		{"qt", "Quit", true},
	}
	for _, tt := range tests {
		got := fuzzyMatch(tt.query, tt.target)
		if got != tt.want {
			t.Errorf("fuzzyMatch(%q, %q) = %v, want %v", tt.query, tt.target, got, tt.want)
		}
	}
}

func TestPalette_View_Hidden(t *testing.T) {
	p := NewPalette()
	if p.View(80, 24) != "" {
		t.Error("expected empty view when hidden")
	}
}

func TestPalette_View_Visible(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 80, 24)
	view := p.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view when visible")
	}
}

func TestPalette_View_NoMatches(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 80, 24)
	p.query = "zzzzzzzzz"
	p.applyFilter()
	view := p.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view with no matches message")
	}
}

func TestPalette_View_NarrowTerminal(t *testing.T) {
	p := NewPalette()
	p.Open(DefaultPaletteItems(), 30, 10)
	view := p.View(30, 10)
	if view == "" {
		t.Error("expected non-empty view on narrow terminal")
	}
}

func TestPalette_View_ManyItems(t *testing.T) {
	p := NewPalette()
	items := make([]PaletteItem, 20)
	for i := range items {
		items[i] = PaletteItem{Label: "item", Type: PaletteAction, Icon: "x"}
	}
	p.Open(items, 80, 24)
	view := p.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view with many items")
	}
}

func TestPalette_View_SectionHeaders(t *testing.T) {
	p := NewPalette()
	items := []PaletteItem{
		{Label: "sess", Type: PaletteSession, Icon: "s"},
		{Label: "page", Type: PalettePage, Icon: "p"},
		{Label: "act", Type: PaletteAction, Icon: "a"},
	}
	p.Open(items, 80, 24)
	view := p.View(80, 24)
	if view == "" {
		t.Error("expected non-empty view with section headers")
	}
}

func TestPalette_IconColor(t *testing.T) {
	p := NewPalette()
	for _, pt := range []PaletteResultType{PaletteSession, PalettePage, PaletteAction} {
		c := p.iconColor(pt)
		if c == nil {
			t.Errorf("expected non-nil color for type %d", pt)
		}
	}
	// Unknown type
	c := p.iconColor(PaletteResultType(99))
	if c == nil {
		t.Error("expected non-nil fallback color")
	}
}

func TestDefaultPaletteItems(t *testing.T) {
	items := DefaultPaletteItems()
	if len(items) == 0 {
		t.Error("expected non-empty default palette items")
	}
	// Check we have both pages and actions.
	hasPage := false
	hasAction := false
	for _, item := range items {
		if item.Type == PalettePage {
			hasPage = true
		}
		if item.Type == PaletteAction {
			hasAction = true
		}
	}
	if !hasPage {
		t.Error("expected page items in defaults")
	}
	if !hasAction {
		t.Error("expected action items in defaults")
	}
}

// Footer tests.

func TestNewFooter(t *testing.T) {
	f := NewFooter()
	if f.Width != 0 {
		t.Errorf("expected width 0, got %d", f.Width)
	}
}

func TestFooter_View_AllPages(t *testing.T) {
	pages := []tui.Page{
		tui.PageSessions, tui.PageChat, tui.PageTerminal,
		tui.PageDiffs, tui.PageChronicles, tui.PageSettings, tui.PageAdmin,
	}
	for _, page := range pages {
		f := Footer{Width: 80, Page: page, Mode: tui.ModeNormal}
		view := f.View()
		if view == "" {
			t.Errorf("expected non-empty footer view for page %v", page)
		}
	}
}

func TestFooter_View_ModeCommand(t *testing.T) {
	f := Footer{Width: 80, Page: tui.PageSessions, Mode: tui.ModeCommand}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view in command mode")
	}
}

func TestFooter_View_ModeSearch(t *testing.T) {
	f := Footer{Width: 80, Page: tui.PageSessions, Mode: tui.ModeSearch}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view in search mode")
	}
}

func TestFooter_View_ModeInsert_Chat(t *testing.T) {
	f := Footer{Width: 80, Page: tui.PageChat, Mode: tui.ModeInsert}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view in insert mode for chat")
	}
}

func TestFooter_View_ModeInsert_Terminal(t *testing.T) {
	f := Footer{Width: 80, Page: tui.PageTerminal, Mode: tui.ModeInsert}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view in insert mode for terminal")
	}
}

func TestFooter_View_ModeInsert_Settings(t *testing.T) {
	f := Footer{Width: 80, Page: tui.PageSettings, Mode: tui.ModeInsert}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view in insert mode for settings")
	}
}

func TestFooter_View_DefaultPage(t *testing.T) {
	// A page that doesn't match any known page should fall through to default.
	f := Footer{Width: 80, Page: tui.Page(99), Mode: tui.ModeNormal}
	view := f.View()
	if view == "" {
		t.Error("expected non-empty footer view for unknown page")
	}
}

func TestFooter_HintsForContext(t *testing.T) {
	tests := []struct {
		page tui.Page
		mode tui.Mode
		min  int // Minimum expected hints.
	}{
		{tui.PageSessions, tui.ModeNormal, 5},
		{tui.PageChat, tui.ModeNormal, 3},
		{tui.PageChat, tui.ModeInsert, 3},
		{tui.PageTerminal, tui.ModeNormal, 5},
		{tui.PageTerminal, tui.ModeInsert, 4},
		{tui.PageDiffs, tui.ModeNormal, 5},
		{tui.PageChronicles, tui.ModeNormal, 5},
		{tui.PageSettings, tui.ModeNormal, 2},
		{tui.PageSettings, tui.ModeInsert, 2},
		{tui.PageAdmin, tui.ModeNormal, 5},
		{tui.PageSessions, tui.ModeCommand, 3},
		{tui.PageSessions, tui.ModeSearch, 3},
	}
	for _, tt := range tests {
		f := Footer{Page: tt.page, Mode: tt.mode}
		hints := f.hintsForContext()
		if len(hints) < tt.min {
			t.Errorf("page=%v mode=%v: expected >= %d hints, got %d", tt.page, tt.mode, tt.min, len(hints))
		}
	}
}

// MentionMenu additional tests.

func TestMentionMenu_SetQuery(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.SetQuery("test")
	if m.Query != "test" {
		t.Errorf("expected query 'test', got %q", m.Query)
	}
}

func TestMentionMenu_View_Scrolling(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	// Create more items than MaxVisible
	items := make([]MentionItem, 15)
	for i := range items {
		items[i] = MentionItem{Label: "item", Value: "v", Icon: "F"}
	}
	m.SetItems(items)
	m.Selected = 12 // Select near the end
	view := m.View(60)
	if view == "" {
		t.Error("expected non-empty view with scrolling")
	}
}

func TestMentionMenu_View_DetailTruncation(t *testing.T) {
	m := NewMentionMenu('@')
	m.Open()
	m.SetItems([]MentionItem{
		{Label: "a-very-long-filename-that-needs-truncation.go", Value: "v", Detail: "some/very/long/path/detail", Icon: "F"},
	})
	view := m.View(40)
	if view == "" {
		t.Error("expected non-empty view with truncation")
	}
}

// Header additional test for pointer receiver.

func TestHeader_View_AllStates(t *testing.T) {
	for _, state := range []HeaderState{HeaderConnecting, HeaderConnected, HeaderDisconnected} {
		h := &Header{
			Title:     "Volundr",
			ServerURL: "https://test.com",
			Width:     80,
			State:     state,
		}
		view := h.View()
		if view == "" {
			t.Errorf("expected non-empty view for state %d", state)
		}
	}
}

func TestHeader_View_AllModes(t *testing.T) {
	for _, mode := range []tui.Mode{tui.ModeNormal, tui.ModeInsert, tui.ModeSearch, tui.ModeCommand} {
		h := &Header{
			Title:     "Volundr",
			ServerURL: "https://test.com",
			Width:     80,
			Mode:      mode,
		}
		view := h.View()
		if view == "" {
			t.Errorf("expected non-empty view for mode %v", mode)
		}
	}
}

// Helper for tests.

func configWithContexts() *tui.ClientPool {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.com",
		Token:  "tok",
	}
	return tui.NewClientPool(cfg)
}
