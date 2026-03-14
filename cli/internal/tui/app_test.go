package tui

import (
	"testing"

	tea "charm.land/bubbletea/v2"
)

func TestNewApp(t *testing.T) {
	app := NewApp("https://prod.example.com")
	if app.ActivePage != PageSessions {
		t.Errorf("expected active page Sessions, got %v", app.ActivePage)
	}
	if !app.ShowSidebar {
		t.Error("expected sidebar shown by default")
	}
	if app.ServerURL != "https://prod.example.com" {
		t.Errorf("expected server URL %q, got %q", "https://prod.example.com", app.ServerURL)
	}
	if app.Ready {
		t.Error("expected not ready before window size msg")
	}
	if app.Width != 0 || app.Height != 0 {
		t.Error("expected zero dimensions initially")
	}
}

func TestApp_Init(t *testing.T) {
	app := NewApp("")
	cmd := app.Init()
	if cmd != nil {
		t.Error("expected nil init command")
	}
}

func TestApp_Update_WindowSize(t *testing.T) {
	app := NewApp("")
	app, _ = app.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	if !app.Ready {
		t.Error("expected ready after window size msg")
	}
	if app.Width != 120 {
		t.Errorf("expected width 120, got %d", app.Width)
	}
	if app.Height != 40 {
		t.Errorf("expected height 40, got %d", app.Height)
	}
}

func TestApp_Update_ToggleHelp(t *testing.T) {
	app := NewApp("")
	app.Ready = true

	// Press '?' to toggle help on.
	app, _ = app.Update(tea.KeyPressMsg{Code: '?'})
	if !app.ShowHelp {
		t.Error("expected help visible after '?'")
	}

	// Press '?' again to toggle help off.
	app, _ = app.Update(tea.KeyPressMsg{Code: '?'})
	if app.ShowHelp {
		t.Error("expected help hidden after second '?'")
	}
}

func TestApp_Update_EscClosesHelp(t *testing.T) {
	app := NewApp("")
	app.ShowHelp = true

	app, _ = app.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if app.ShowHelp {
		t.Error("expected help closed after Esc")
	}
}

func TestApp_Update_ToggleSidebar(t *testing.T) {
	app := NewApp("")
	if !app.ShowSidebar {
		t.Fatal("expected sidebar shown initially")
	}

	app, _ = app.Update(tea.KeyPressMsg{Code: '['})
	if app.ShowSidebar {
		t.Error("expected sidebar hidden after '['")
	}

	app, _ = app.Update(tea.KeyPressMsg{Code: '['})
	if !app.ShowSidebar {
		t.Error("expected sidebar shown after second '['")
	}
}

func TestApp_Update_QuitClosesHelp(t *testing.T) {
	app := NewApp("")
	app.ShowHelp = true

	app, cmd := app.Update(tea.KeyPressMsg{Code: 'q'})
	// When help is visible, 'q' should close help, not quit.
	if app.ShowHelp {
		t.Error("expected help closed after 'q'")
	}
	if cmd != nil {
		t.Error("expected no quit command when help was open")
	}
}

func TestApp_Update_PageNavigation(t *testing.T) {
	app := NewApp("")
	app.Ready = true

	tests := []struct {
		key  rune
		page Page
	}{
		{'1', PageSessions},
		{'2', PageChat},
		{'3', PageTerminal},
		{'4', PageDiffs},
		{'5', PageChronicles},
		{'6', PageSettings},
		{'7', PageAdmin},
	}

	for _, tt := range tests {
		app, _ = app.Update(tea.KeyPressMsg{Code: tt.key})
		if app.ActivePage != tt.page {
			t.Errorf("key %q: expected page %v, got %v", string(tt.key), tt.page, app.ActivePage)
		}
	}
}

func TestApp_Update_InputCaptured_SuppressesQ(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true

	// 'q' should NOT quit when input is captured.
	app, cmd := app.Update(tea.KeyPressMsg{Code: 'q'})
	if cmd != nil {
		t.Error("expected no quit command when input is captured")
	}
	_ = app
}

func TestApp_Update_InputCaptured_SuppressesHelp(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true

	// '?' should NOT toggle help when input is captured.
	app, _ = app.Update(tea.KeyPressMsg{Code: '?'})
	if app.ShowHelp {
		t.Error("expected help to stay hidden when input is captured")
	}
}

func TestApp_Update_InputCaptured_SuppressesSidebar(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true

	// '[' should NOT toggle sidebar when input is captured.
	before := app.ShowSidebar
	app, _ = app.Update(tea.KeyPressMsg{Code: '['})
	if app.ShowSidebar != before {
		t.Error("expected sidebar unchanged when input is captured")
	}
}

func TestApp_Update_InputCaptured_SuppressesNavigation(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true
	app.ActivePage = PageSessions

	// '3' should NOT navigate when input is captured.
	app, _ = app.Update(tea.KeyPressMsg{Code: '3'})
	if app.ActivePage != PageSessions {
		t.Error("expected page unchanged when input is captured")
	}
}

func TestApp_Update_InputCaptured_CtrlCStillQuits(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true

	// ctrl+c should ALWAYS quit.
	_, cmd := app.Update(tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl})
	if cmd == nil {
		t.Error("expected quit command for ctrl+c even when input is captured")
	}
}

func TestApp_Update_InputCaptured_EscClosesHelp(t *testing.T) {
	app := NewApp("")
	app.InputCaptured = true
	app.ShowHelp = true

	// Esc should ALWAYS close help, even when input is captured.
	app, _ = app.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if app.ShowHelp {
		t.Error("expected help closed after Esc, even when input is captured")
	}
}

func TestApp_Update_AltNavigation(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.InputCaptured = true // should still work

	tests := []struct {
		key  rune
		page Page
	}{
		{'1', PageSessions},
		{'2', PageChat},
		{'3', PageTerminal},
		{'4', PageDiffs},
		{'5', PageChronicles},
		{'6', PageSettings},
		{'7', PageAdmin},
	}

	for _, tt := range tests {
		app, _ = app.Update(tea.KeyPressMsg{Code: tt.key, Mod: tea.ModAlt})
		if app.ActivePage != tt.page {
			t.Errorf("alt+%q: expected page %v, got %v", string(tt.key), tt.page, app.ActivePage)
		}
	}
}

func TestApp_View_NotReady(t *testing.T) {
	app := NewApp("")
	view := app.View()
	if view == "" {
		t.Error("expected loading message when not ready")
	}
}

func TestApp_View_Ready(t *testing.T) {
	app := NewApp("")
	app.Ready = true
	app.Width = 80
	app.Height = 24
	view := app.View()
	if view == "" {
		t.Error("expected non-empty view when ready")
	}
}

func TestApp_ContentWidth_Sidebar(t *testing.T) {
	app := NewApp("")
	app.Width = 120
	app.ShowSidebar = true

	if app.ContentWidth() != 120-26 {
		t.Errorf("expected content width %d, got %d", 120-26, app.ContentWidth())
	}
}

func TestApp_ContentWidth_NoSidebar(t *testing.T) {
	app := NewApp("")
	app.Width = 120
	app.ShowSidebar = false

	if app.ContentWidth() != 120-7 {
		t.Errorf("expected content width %d, got %d", 120-7, app.ContentWidth())
	}
}

func TestApp_ContentHeight(t *testing.T) {
	app := NewApp("")
	app.Height = 40

	if app.ContentHeight() != 38 {
		t.Errorf("expected content height %d, got %d", 38, app.ContentHeight())
	}
}

// --- Keymap tests ---

func TestIsNavigationKey_Valid(t *testing.T) {
	tests := []struct {
		key  rune
		page Page
	}{
		{'1', PageSessions},
		{'2', PageChat},
		{'3', PageTerminal},
		{'4', PageDiffs},
		{'5', PageChronicles},
		{'6', PageSettings},
		{'7', PageAdmin},
	}

	for _, tt := range tests {
		page, ok := IsNavigationKey(tea.KeyPressMsg{Code: tt.key})
		if !ok {
			t.Errorf("expected key %q to be navigation key", string(tt.key))
		}
		if page != tt.page {
			t.Errorf("key %q: expected page %v, got %v", string(tt.key), tt.page, page)
		}
	}
}

func TestIsAltNavigationKey_Valid(t *testing.T) {
	tests := []struct {
		key  rune
		page Page
	}{
		{'1', PageSessions},
		{'2', PageChat},
		{'3', PageTerminal},
		{'4', PageDiffs},
		{'5', PageChronicles},
		{'6', PageSettings},
		{'7', PageAdmin},
	}

	for _, tt := range tests {
		page, ok := IsAltNavigationKey(tea.KeyPressMsg{Code: tt.key, Mod: tea.ModAlt})
		if !ok {
			t.Errorf("expected alt+%q to be alt navigation key", string(tt.key))
		}
		if page != tt.page {
			t.Errorf("alt+%q: expected page %v, got %v", string(tt.key), tt.page, page)
		}
	}
}

func TestIsAltNavigationKey_Invalid(t *testing.T) {
	// Plain number should NOT match alt nav.
	_, ok := IsAltNavigationKey(tea.KeyPressMsg{Code: '1'})
	if ok {
		t.Error("expected plain '1' to not be an alt navigation key")
	}

	_, ok = IsAltNavigationKey(tea.KeyPressMsg{Code: 'a', Mod: tea.ModAlt})
	if ok {
		t.Error("expected alt+a to not be an alt navigation key")
	}
}

func TestIsNavigationKey_Invalid(t *testing.T) {
	_, ok := IsNavigationKey(tea.KeyPressMsg{Code: 'a'})
	if ok {
		t.Error("expected 'a' to not be a navigation key")
	}

	_, ok = IsNavigationKey(tea.KeyPressMsg{Code: '0'})
	if ok {
		t.Error("expected '0' to not be a navigation key")
	}
}

func TestPages_AllPresent(t *testing.T) {
	if len(Pages) != PageCount {
		t.Errorf("expected %d pages in map, got %d", PageCount, len(Pages))
	}

	for _, page := range PageOrder {
		info, ok := Pages[page]
		if !ok {
			t.Errorf("page %v not found in Pages map", page)
		}
		if info.Name == "" {
			t.Errorf("page %v has empty name", page)
		}
		if info.Icon == "" {
			t.Errorf("page %v has empty icon", page)
		}
		if info.Key == "" {
			t.Errorf("page %v has empty key", page)
		}
	}
}

func TestPageOrder_MatchesPageCount(t *testing.T) {
	if len(PageOrder) != PageCount {
		t.Errorf("expected %d pages in order, got %d", PageCount, len(PageOrder))
	}
}

// --- Theme tests ---

func TestDefaultTheme_ColorsNonNil(t *testing.T) {
	theme := DefaultTheme

	if theme.BgPrimary == nil {
		t.Error("expected non-nil BgPrimary")
	}
	if theme.BgSecondary == nil {
		t.Error("expected non-nil BgSecondary")
	}
	if theme.BgTertiary == nil {
		t.Error("expected non-nil BgTertiary")
	}
	if theme.BgElevated == nil {
		t.Error("expected non-nil BgElevated")
	}
	if theme.TextPrimary == nil {
		t.Error("expected non-nil TextPrimary")
	}
	if theme.TextSecondary == nil {
		t.Error("expected non-nil TextSecondary")
	}
	if theme.TextMuted == nil {
		t.Error("expected non-nil TextMuted")
	}
	if theme.Border == nil {
		t.Error("expected non-nil Border")
	}
	if theme.AccentAmber == nil {
		t.Error("expected non-nil AccentAmber")
	}
	if theme.AccentCyan == nil {
		t.Error("expected non-nil AccentCyan")
	}
	if theme.AccentEmerald == nil {
		t.Error("expected non-nil AccentEmerald")
	}
	if theme.AccentPurple == nil {
		t.Error("expected non-nil AccentPurple")
	}
	if theme.AccentRed == nil {
		t.Error("expected non-nil AccentRed")
	}
	if theme.AccentIndigo == nil {
		t.Error("expected non-nil AccentIndigo")
	}
	if theme.AccentOrange == nil {
		t.Error("expected non-nil AccentOrange")
	}
}

func TestThemeStyles_NotZeroValue(_ *testing.T) {
	// Just verify the package-level styles can be accessed without panic.
	_ = SidebarStyle.Render("test")
	_ = SidebarActiveStyle.Render("test")
	_ = SidebarItemStyle.Render("test")
	_ = HeaderStyle.Render("test")
	_ = ContentStyle.Render("test")
	_ = StatusRunning.Render("test")
	_ = StatusStopped.Render("test")
	_ = StatusError.Render("test")
	_ = AccentCyanStyle.Render("test")
	_ = AccentAmberStyle.Render("test")
	_ = AccentPurpleStyle.Render("test")
	_ = AccentEmeraldStyle.Render("test")
	_ = AccentIndigoStyle.Render("test")
	_ = MutedStyle.Render("test")
	_ = BorderStyle.Render("test")
	_ = CardStyle.Render("test")
	_ = TabActiveStyle.Render("test")
	_ = TabInactiveStyle.Render("test")
	_ = DimBorderStyle.Render("test")
}

// --- Messages tests ---

func TestClusterSession_Fields(t *testing.T) {
	cs := ClusterSession{
		ContextKey:  "prod",
		ContextName: "production",
	}
	cs.ID = "s1"
	cs.Name = "test-session"

	if cs.ContextKey != "prod" {
		t.Errorf("expected context key %q, got %q", "prod", cs.ContextKey)
	}
	if cs.ID != "s1" {
		t.Errorf("expected session ID %q, got %q", "s1", cs.ID)
	}
}

func TestAllSessionsLoadedMsg_Fields(t *testing.T) {
	msg := AllSessionsLoadedMsg{
		Sessions: []ClusterSession{
			{ContextKey: "prod"},
		},
		Errors: map[string]error{
			"staging": nil,
		},
	}

	if len(msg.Sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(msg.Sessions))
	}
	if len(msg.Errors) != 1 {
		t.Errorf("expected 1 error entry, got %d", len(msg.Errors))
	}
}

func TestClusterStatusMsg_Fields(t *testing.T) {
	msg := ClusterStatusMsg{
		ContextKey: "prod",
		Status:     ClusterConnected,
		Error:      nil,
	}

	if msg.ContextKey != "prod" {
		t.Errorf("expected context key %q, got %q", "prod", msg.ContextKey)
	}
	if msg.Status != ClusterConnected {
		t.Errorf("expected status Connected, got %v", msg.Status)
	}
}

// --- ContextAccentColors test ---

func TestContextAccentColors_NonEmpty(t *testing.T) {
	if len(ContextAccentColors) == 0 {
		t.Fatal("expected non-empty ContextAccentColors")
	}
	for i, c := range ContextAccentColors {
		if c == nil {
			t.Errorf("ContextAccentColors[%d] is nil", i)
		}
	}
}

// --- HammerLogo ---

func TestHammerLogo_NonEmpty(t *testing.T) {
	if HammerLogo == "" {
		t.Error("expected non-empty HammerLogo")
	}
	if HammerLogoSmall == "" {
		t.Error("expected non-empty HammerLogoSmall")
	}
	if VolundrBanner == "" {
		t.Error("expected non-empty VolundrBanner")
	}
}
