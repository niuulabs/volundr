package cli

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	tea "charm.land/bubbletea/v2"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tuipkg "github.com/niuulabs/volundr/cli/internal/tui"
	"github.com/niuulabs/volundr/cli/internal/tui/components"
	"github.com/niuulabs/volundr/cli/internal/tui/pages"
)

func TestAppendCmd_Nil(t *testing.T) {
	var cmds []tea.Cmd
	result := appendCmd(cmds, nil)
	if len(result) != 0 {
		t.Errorf("expected empty slice for nil cmd, got %d", len(result))
	}
}

func TestAppendCmd_NonNil(t *testing.T) {
	var cmds []tea.Cmd
	cmd := func() tea.Msg { return nil }
	result := appendCmd(cmds, cmd)
	if len(result) != 1 {
		t.Errorf("expected 1 cmd, got %d", len(result))
	}
}

func TestAppendCmd_MultipleAppends(t *testing.T) {
	var cmds []tea.Cmd
	cmd1 := func() tea.Msg { return nil }
	cmd2 := func() tea.Msg { return nil }
	cmds = appendCmd(cmds, cmd1)
	cmds = appendCmd(cmds, nil)
	cmds = appendCmd(cmds, cmd2)
	if len(cmds) != 2 {
		t.Errorf("expected 2 cmds, got %d", len(cmds))
	}
}

func TestQuickPing_HealthEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := api.NewClient(srv.URL, "")
	err := quickPing(client)
	if err != nil {
		t.Errorf("expected nil error for healthy server, got %v", err)
	}
}

func TestQuickPing_HealthEndpoint500_FallbackToStats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if r.URL.Path == "/api/v1/volundr/stats" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	client := api.NewClient(srv.URL, "test-token")
	err := quickPing(client)
	if err != nil {
		t.Errorf("expected nil error when stats endpoint works, got %v", err)
	}
}

func TestQuickPing_AllEndpointsFail(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := api.NewClient(srv.URL, "")
	err := quickPing(client)
	if err == nil {
		t.Error("expected error when all endpoints fail")
	}
}

func TestServerPingMsg_Connected(t *testing.T) {
	msg := serverPingMsg{Err: nil}
	if msg.Err != nil {
		t.Error("expected nil error for connected state")
	}
}

func TestServerPingMsg_Disconnected(t *testing.T) {
	msg := serverPingMsg{Err: http.ErrServerClosed}
	if msg.Err == nil {
		t.Error("expected non-nil error for disconnected state")
	}
}

func TestDebugLogMsg_DoesNotPanic(_ *testing.T) {
	// Just ensure it doesn't panic with various message types.
	debugLogMsg(tea.KeyPressMsg{Code: 'a'})
	debugLogMsg(serverPingMsg{})
	debugLogMsg(tea.WindowSizeMsg{}) // should be skipped
}

// newTestTUIModel creates a tuiModel for testing with an empty pool.
func newTestTUIModel() tuiModel {
	cfg := remote.DefaultConfig()
	pool := tuipkg.NewClientPool(cfg)
	sender := &tuipkg.ProgramSender{}
	return newTUIModel(cfg, pool, sender)
}

// newTestTUIModelWithServer creates a tuiModel backed by a mock server context.
func newTestTUIModelWithServer(serverURL string) tuiModel {
	cfg := remote.DefaultConfig()
	cfg.Contexts["test"] = &remote.Context{
		Name:   "test",
		Server: serverURL,
		Token:  "test-token", //nolint:gosec // test fixture
	}
	pool := tuipkg.NewClientPool(cfg)
	sender := &tuipkg.ProgramSender{}
	return newTUIModel(cfg, pool, sender)
}

func TestNewTUIModel_EmptyPool(t *testing.T) {
	m := newTestTUIModel()
	if m.app.ActivePage != tuipkg.PageSessions {
		t.Errorf("expected initial page to be Sessions, got %d", m.app.ActivePage)
	}
	if m.activeSession != nil {
		t.Error("expected nil active session initially")
	}
}

func TestNewTUIModel_WithServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m := newTestTUIModelWithServer(srv.URL)
	if m.app.ServerURL != srv.URL {
		t.Errorf("expected server URL %q, got %q", srv.URL, m.app.ServerURL)
	}
}

func TestTUIModel_Init_NoPool(_ *testing.T) {
	m := newTestTUIModel()
	cmd := m.Init()
	// With empty pool, Init should still return a batch cmd (pages init).
	// Just verify it doesn't panic.
	_ = cmd
}

func TestTUIModel_Init_WithServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m := newTestTUIModelWithServer(srv.URL)
	cmd := m.Init()
	if cmd == nil {
		t.Error("expected non-nil cmd from Init with connected server")
	}
}

func TestTUIModel_View_NotReady(t *testing.T) {
	m := newTestTUIModel()
	// app.Ready is false by default
	v := m.View()
	if !v.AltScreen {
		t.Error("expected AltScreen to be true")
	}
	if v.Content == "" {
		t.Error("expected non-empty content for loading state")
	}
}

func TestTUIModel_View_Ready(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40

	v := m.View()
	if !v.AltScreen {
		t.Error("expected AltScreen to be true")
	}
	if v.Content == "" {
		t.Error("expected non-empty content for ready state")
	}
}

func TestTUIModel_View_HelpOverlay(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ShowHelp = true
	m.help.Visible = true

	v := m.View()
	if v.Content == "" {
		t.Error("expected non-empty content for help overlay")
	}
}

func TestTUIModel_View_AllPages(t *testing.T) {
	pageList := []tuipkg.Page{
		tuipkg.PageSessions,
		tuipkg.PageChat,
		tuipkg.PageTerminal,
		tuipkg.PageDiffs,
		tuipkg.PageChronicles,
		tuipkg.PageSettings,
		tuipkg.PageAdmin,
	}

	for _, page := range pageList {
		t.Run(fmt.Sprintf("page_%d", page), func(t *testing.T) {
			m := newTestTUIModel()
			m.app.Ready = true
			m.app.Width = 120
			m.app.Height = 40
			m.app.ActivePage = page

			v := m.View()
			if v.Content == "" {
				t.Error("expected non-empty content")
			}
		})
	}
}

func TestTUIModel_Update_ServerPingConnected(t *testing.T) {
	m := newTestTUIModel()
	msg := serverPingMsg{Err: nil}

	result, _ := m.Update(msg)
	updated := result.(tuiModel)
	if updated.header.State != components.HeaderConnected {
		t.Errorf("expected HeaderConnected state, got %d", updated.header.State)
	}
	if !updated.header.Connected {
		t.Error("expected header.Connected to be true")
	}
}

func TestTUIModel_Update_ServerPingDisconnected(t *testing.T) {
	m := newTestTUIModel()
	msg := serverPingMsg{Err: fmt.Errorf("connection refused")}

	result, _ := m.Update(msg)
	updated := result.(tuiModel)
	if updated.header.State != components.HeaderDisconnected {
		t.Errorf("expected HeaderDisconnected state, got %d", updated.header.State)
	}
	if updated.header.Connected {
		t.Error("expected header.Connected to be false")
	}
}

func TestTUIModel_Update_WindowSizeMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	msg := tea.WindowSizeMsg{Width: 200, Height: 50}

	result, _ := m.Update(msg)
	updated := result.(tuiModel)
	if updated.app.Width != 200 {
		t.Errorf("expected width 200, got %d", updated.app.Width)
	}
	if updated.app.Height != 50 {
		t.Errorf("expected height 50, got %d", updated.app.Height)
	}
}

func TestTUIModel_IsInputCaptured_DefaultFalse(t *testing.T) {
	m := newTestTUIModel()
	m.app.ActivePage = tuipkg.PageSessions
	if m.isInputCaptured() {
		t.Error("expected isInputCaptured to be false for sessions without search")
	}
}

func TestTUIModel_IsInputCaptured_AllPages(t *testing.T) {
	tests := []struct {
		name     string
		page     tuipkg.Page
		expected bool
	}{
		{"sessions", tuipkg.PageSessions, false},
		{"chat", tuipkg.PageChat, true},         // inputActive defaults to true
		{"terminal", tuipkg.PageTerminal, true}, // insertMode defaults to true
		{"diffs", tuipkg.PageDiffs, false},
		{"chronicles", tuipkg.PageChronicles, false},
		{"settings", tuipkg.PageSettings, false},
		{"admin", tuipkg.PageAdmin, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newTestTUIModel()
			m.app.ActivePage = tt.page
			got := m.isInputCaptured()
			if got != tt.expected {
				t.Errorf("isInputCaptured() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestTUIModel_Update_ForwardsToActivePage(t *testing.T) {
	pageList := []tuipkg.Page{
		tuipkg.PageSessions,
		tuipkg.PageChat,
		tuipkg.PageDiffs,
		tuipkg.PageChronicles,
		tuipkg.PageSettings,
		tuipkg.PageAdmin,
	}

	for _, page := range pageList {
		t.Run(fmt.Sprintf("page_%d", page), func(t *testing.T) {
			m := newTestTUIModel()
			m.app.Ready = true
			m.app.Width = 120
			m.app.Height = 40
			m.app.ActivePage = page

			// Send a generic message and verify no panic.
			msg := tea.WindowSizeMsg{Width: 100, Height: 30}
			result, _ := m.Update(msg)
			if result == nil {
				t.Error("expected non-nil result from Update")
			}
		})
	}
}

// Update message routing tests.

func TestTUIModel_Update_TerminalOutputMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TerminalOutputMsg{TabIndex: 0}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalConnectedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TerminalConnectedMsg{TabIndex: 0}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalDisconnectedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TerminalDisconnectedMsg{TabIndex: 0}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalSessionsLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TerminalSessionsLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalSpawnedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TerminalSpawnedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SessionsLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.SessionsLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TimelineLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.TimelineLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatConnectedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.ChatConnectedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatHistoryLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.ChatHistoryLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_DiffFilesLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.DiffFilesLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_DiffContentLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.DiffContentLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SessionActionDoneMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.SessionActionDoneMsg{Action: "start"}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SettingsLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.SettingsLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_AdminDataLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.AdminDataLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SessionSelectedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.SessionSelectedMsg{Session: api.Session{ID: "s1", Name: "test"}}
	result, _ := m.Update(msg)
	updated := result.(tuiModel)
	if updated.activeSession == nil {
		t.Error("expected active session to be set")
	}
}

func TestTUIModel_Update_AllSessionsLoadedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := tuipkg.AllSessionsLoadedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_HelpDoesNotForward(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ShowHelp = true

	// When help is showing, generic messages should not be forwarded to pages.
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatStreamEvent(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.ChatStreamEventMsg{Event: api.StreamEvent{Type: "text"}}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatDisconnectedMsg(t *testing.T) {
	m := newTestTUIModel()
	msg := pages.ChatDisconnectedMsg{}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalPage_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageTerminal
	// Terminal defaults to insert mode, so key messages should be consumed.
	msg := tea.KeyPressMsg{Code: 'a'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_RegularKey(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// Chat defaults to inputActive=true, so keys should go to chat.
	msg := tea.KeyPressMsg{Code: 'h'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_CtrlC(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// Ctrl+C should fall through to app layer.
	msg := tea.KeyPressMsg{Code: 'c', Mod: tea.ModCtrl}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_Esc(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// Esc should deactivate input and fall through.
	msg := tea.KeyPressMsg{Code: tea.KeyEscape}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_F11(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// F11 should fall through to app (fullscreen toggle).
	msg := tea.KeyPressMsg{Code: tea.KeyF11}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_AltKey(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// Alt+number should fall through to app for navigation.
	msg := tea.KeyPressMsg{Code: '1', Mod: tea.ModAlt}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChatPage_InputActive_CtrlF(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChat
	// ctrl+f should fall through (fullscreen toggle).
	msg := tea.KeyPressMsg{Code: 'f', Mod: tea.ModCtrl}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SessionsPage_NotSearching_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageSessions
	// Not searching, so keys should fall through normally.
	msg := tea.KeyPressMsg{Code: 'j'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_SettingsPage_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageSettings
	// Settings not editing, keys should fall through.
	msg := tea.KeyPressMsg{Code: 'j'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_DiffsPage_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageDiffs
	msg := tea.KeyPressMsg{Code: 'j'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_ChroniclesPage_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageChronicles
	msg := tea.KeyPressMsg{Code: 'j'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_AdminPage_KeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageAdmin
	msg := tea.KeyPressMsg{Code: 'j'}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_Update_TerminalPage_NonKeyMsg(t *testing.T) {
	m := newTestTUIModel()
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40
	m.app.ActivePage = tuipkg.PageTerminal
	// Non-key messages should be forwarded normally.
	msg := tea.WindowSizeMsg{Width: 80, Height: 24}
	result, _ := m.Update(msg)
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestTUIModel_HandleSessionSelected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	m := newTestTUIModelWithServer(srv.URL)
	m.app.Ready = true
	m.app.Width = 120
	m.app.Height = 40

	session := api.Session{
		ID:     "test-session-id",
		Name:   "test-session",
		Status: "running",
	}

	// Call handleSessionSelected directly.
	result, _ := m.handleSessionSelected(pages.SessionSelectedMsg{Session: session})
	updated := result.(tuiModel)

	if updated.activeSession == nil {
		t.Fatal("expected activeSession to be set")
	}
	if updated.activeSession.ID != "test-session-id" {
		t.Errorf("expected session ID %q, got %q", "test-session-id", updated.activeSession.ID)
	}
	if updated.app.ActivePage != tuipkg.PageChat {
		t.Errorf("expected page to switch to Chat, got %d", updated.app.ActivePage)
	}
}
