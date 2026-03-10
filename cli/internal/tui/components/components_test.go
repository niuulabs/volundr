package components

import (
	"testing"

	tui "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/remote"
)

// --- StatusBadge tests ---

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

// --- MetricCard tests ---

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

func TestMetricRow_Empty(t *testing.T) {
	view := MetricRow(nil)
	// Should not panic.
	_ = view
}

// --- Header tests ---

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

// --- Tabs tests ---

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

func TestTabs_View_Empty(t *testing.T) {
	tabs := Tabs{Width: 80}
	view := tabs.View()
	_ = view // should not panic
}

// --- Sidebar tests ---

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

// --- Modal tests ---

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

// --- HelpOverlay tests ---

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

// --- helper for tests ---

func configWithContexts() *tui.ClientPool {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.com",
		Token:  "tok",
	}
	return tui.NewClientPool(cfg)
}
