package pages

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

func TestNewSessionsPage_NilPool(t *testing.T) {
	page := NewSessionsPage(nil)
	// Should fall back to demo data.
	if len(page.sessions) == 0 {
		t.Error("expected demo sessions for nil pool")
	}
	if page.filter != "all" {
		t.Errorf("expected filter %q, got %q", "all", page.filter)
	}
	if page.loading {
		t.Error("expected not loading for nil pool")
	}
}

func TestNewSessionsPage_EmptyPool(t *testing.T) {
	cfg := remote.DefaultConfig()
	pool := tui.NewClientPool(cfg)
	page := NewSessionsPage(pool)
	// Empty pool should also fall back to demo data.
	if len(page.sessions) == 0 {
		t.Error("expected demo sessions for empty pool")
	}
}

func TestNewSessionsPage_WithPool(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.example.com",
		Token:  "tok",
	}
	pool := tui.NewClientPool(cfg)
	page := NewSessionsPage(pool)

	if !page.loading {
		t.Error("expected loading=true for pool with entries")
	}
	if page.pool == nil {
		t.Error("expected non-nil pool")
	}
}

func TestSessionsPage_Init_NilPool(t *testing.T) {
	page := NewSessionsPage(nil)
	cmd := page.Init()
	if cmd != nil {
		t.Error("expected nil cmd for nil pool")
	}
}

func TestSessionsPage_SelectedSession_Empty(t *testing.T) {
	page := SessionsPage{filter: "all"}
	if page.SelectedSession() != nil {
		t.Error("expected nil for empty filtered list")
	}
}

func TestSessionsPage_SelectedSession_Valid(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "test"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions: sessions,
		filtered: sessions,
		cursor:   0,
		filter:   "all",
	}
	sel := page.SelectedSession()
	if sel == nil {
		t.Fatal("expected non-nil selected session")
		return
	}
	if sel.ID != "s1" {
		t.Errorf("expected ID %q, got %q", "s1", sel.ID)
	}
}

func TestSessionsPage_SelectedSession_OutOfBounds(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions: sessions,
		filtered: sessions,
		cursor:   5, // out of bounds
		filter:   "all",
	}
	if page.SelectedSession() != nil {
		t.Error("expected nil for out-of-bounds cursor")
	}
}

func TestSessionsPage_SetSize(t *testing.T) {
	page := NewSessionsPage(nil)
	page.SetSize(120, 40)
	if page.width != 120 {
		t.Errorf("expected width 120, got %d", page.width)
	}
	if page.height != 40 {
		t.Errorf("expected height 40, got %d", page.height)
	}
}

func TestSessionsPage_ApplyFilter_StatusFilter(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "running-1", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Name: "stopped-1", Status: "stopped"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s3", Name: "running-2", Status: "running"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "running"}
	page.applyFilter()
	if len(page.filtered) != 2 {
		t.Errorf("expected 2 running sessions, got %d", len(page.filtered))
	}

	page.filter = "stopped"
	page.applyFilter()
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 stopped session, got %d", len(page.filtered))
	}

	page.filter = "all"
	page.applyFilter()
	if len(page.filtered) != 3 {
		t.Errorf("expected 3 sessions for 'all', got %d", len(page.filtered))
	}
}

func TestSessionsPage_ApplyFilter_SearchFilter(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "auth-service", Status: "running", Repo: "niuu/volundr"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Name: "web-client", Status: "running", Repo: "niuu/web"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "all", search: "auth"}
	page.applyFilter()
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 session matching 'auth', got %d", len(page.filtered))
	}
	if page.filtered[0].Name != "auth-service" {
		t.Errorf("expected auth-service, got %q", page.filtered[0].Name)
	}
}

func TestSessionsPage_ApplyFilter_SearchByModel(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "a", Model: "claude-opus-4"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Name: "b", Model: "claude-sonnet-4"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "all", search: "opus"}
	page.applyFilter()
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 session matching model 'opus', got %d", len(page.filtered))
	}
}

func TestSessionsPage_ApplyFilter_ContextFilter(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "a"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Name: "b"}, ContextKey: "staging"},
		{Session: api.Session{ID: "s3", Name: "c"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "all", contextFilter: "prod"}
	page.applyFilter()
	if len(page.filtered) != 2 {
		t.Errorf("expected 2 sessions for context 'prod', got %d", len(page.filtered))
	}
}

func TestSessionsPage_ApplyFilter_CursorClamp(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Status: "stopped"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "all", cursor: 1}
	page.filter = "running"
	page.applyFilter()
	// Only 1 running session, cursor should clamp to 0.
	if page.cursor != 0 {
		t.Errorf("expected cursor clamped to 0, got %d", page.cursor)
	}
}

func TestSessionsPage_Update_AllSessionsLoaded(t *testing.T) {
	page := SessionsPage{loading: true, filter: "all"}
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
	}
	msg := tui.AllSessionsLoadedMsg{Sessions: sessions}

	page, _ = page.Update(msg)
	if page.loading {
		t.Error("expected loading=false after AllSessionsLoadedMsg")
	}
	if len(page.sessions) != 1 {
		t.Errorf("expected 1 session, got %d", len(page.sessions))
	}
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 filtered session, got %d", len(page.filtered))
	}
}

func TestSessionsPage_View_Loading(t *testing.T) {
	page := SessionsPage{loading: true, width: 80, height: 24}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty loading view")
	}
}

func TestSessionsPage_View_WithSessions(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "test", Status: "running", Model: "claude"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions: sessions,
		filtered: sessions,
		filter:   "all",
		width:    80,
		height:   24,
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view")
	}
}

func TestSessionsPage_View_NoSessions(t *testing.T) {
	page := SessionsPage{
		filter: "all",
		width:  80,
		height: 24,
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view even with no sessions")
	}
}

// Helper function tests.

func TestFilterIndex(t *testing.T) {
	tests := []struct {
		filter string
		want   int
	}{
		{"all", 0},
		{"running", 1},
		{"stopped", 2},
		{"error", 3},
		{"unknown", 0},
	}

	for _, tt := range tests {
		got := filterIndex(tt.filter)
		if got != tt.want {
			t.Errorf("filterIndex(%q) = %d, want %d", tt.filter, got, tt.want)
		}
	}
}

func TestFormatTokens(t *testing.T) {
	tests := []struct {
		tokens int
		want   string
	}{
		{0, "0"},
		{500, "500"},
		{999, "999"},
		{1000, "1.0K"},
		{1500, "1.5K"},
		{128450, "128.4K"},
		{999999, "1000.0K"},
		{1000000, "1.0M"},
		{1500000, "1.5M"},
	}

	for _, tt := range tests {
		got := formatTokens(tt.tokens)
		if got != tt.want {
			t.Errorf("formatTokens(%d) = %q, want %q", tt.tokens, got, tt.want)
		}
	}
}

func TestDemoSessions(t *testing.T) {
	demos := demoSessions()
	if len(demos) == 0 {
		t.Fatal("expected non-empty demo sessions")
		return
	}

	// Verify all demo sessions have required fields.
	for i, s := range demos {
		if s.ID == "" {
			t.Errorf("demo session %d has empty ID", i)
		}
		if s.Name == "" {
			t.Errorf("demo session %d has empty Name", i)
		}
		if s.Status == "" {
			t.Errorf("demo session %d has empty Status", i)
		}
	}
}

func TestCycleContextFilter_NilPool(t *testing.T) {
	page := SessionsPage{filter: "all"}
	page.cycleContextFilter()
	// Should be no-op.
	if page.contextFilter != "" {
		t.Errorf("expected empty context filter, got %q", page.contextFilter)
	}
}

func TestCycleContextFilter_SingleContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod", Server: "https://prod.com", Token: "tok"}
	pool := tui.NewClientPool(cfg)

	page := SessionsPage{pool: pool, filter: "all"}
	page.cycleContextFilter()
	// Should be no-op with single context.
	if page.contextFilter != "" {
		t.Errorf("expected empty context filter, got %q", page.contextFilter)
	}
}

func TestCycleContextFilter_MultipleContexts(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{Name: "a", Server: "https://a.com", Token: "tok"}
	cfg.Contexts["b"] = &remote.Context{Name: "b", Server: "https://b.com", Token: "tok"}
	cfg.Contexts["c"] = &remote.Context{Name: "c", Server: "https://c.com", Token: "tok"}
	pool := tui.NewClientPool(cfg)

	page := SessionsPage{pool: pool, filter: "all"}

	// First cycle: "" -> "a"
	page.cycleContextFilter()
	if page.contextFilter != "a" {
		t.Errorf("expected context filter %q, got %q", "a", page.contextFilter)
	}

	// Second cycle: "a" -> "b"
	page.cycleContextFilter()
	if page.contextFilter != "b" {
		t.Errorf("expected context filter %q, got %q", "b", page.contextFilter)
	}

	// Third cycle: "b" -> "c"
	page.cycleContextFilter()
	if page.contextFilter != "c" {
		t.Errorf("expected context filter %q, got %q", "c", page.contextFilter)
	}

	// Fourth cycle: "c" -> "" (wrap to all)
	page.cycleContextFilter()
	if page.contextFilter != "" {
		t.Errorf("expected empty context filter after full cycle, got %q", page.contextFilter)
	}
}

// Update key navigation tests.

func TestSessionsPage_Update_CursorNavigation(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s3", Status: "running"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filtered: sessions, filter: "all"}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 2 {
		t.Errorf("expected cursor 2, got %d", page.cursor)
	}

	// Can't go past end
	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 2 {
		t.Errorf("expected cursor 2 (clamped), got %d", page.cursor)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}
}

func TestSessionsPage_Update_FilterKeys(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Status: "stopped"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s3", Status: "error"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filter: "all"}
	page.applyFilter()

	// Tab cycles forward through filters: all -> running -> stopped -> error -> all
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.filter != "running" {
		t.Errorf("expected filter 'running', got %q", page.filter)
	}
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 running, got %d", len(page.filtered))
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.filter != "stopped" {
		t.Errorf("expected filter 'stopped', got %q", page.filter)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.filter != "error" {
		t.Errorf("expected filter 'error', got %q", page.filter)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.filter != "all" {
		t.Errorf("expected filter 'all', got %q", page.filter)
	}
}

func TestSessionsPage_Update_SearchMode(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "auth-service", Status: "running"}, ContextKey: "prod"},
		{Session: api.Session{ID: "s2", Name: "web-client", Status: "running"}, ContextKey: "prod"},
	}

	page := SessionsPage{sessions: sessions, filtered: sessions, filter: "all"}

	// Enter search mode
	page, _ = page.Update(tea.KeyPressMsg{Code: '/'})
	if !page.searching {
		t.Error("expected searching after '/'")
	}

	// Type "auth"
	page, _ = page.Update(tea.KeyPressMsg{Code: 'a', Text: "a"})
	page, _ = page.Update(tea.KeyPressMsg{Code: 'u', Text: "u"})
	page, _ = page.Update(tea.KeyPressMsg{Code: 't', Text: "t"})
	page, _ = page.Update(tea.KeyPressMsg{Code: 'h', Text: "h"})
	if page.search != "auth" {
		t.Errorf("expected search %q, got %q", "auth", page.search)
	}
	if len(page.filtered) != 1 {
		t.Errorf("expected 1 filtered result, got %d", len(page.filtered))
	}

	// Backspace
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if page.search != "aut" {
		t.Errorf("expected search %q after backspace, got %q", "aut", page.search)
	}

	// Enter exits search
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if page.searching {
		t.Error("expected not searching after enter")
	}
}

func TestSessionsPage_Update_SearchEsc(t *testing.T) {
	page := SessionsPage{filter: "all", searching: true, search: "test"}
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if page.searching {
		t.Error("expected not searching after esc")
	}
}

func TestSessionsPage_Update_Refresh(t *testing.T) {
	// Without pool, 'r' should be a no-op
	page := SessionsPage{filter: "all"}
	page, cmd := page.Update(tea.KeyPressMsg{Code: 'r'})
	if cmd != nil {
		t.Error("expected nil cmd for refresh without pool")
	}
	if page.loading {
		t.Error("expected not loading without pool")
	}
}

func TestSessionsPage_Update_ContextCycle(_ *testing.T) {
	page := SessionsPage{filter: "all"}
	_, _ = page.Update(tea.KeyPressMsg{Code: 'c'})
	// Should not panic with nil pool
}

func TestSessionsPage_Searching(t *testing.T) {
	page := NewSessionsPage(nil)
	if page.Searching() {
		t.Error("expected not searching initially")
	}
	page.searching = true
	if !page.Searching() {
		t.Error("expected searching after setting flag")
	}
}

func TestSessionsPage_View_Searching(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "test", Status: "running"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions:  sessions,
		filtered:  sessions,
		filter:    "all",
		searching: true,
		search:    "test",
		width:     80,
		height:    24,
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view in search mode")
	}
}
