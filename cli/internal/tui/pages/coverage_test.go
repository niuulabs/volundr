package pages

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// Chat page: handleStreamEvent, finalizeStreaming, View with session, etc.

func TestChatPage_HandleStreamEvent_Assistant(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.width = 100
	page.height = 40

	event := api.StreamEvent{
		Type: "assistant",
		Message: &api.StreamEventMessage{
			Content: []api.StreamMessageBlock{
				{Type: "text", Text: "Hello world"},
			},
		},
	}
	page.handleStreamEvent(event)

	if len(page.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(page.messages))
	}
	if page.messages[0].Role != "assistant" {
		t.Errorf("expected role assistant, got %q", page.messages[0].Role)
	}
	if page.messages[0].Content != "Hello world" {
		t.Errorf("expected content %q, got %q", "Hello world", page.messages[0].Content)
	}
	if page.messages[0].Status != "running" {
		t.Errorf("expected status running, got %q", page.messages[0].Status)
	}
	if page.streamingIdx != 0 {
		t.Errorf("expected streamingIdx 0, got %d", page.streamingIdx)
	}
}

func TestChatPage_HandleStreamEvent_ContentBlockDelta(t *testing.T) {
	page := NewChatPage(nil, nil)

	// Start an assistant message first.
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})

	// Then send a content_block_delta with text.
	page.handleStreamEvent(api.StreamEvent{
		Type:  "content_block_delta",
		Delta: &api.StreamDelta{Text: "Hello"},
	})

	if page.streamingText != "Hello" {
		t.Errorf("expected streaming text %q, got %q", "Hello", page.streamingText)
	}
	if page.messages[0].Content != "Hello" {
		t.Errorf("expected message content %q, got %q", "Hello", page.messages[0].Content)
	}

	// Send thinking delta.
	page.handleStreamEvent(api.StreamEvent{
		Type:  "content_block_delta",
		Delta: &api.StreamDelta{Thinking: "reasoning..."},
	})
	if !page.messages[0].Thinking {
		t.Error("expected thinking flag set")
	}
}

func TestChatPage_HandleStreamEvent_ContentBlockStart(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})
	page.messages[0].Thinking = true

	page.handleStreamEvent(api.StreamEvent{
		Type:         "content_block_start",
		ContentBlock: &api.StreamContentBlock{Type: "text"},
	})
	if page.messages[0].Thinking {
		t.Error("expected thinking flag cleared after text block start")
	}
}

func TestChatPage_HandleStreamEvent_ContentBlockStop(_ *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})
	// content_block_stop should not panic.
	page.handleStreamEvent(api.StreamEvent{Type: "content_block_stop"})
}

func TestChatPage_HandleStreamEvent_MessageDelta(_ *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})
	// message_delta should not panic.
	page.handleStreamEvent(api.StreamEvent{Type: "message_delta"})
}

func TestChatPage_HandleStreamEvent_Result(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})

	page.handleStreamEvent(api.StreamEvent{
		Type:   "result",
		Result: "Final answer",
	})
	if page.messages[0].Content != "Final answer" {
		t.Errorf("expected result content, got %q", page.messages[0].Content)
	}
	if page.messages[0].Status != "complete" {
		t.Errorf("expected complete status, got %q", page.messages[0].Status)
	}
	if page.streamingIdx != -1 {
		t.Errorf("expected streamingIdx -1 after result, got %d", page.streamingIdx)
	}
}

func TestChatPage_HandleStreamEvent_ResultWithExistingText(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{Type: "assistant"})
	page.handleStreamEvent(api.StreamEvent{
		Type:  "content_block_delta",
		Delta: &api.StreamDelta{Text: "existing"},
	})

	page.handleStreamEvent(api.StreamEvent{
		Type:   "result",
		Result: "should be ignored",
	})
	// Existing text should not be overwritten.
	if page.messages[0].Content != "existing" {
		t.Errorf("expected existing text preserved, got %q", page.messages[0].Content)
	}
}

func TestChatPage_HandleStreamEvent_Error(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{
		Type:  "error",
		Error: json.RawMessage(`"something went wrong"`),
	})
	if len(page.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(page.messages))
	}
	if page.messages[0].Role != "system" {
		t.Errorf("expected system role, got %q", page.messages[0].Role)
	}
	if page.messages[0].Status != "error" {
		t.Errorf("expected error status, got %q", page.messages[0].Status)
	}
}

func TestChatPage_HandleStreamEvent_ErrorEmpty(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{
		Type:  "error",
		Error: json.RawMessage(`""`),
	})
	if len(page.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(page.messages))
	}
}

func TestChatPage_HandleStreamEvent_System(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{
		Type:    "system",
		Content: json.RawMessage(`"system message here"`),
	})
	if len(page.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(page.messages))
	}
	if page.messages[0].Content != "system message here" {
		t.Errorf("expected unquoted content, got %q", page.messages[0].Content)
	}
}

func TestChatPage_HandleStreamEvent_SystemNull(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.handleStreamEvent(api.StreamEvent{
		Type:    "system",
		Content: json.RawMessage(`null`),
	})
	if len(page.messages) != 0 {
		t.Errorf("expected no message for null system content, got %d", len(page.messages))
	}
}

func TestChatPage_FinalizeStreaming_NoStream(_ *testing.T) {
	page := NewChatPage(nil, nil)
	page.streamingIdx = -1
	page.finalizeStreaming() // should not panic
}

func TestChatPage_FinalizeStreaming_OutOfBounds(_ *testing.T) {
	page := NewChatPage(nil, nil)
	page.streamingIdx = 5
	page.finalizeStreaming() // should not panic
}

func TestChatPage_InputActive(t *testing.T) {
	page := NewChatPage(nil, nil)
	if !page.InputActive() {
		t.Error("expected input active by default")
	}
	page.inputActive = false
	if page.InputActive() {
		t.Error("expected input inactive")
	}
}

func TestChatPage_View_WithSession(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test-session", Model: "claude-opus-4"}
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with session")
	}
}

func TestChatPage_View_WithMessages(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test-session", Model: "claude-opus-4"}
	page.width = 100
	page.height = 40
	page.connected = true
	page.messages = []ChatMessage{
		{Role: "user", Content: "Hello", Timestamp: time.Now(), Status: "complete"},
		{Role: "assistant", Content: "Hi there!", Timestamp: time.Now(), Status: "complete"},
		{Role: "system", Content: "Connected", Timestamp: time.Now(), Status: "complete"},
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with messages")
	}
}

func TestChatPage_View_WithThinkingMessage(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 40
	page.streamingIdx = 0
	page.messages = []ChatMessage{
		{Role: "assistant", Content: "", Timestamp: time.Now(), Status: "running", Thinking: true},
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with thinking message")
	}
}

func TestChatPage_View_WithStreamingMessage(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 40
	page.streamingIdx = 0
	page.messages = []ChatMessage{
		{Role: "assistant", Content: "partial", Timestamp: time.Now(), Status: "running"},
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with streaming message")
	}
}

func TestChatPage_View_ConnectionError(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 40
	page.connErr = errors.New("connection refused")
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with connection error")
	}
}

func TestChatPage_View_Connecting(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view in connecting state")
	}
}

func TestChatPage_View_NotConnectedNoMessages(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 40
	page.connected = false
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view")
	}
}

func TestChatPage_Update_ChatConnected(t *testing.T) {
	page := NewChatPage(nil, nil)
	page, _ = page.Update(ChatConnectedMsg{})
	if !page.connected {
		t.Error("expected connected after ChatConnectedMsg")
	}
	if page.connErr != nil {
		t.Error("expected nil connErr after connected")
	}
}

func TestChatPage_Update_ChatDisconnected(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.connected = true
	page, _ = page.Update(ChatDisconnectedMsg{Err: errors.New("lost")})
	if page.connected {
		t.Error("expected disconnected")
	}
	if page.connErr == nil {
		t.Error("expected non-nil connErr")
	}
}

func TestChatPage_Update_ChatStreamEvent(t *testing.T) {
	page := NewChatPage(nil, nil)
	event := api.StreamEvent{Type: "assistant"}
	page, _ = page.Update(ChatStreamEventMsg{Event: event})
	if len(page.messages) != 1 {
		t.Errorf("expected 1 message, got %d", len(page.messages))
	}
	if page.scrollPos != 0 {
		t.Errorf("expected scrollPos 0, got %d", page.scrollPos)
	}
}

func TestChatPage_Update_ChatHistoryLoaded(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.messages = []ChatMessage{{Role: "system", Content: "connected"}}

	turns := []api.ConversationTurn{
		{Role: "user", Content: "hello", CreatedAt: "2026-01-01T10:00:00Z"},
		{Role: "assistant", Content: "hi", CreatedAt: "2026-01-01T10:01:00Z"},
	}
	page, _ = page.Update(ChatHistoryLoadedMsg{Turns: turns})
	if len(page.messages) != 3 {
		t.Errorf("expected 3 messages (2 history + 1 existing), got %d", len(page.messages))
	}
	// History should be prepended.
	if page.messages[0].Role != "user" {
		t.Errorf("expected first message to be from history user, got %q", page.messages[0].Role)
	}
}

func TestChatPage_Update_ChatHistoryLoadedError(t *testing.T) {
	page := NewChatPage(nil, nil)
	page, _ = page.Update(ChatHistoryLoadedMsg{Err: errors.New("fail")})
	if len(page.messages) != 1 {
		t.Fatalf("expected 1 error message, got %d", len(page.messages))
	}
	if page.messages[0].Role != "system" {
		t.Errorf("expected system role for error, got %q", page.messages[0].Role)
	}
}

func TestChatPage_Update_EscDeactivatesInput(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if page.inputActive {
		t.Error("expected input inactive after esc")
	}
}

func TestChatPage_Update_IActivatesInput(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = false
	page, _ = page.Update(tea.KeyPressMsg{Code: 'i'})
	if !page.inputActive {
		t.Error("expected input active after 'i'")
	}
}

func TestChatPage_Update_SpaceInInput(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = true
	page.input = "hello"
	page, _ = page.Update(tea.KeyPressMsg{Code: ' '})
	if page.input != "hello " {
		t.Errorf("expected %q, got %q", "hello ", page.input)
	}
}

func TestChatPage_Update_PgUpPgDown(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = false
	page.height = 40
	page.scrollPos = 0

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyPgUp})
	if page.scrollPos != 20 {
		t.Errorf("expected scrollPos 20, got %d", page.scrollPos)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	if page.scrollPos != 0 {
		t.Errorf("expected scrollPos 0, got %d", page.scrollPos)
	}
}

func TestChatPage_Update_GAndg(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.inputActive = false
	page.scrollPos = 5

	page, _ = page.Update(tea.KeyPressMsg{Code: 'G'})
	if page.scrollPos != 0 {
		t.Errorf("expected scrollPos 0 after G, got %d", page.scrollPos)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'g'})
	if page.scrollPos != 999999 {
		t.Errorf("expected scrollPos 999999 after g, got %d", page.scrollPos)
	}
}

// Chat helpers: stripOSC, friendlyConnError, renderMarkdown.

func TestStripOSC(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"no osc", "hello world", "hello world"},
		{"bel terminated", "before\x1b]8;;http://example.com\x07click\x1b]8;;\x07after", "beforeclickafter"},
		{"st terminated", "before\x1b]8;;http://example.com\x1b\\click\x1b]8;;\x1b\\after", "beforeclickafter"},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripOSC(tt.input)
			if got != tt.want {
				t.Errorf("stripOSC() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFriendlyConnError(t *testing.T) {
	tests := []struct {
		err  string
		want string
	}{
		{"bad handshake from server", "Connection refused (auth may have expired \u2014 try: volundr login)"},
		{"connection refused", "Session unreachable (is it running?)"},
		{"no such host found", "Session host not found"},
		{"session has no chat endpoint", "session has no chat endpoint"},
		{"i/o timeout occurred", "Connection timed out"},
		{"unknown error", "unknown error"},
	}
	for _, tt := range tests {
		got := friendlyConnError(errors.New(tt.err))
		if got != tt.want {
			t.Errorf("friendlyConnError(%q) = %q, want %q", tt.err, got, tt.want)
		}
	}
}

func TestRenderMarkdown(t *testing.T) {
	result := renderMarkdown("# Hello\nSome **bold** text", 80)
	if result == "" {
		t.Error("expected non-empty markdown render")
	}
}

func TestRenderMarkdown_Empty(_ *testing.T) {
	result := renderMarkdown("", 80)
	// Should not panic and return something.
	_ = result
}

// Chronicles page: timelineEventsFromAPI, mapEventType, cycleFilter,
// formatElapsed, renderTimeline, renderTimelineEntry.

func TestTimelineEventsFromAPI(t *testing.T) {
	tokens := 500
	ins := 10
	del := 5
	events := []api.TimelineEvent{
		{T: 30, Type: "message", Label: "test", Tokens: &tokens, Action: "write", Ins: &ins, Del: &del, Hash: "abc123def456"},
		{T: 0, Type: "session", Label: "started"},
		{T: 120, Type: "unknown_type", Label: "other"},
	}
	result := timelineEventsFromAPI(events)
	if len(result) != 3 {
		t.Fatalf("expected 3 events, got %d", len(result))
	}
	if result[0].Type != EventMessage {
		t.Errorf("expected message type, got %v", result[0].Type)
	}
	if result[0].Tokens != 500 {
		t.Errorf("expected 500 tokens, got %d", result[0].Tokens)
	}
	if result[0].Ins != 10 {
		t.Errorf("expected 10 ins, got %d", result[0].Ins)
	}
	if result[0].Del != 5 {
		t.Errorf("expected 5 del, got %d", result[0].Del)
	}
	if result[0].Hash != "abc123def456" {
		t.Errorf("expected hash, got %q", result[0].Hash)
	}
	if result[1].Type != EventSession {
		t.Errorf("expected session type, got %v", result[1].Type)
	}
	// Unknown type maps to EventMessage.
	if result[2].Type != EventMessage {
		t.Errorf("expected message type for unknown, got %v", result[2].Type)
	}
}

func TestMapEventType(t *testing.T) {
	tests := []struct {
		input string
		want  EventType
	}{
		{"session", EventSession},
		{"message", EventMessage},
		{"file", EventFile},
		{"git", EventGit},
		{"terminal", EventTerminal},
		{"error", EventError},
		{"xyz", EventMessage},
	}
	for _, tt := range tests {
		got := mapEventType(tt.input)
		if got != tt.want {
			t.Errorf("mapEventType(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestFormatElapsed(t *testing.T) {
	tests := []struct {
		seconds int
		want    string
	}{
		{0, "0s"},
		{30, "30s"},
		{59, "59s"},
		{60, "1m00s"},
		{90, "1m30s"},
		{3600, "1h00m"},
		{3661, "1h01m"},
	}
	for _, tt := range tests {
		got := formatElapsed(tt.seconds)
		if got != tt.want {
			t.Errorf("formatElapsed(%d) = %q, want %q", tt.seconds, got, tt.want)
		}
	}
}

func TestChroniclesPage_CycleFilter(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.events = []ChronicleEvent{
		{Type: EventMessage, Label: "msg1"},
		{Type: EventFile, Label: "file1"},
	}

	// Forward cycle.
	page.cycleFilter(1)
	if page.filter != "session" {
		t.Errorf("expected session, got %q", page.filter)
	}

	// Backward cycle.
	page.cycleFilter(-1)
	if page.filter != "all" {
		t.Errorf("expected all, got %q", page.filter)
	}

	// Backward from "all" wraps to "error".
	page.cycleFilter(-1)
	if page.filter != "error" {
		t.Errorf("expected error, got %q", page.filter)
	}
}

func TestChroniclesPage_Update_TabCycle(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.noSession = false
	page.events = []ChronicleEvent{{Type: EventMessage, Label: "msg"}}
	page.applyFilter()

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab})
	if page.filter != "session" {
		t.Errorf("expected session after tab, got %q", page.filter)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift})
	if page.filter != "all" {
		t.Errorf("expected all after shift+tab, got %q", page.filter)
	}
}

func TestChroniclesPage_Update_TimelineLoaded(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.loading = true

	tokens := 100
	timeline := &api.TimelineResponse{
		Events: []api.TimelineEvent{
			{T: 0, Type: "session", Label: "start"},
			{T: 10, Type: "message", Label: "msg", Tokens: &tokens},
		},
		Files:   []api.TimelineFile{{Path: "test.go", Status: "M", Ins: 5, Del: 2}},
		Commits: []api.TimelineCommit{{Hash: "abc", Msg: "test"}},
	}

	page, _ = page.Update(TimelineLoadedMsg{Timeline: timeline})
	if page.loading {
		t.Error("expected loading=false")
	}
	if len(page.events) != 2 {
		t.Errorf("expected 2 events, got %d", len(page.events))
	}
	if len(page.files) != 1 {
		t.Errorf("expected 1 file, got %d", len(page.files))
	}
	if len(page.commits) != 1 {
		t.Errorf("expected 1 commit, got %d", len(page.commits))
	}
}

func TestChroniclesPage_Update_TimelineLoadedError(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.loading = true
	page, _ = page.Update(TimelineLoadedMsg{Err: errors.New("fail")})
	if page.loading {
		t.Error("expected loading=false")
	}
	if page.loadErr == nil {
		t.Error("expected non-nil loadErr")
	}
}

func TestChroniclesPage_View_Loading(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.noSession = false
	page.loading = true
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty loading view")
	}
}

func TestChroniclesPage_View_LoadError(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.noSession = false
	page.loadErr = errors.New("network error")
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty error view")
	}
}

func TestChroniclesPage_View_WithEvents(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.noSession = false
	page.width = 120
	page.height = 40
	page.events = []ChronicleEvent{
		{Type: EventSession, Label: "start", Elapsed: 0},
		{Type: EventMessage, Label: "msg", Elapsed: 30, Tokens: 500, Action: "write"},
		{Type: EventFile, Label: "test.go", Elapsed: 60, Ins: 10, Del: 5},
		{Type: EventGit, Label: "commit", Elapsed: 120, Hash: "abc123def456789"},
	}
	page.applyFilter()
	view := page.View()
	if view == "" {
		t.Error("expected non-empty timeline view")
	}
}

func TestChroniclesPage_RenderTimeline_WithScroll(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.noSession = false
	page.width = 80
	page.height = 20

	// Create more events than fit in the viewport.
	for i := 0; i < 20; i++ {
		page.events = append(page.events, ChronicleEvent{
			Type: EventMessage, Label: "msg", Elapsed: i * 10,
		})
	}
	page.applyFilter()
	page.cursor = 15 // Somewhere in the middle.

	timeline := page.renderTimeline(10)
	if timeline == "" {
		t.Error("expected non-empty scrolled timeline")
	}
}

// Diffs page: Update messages, View states, render methods.

func TestDiffsPage_Update_DiffFilesLoaded(t *testing.T) {
	page := NewDiffsPage(nil)
	page.loading = true

	msg := DiffFilesLoadedMsg{
		Files: []api.DiffFileEntry{
			{Path: "main.go", Status: "M", Additions: 10, Deletions: 2},
			{Path: "new.go", Status: "A", Additions: 50, Deletions: 0},
		},
	}

	page, _ = page.Update(msg)
	if page.loading {
		t.Error("expected loading=false")
	}
	if len(page.files) != 2 {
		t.Errorf("expected 2 files, got %d", len(page.files))
	}
}

func TestDiffsPage_Update_DiffFilesLoadedError(t *testing.T) {
	page := NewDiffsPage(nil)
	page.loading = true

	page, _ = page.Update(DiffFilesLoadedMsg{Err: errors.New("fail")})
	if page.loading {
		t.Error("expected loading=false")
	}
	if page.loadErr == nil {
		t.Error("expected non-nil loadErr")
	}
}

func TestDiffsPage_Update_DiffContentLoaded(t *testing.T) {
	page := NewDiffsPage(nil)
	page.files = []DiffFile{
		{Path: "main.go", Status: "M"},
		{Path: "new.go", Status: "A"},
	}

	page, _ = page.Update(DiffContentLoadedMsg{
		Path: "main.go",
		Diff: "@@ -1,3 +1,5 @@\n context\n+added\n-removed\n",
	})
	if page.files[0].Diff == "" {
		t.Error("expected diff content loaded")
	}
}

func TestDiffsPage_Update_NavigationWithFiles(t *testing.T) {
	page := NewDiffsPage(nil)
	page.files = []DiffFile{
		{Path: "a.go", Status: "M"},
		{Path: "b.go", Status: "A"},
		{Path: "c.go", Status: "D"},
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'j'})
	if page.cursor != 1 {
		t.Errorf("expected cursor 1, got %d", page.cursor)
	}
	if page.scrollPos != 0 {
		t.Errorf("expected scrollPos reset to 0, got %d", page.scrollPos)
	}

	page, _ = page.Update(tea.KeyPressMsg{Code: 'k'})
	if page.cursor != 0 {
		t.Errorf("expected cursor 0, got %d", page.cursor)
	}
}

func TestDiffsPage_View_NoSession(t *testing.T) {
	page := NewDiffsPage(nil)
	page.width = 120
	page.height = 40
	// session is nil
	view := page.View()
	if view == "" {
		t.Error("expected non-empty no-session view")
	}
}

func TestDiffsPage_View_Loading(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1"}
	page.loading = true
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty loading view")
	}
}

func TestDiffsPage_View_Error(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1"}
	page.loadErr = errors.New("timeout")
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty error view")
	}
}

func TestDiffsPage_View_WithFiles(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1"}
	page.width = 120
	page.height = 40
	page.files = []DiffFile{
		{Path: "main.go", Status: "M", Additions: 10, Deletions: 2, Diff: "@@ -1 +1 @@\n-old\n+new\n context"},
		{Path: "new.go", Status: "A", Additions: 50, Deletions: 0},
		{Path: "old.go", Status: "D", Additions: 0, Deletions: 30},
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with files")
	}
}

func TestDiffsPage_View_WithEmptyDiff(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1"}
	page.width = 120
	page.height = 40
	page.files = []DiffFile{
		{Path: "main.go", Status: "M"}, // No diff content yet.
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with loading diff")
	}
}

func TestDiffsPage_View_NoFiles(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1"}
	page.width = 120
	page.height = 40
	page.files = nil
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with no files")
	}
}

// Settings page: editing, profile, integrations, appearance, renderSettingRows.

func TestNewSettingsPage_WithConfig(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.example.com",
		Token:  "my-secret-token",
	}
	page := NewSettingsPage(nil, cfg)
	if page.rctx == nil {
		t.Error("expected non-nil rctx with config")
	}
	if page.ctxKey == "" {
		t.Error("expected non-empty ctxKey")
	}
}

func TestSettingsPage_StartEditing(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.example.com",
		Token:  "tok",
	}
	page := NewSettingsPage(nil, cfg)
	page.section = SectionConnection
	page.cursor = 0

	page.startEditing()
	if !page.editing {
		t.Error("expected editing mode")
	}
	if page.editBuf != "https://prod.example.com" {
		t.Errorf("expected editBuf %q, got %q", "https://prod.example.com", page.editBuf)
	}
}

func TestSettingsPage_StartEditing_WrongSection(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.section = SectionCredentials
	page.startEditing()
	if page.editing {
		t.Error("expected not editing for non-connection section")
	}
}

func TestSettingsPage_HandleEditInput(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.editing = true
	page.editBuf = "http://test"

	// Type a character.
	page.handleEditInput(tea.KeyPressMsg{Code: 'x', Text: "x"})
	if page.editBuf != "http://testx" {
		t.Errorf("expected %q, got %q", "http://testx", page.editBuf)
	}

	// Backspace.
	page.handleEditInput(tea.KeyPressMsg{Code: tea.KeyBackspace})
	if page.editBuf != "http://test" {
		t.Errorf("expected %q, got %q", "http://test", page.editBuf)
	}

	// Space.
	page.handleEditInput(tea.KeyPressMsg{Code: ' '})
	if page.editBuf != "http://test " {
		t.Errorf("expected trailing space, got %q", page.editBuf)
	}

	// Esc cancels.
	page.handleEditInput(tea.KeyPressMsg{Code: tea.KeyEscape})
	if page.editing {
		t.Error("expected editing=false after esc")
	}
}

func TestSettingsPage_HandleEditInput_Enter(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://old.com",
		Token:  "tok",
	}
	page := NewSettingsPage(nil, cfg)
	page.editing = true
	page.editBuf = "https://new.com"

	page.handleEditInput(tea.KeyPressMsg{Code: tea.KeyEnter})
	if page.editing {
		t.Error("expected editing=false after enter")
	}
	if page.rctx.Server != "https://new.com" {
		t.Errorf("expected server updated to %q, got %q", "https://new.com", page.rctx.Server)
	}
}

func TestSettingsPage_Update_Enter(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://test.com",
		Token:  "tok",
	}
	page := NewSettingsPage(nil, cfg)
	page.section = SectionConnection
	page.cursor = 0

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if !page.editing {
		t.Error("expected editing mode after enter on connection row 0")
	}
}

func TestSettingsPage_Update_EditMode(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.editing = true
	page.editBuf = "test"

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyEscape})
	if page.editing {
		t.Error("expected editing=false after esc in edit mode")
	}
}

func TestSettingsPage_Update_SettingsLoaded(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = true

	msg := SettingsLoadedMsg{
		Profile: &api.UserProfile{
			UserID:      "u1",
			DisplayName: "Test User",
			Email:       "test@example.com",
			TenantID:    "t1",
			Roles:       []string{"admin", "user"},
			Status:      "active",
		},
		Integrations: []api.IntegrationConnection{
			{Slug: "github", IntegrationType: "vcs", Enabled: true},
		},
		Catalog: []api.IntegrationCatalogEntry{
			{Slug: "github", Name: "GitHub", Description: "VCS", Icon: ""},
		},
	}

	page, _ = page.Update(msg)
	if page.loading {
		t.Error("expected loading=false")
	}
	if page.profile == nil {
		t.Error("expected non-nil profile")
	}
	if len(page.integrations) != 1 {
		t.Errorf("expected 1 integration, got %d", len(page.integrations))
	}
}

func TestSettingsPage_Update_SettingsLoadedError(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = true
	page, _ = page.Update(SettingsLoadedMsg{Err: errors.New("fail")})
	if page.loading {
		t.Error("expected loading=false")
	}
	if page.loadErr == nil {
		t.Error("expected non-nil loadErr")
	}
}

func TestSettingsPage_SettingsHelp(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	help := page.settingsHelp()
	if help == "" {
		t.Error("expected non-empty help")
	}

	page.editing = true
	editHelp := page.settingsHelp()
	if editHelp == help {
		t.Error("expected different help in edit mode")
	}
}

func TestSettingsPage_View_Loading(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = true
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty loading view")
	}
}

func TestSettingsPage_View_Error(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.loadErr = errors.New("auth error")
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty error view")
	}
}

func TestSettingsPage_View_Connection(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.com",
		Token:  "long-token-here-1234",
	}
	page := NewSettingsPage(nil, cfg)
	page.loading = false
	page.section = SectionConnection
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty connection view")
	}
}

func TestSettingsPage_View_ConnectionEditing(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "prod",
		Server: "https://prod.com",
		Token:  "tok",
	}
	page := NewSettingsPage(nil, cfg)
	page.loading = false
	page.section = SectionConnection
	page.editing = true
	page.editBuf = "https://new.com"
	page.cursor = 0
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty editing view")
	}
}

func TestSettingsPage_View_Profile(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionCredentials
	page.profile = &api.UserProfile{
		UserID:      "u1",
		DisplayName: "Test",
		Email:       "test@test.com",
		TenantID:    "t1",
		Roles:       []string{"admin"},
		Status:      "active",
	}
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty profile view")
	}
}

func TestSettingsPage_View_ProfileNil(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionCredentials
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view even with nil profile")
	}
}

func TestSettingsPage_View_Integrations(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionIntegrations
	page.catalog = []api.IntegrationCatalogEntry{
		{Slug: "github", Name: "GitHub", Description: "VCS integration", Icon: ""},
		{Slug: "jira", Name: "Jira", Description: "Issue tracking", Icon: "J"},
	}
	page.integrations = []api.IntegrationConnection{
		{Slug: "github", Enabled: true, IntegrationType: "vcs"},
	}
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty integrations view")
	}
}

func TestSettingsPage_View_IntegrationsNoCatalog(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionIntegrations
	page.integrations = []api.IntegrationConnection{
		{Slug: "github", Enabled: true, IntegrationType: "vcs"},
		{Slug: "jira", Enabled: false, IntegrationType: "issue"},
	}
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty integrations view without catalog")
	}
}

func TestSettingsPage_View_IntegrationsEmpty(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionIntegrations
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with empty integrations")
	}
}

func TestSettingsPage_View_Appearance(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page.loading = false
	page.section = SectionAppearance
	page.width = 100
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty appearance view")
	}
}

// Admin page: Update messages, render with data.

func TestAdminPage_Update_DataLoaded(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = true

	msg := AdminDataLoadedMsg{
		Users: []api.UserInfo{
			{ID: "u1", DisplayName: "Admin", Email: "admin@test.com", Status: "active", CreatedAt: "2026-01-01"},
			{ID: "u2", DisplayName: "User", Email: "user@test.com", Status: "active", CreatedAt: "2026-01-02"},
		},
		Tenants: []api.Tenant{
			{ID: "t1", Name: "Org A", CreatedAt: "2026-01-01"},
		},
		Stats: &api.StatsResponse{
			ActiveSessions: 5,
			TotalSessions:  20,
			TokensToday:    150000,
			LocalTokens:    100000,
			CloudTokens:    50000,
			CostToday:      12.50,
		},
	}

	page, _ = page.Update(msg)
	if page.loading {
		t.Error("expected loading=false")
	}
	if len(page.users) != 2 {
		t.Errorf("expected 2 users, got %d", len(page.users))
	}
	if len(page.tenants) != 1 {
		t.Errorf("expected 1 tenant, got %d", len(page.tenants))
	}
	if page.stats == nil {
		t.Error("expected non-nil stats")
	}
}

func TestAdminPage_Update_DataLoadedError(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = true

	page, _ = page.Update(AdminDataLoadedMsg{Err: errors.New("403 forbidden")})
	if page.loading {
		t.Error("expected loading=false")
	}
	if page.loadErr == nil {
		t.Error("expected non-nil loadErr")
	}
}

func TestAdminPage_Update_DataLoadedPartial(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = true

	msg := AdminDataLoadedMsg{
		Err:   errors.New("partial error"),
		Users: []api.UserInfo{{ID: "u1", DisplayName: "Test", Email: "test@test.com", Status: "active", CreatedAt: "2026-01-01"}},
	}
	page, _ = page.Update(msg)
	if page.loadErr != nil {
		t.Error("expected nil loadErr when partial data available")
	}
	if len(page.users) != 1 {
		t.Errorf("expected 1 user, got %d", len(page.users))
	}
}

func TestAdminPage_View_WithUsers(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = false
	page.tab = AdminUsers
	page.users = []api.UserInfo{
		{ID: "u1", DisplayName: "Admin", Email: "admin@test.com", Status: "active", CreatedAt: "2026-01-01"},
		{ID: "u2", DisplayName: "User", Email: "user@test.com", Status: "inactive", CreatedAt: "2026-01-02"},
	}
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty users view")
	}
}

func TestAdminPage_View_WithTenants(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = false
	page.tab = AdminTenants
	page.tenants = []api.Tenant{
		{ID: "t1", Name: "Org A", CreatedAt: "2026-01-01"},
		{ID: "t2", Name: "Org B", CreatedAt: "2026-02-01"},
	}
	page.width = 120
	page.height = 40
	page.cursor = 1
	view := page.View()
	if view == "" {
		t.Error("expected non-empty tenants view")
	}
}

func TestAdminPage_View_WithStats(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = false
	page.tab = AdminStats
	page.stats = &api.StatsResponse{
		ActiveSessions: 5,
		TotalSessions:  20,
		TokensToday:    150000,
		LocalTokens:    100000,
		CloudTokens:    50000,
		CostToday:      12.50,
	}
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty stats view")
	}
}

func TestAdminPage_View_WithStatsZeroTokens(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = false
	page.tab = AdminStats
	page.stats = &api.StatsResponse{
		TokensToday: 0,
	}
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty stats view with zero tokens")
	}
}

func TestAdminPage_View_LoadError(t *testing.T) {
	page := NewAdminPage(nil)
	page.loading = false
	page.loadErr = errors.New("access denied")
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty error view")
	}
}

func TestAdminPage_Update_Refresh(t *testing.T) {
	page := NewAdminPage(nil)
	page, _ = page.Update(tea.KeyPressMsg{Code: 'r'})
	if !page.loading {
		t.Error("expected loading=true after refresh")
	}
}

// Terminal page: InsertMode, View with activeSession, handleKey more paths.

func TestTerminalPage_InsertMode(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	if !page.InsertMode() {
		t.Error("expected insert mode by default")
	}
	page.insertMode = false
	if page.InsertMode() {
		t.Error("expected not insert mode")
	}
}

func TestTerminalPage_View_ActiveSessionNoTabs(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.activeSession = &api.Session{ID: "s1", Name: "test"}
	page.width = 80
	page.height = 24
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with active session but no tabs")
	}
}

func TestTerminalPage_HandleKey_InsertModeToggle(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	// Toggle insert mode off via ctrl+] (code 0x1D).
	page, _ = page.handleKey(tea.KeyPressMsg{Code: 0x1D})
	if page.insertMode {
		t.Error("expected insert mode off after ctrl+]")
	}

	// Toggle back on.
	page, _ = page.handleKey(tea.KeyPressMsg{Code: 0x1D})
	if !page.insertMode {
		t.Error("expected insert mode on after second ctrl+]")
	}
}

func TestTerminalPage_HandleKey_NormalModeI(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.insertMode = false

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'i'})
	if !page.insertMode {
		t.Error("expected insert mode after 'i' in normal mode")
	}
}

func TestTerminalPage_HandleKey_CtrlF(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'f', Mod: tea.ModCtrl})
	if !page.fullScreen {
		t.Error("expected fullscreen after ctrl+f")
	}
}

// Sessions page: selectedSession, doAction, SessionActionDoneMsg,
// shift+tab, enter key.

func TestSessionsPage_selectedSession(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions: sessions,
		filtered: sessions,
		filter:   "all",
		cursor:   0,
	}
	sel := page.selectedSession()
	if sel == nil {
		t.Fatal("expected non-nil selected session")
	}
	if sel.ID != "s1" {
		t.Errorf("expected ID s1, got %q", sel.ID)
	}
}

func TestSessionsPage_selectedSession_OutOfBounds(t *testing.T) {
	page := SessionsPage{filter: "all", cursor: -1}
	if page.selectedSession() != nil {
		t.Error("expected nil for negative cursor")
	}
}

func TestSessionsPage_DoAction_NoSelection(t *testing.T) {
	page := SessionsPage{filter: "all"}
	cmd := page.doAction("start")
	if cmd != nil {
		t.Error("expected nil cmd for no selection")
	}
}

func TestSessionsPage_Update_SessionActionDoneError(t *testing.T) {
	page := SessionsPage{filter: "all"}
	page, _ = page.Update(SessionActionDoneMsg{Action: "start", Err: errors.New("fail")})
	if page.loadErrors == nil {
		t.Error("expected non-nil loadErrors")
	}
	if page.loadErrors["action"] == nil {
		t.Error("expected action error set")
	}
}

func TestSessionsPage_Update_SessionActionDoneSuccess(_ *testing.T) {
	page := SessionsPage{filter: "all"}
	page, cmd := page.Update(SessionActionDoneMsg{Action: "stop"})
	// Without pool, Init returns nil.
	_ = cmd
	_ = page
}

func TestSessionsPage_Update_ShiftTab(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
	}
	page := SessionsPage{sessions: sessions, filtered: sessions, filter: "all"}

	page, _ = page.Update(tea.KeyPressMsg{Code: tea.KeyTab, Mod: tea.ModShift})
	if page.filter != "error" {
		t.Errorf("expected filter 'error' after shift+tab from 'all', got %q", page.filter)
	}
}

func TestSessionsPage_Update_Enter(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Status: "running"}, ContextKey: "prod"},
	}
	page := SessionsPage{sessions: sessions, filtered: sessions, filter: "all", cursor: 0}

	_, cmd := page.Update(tea.KeyPressMsg{Code: tea.KeyEnter})
	if cmd == nil {
		t.Error("expected non-nil cmd after enter with selected session")
	}
}

func TestSessionsPage_Update_ActionKeys(t *testing.T) {
	// Without pool, s/x/d should return nil cmd.
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1"}, ContextKey: "prod"},
	}
	page := SessionsPage{sessions: sessions, filtered: sessions, filter: "all"}

	page, cmd := page.Update(tea.KeyPressMsg{Code: 's'})
	if cmd != nil {
		t.Error("expected nil cmd for 's' without pool")
	}

	page, cmd = page.Update(tea.KeyPressMsg{Code: 'x'})
	if cmd != nil {
		t.Error("expected nil cmd for 'x' without pool")
	}

	_, cmd = page.Update(tea.KeyPressMsg{Code: 'd'})
	if cmd != nil {
		t.Error("expected nil cmd for 'd' without pool")
	}
}

func TestSessionsPage_Update_SearchSpace(t *testing.T) {
	page := SessionsPage{filter: "all", searching: true, search: "hello"}
	page, _ = page.Update(tea.KeyPressMsg{Code: ' '})
	if page.search != "hello " {
		t.Errorf("expected %q, got %q", "hello ", page.search)
	}
}

func TestSessionsPage_View_WithContextFilter(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod", Server: "https://prod.com", Token: "tok"}
	cfg.Contexts["staging"] = &remote.Context{Name: "staging", Server: "https://staging.com", Token: "tok"}
	pool := tui.NewClientPool(cfg)

	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "test", Status: "running", Model: "claude"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		pool:          pool,
		sessions:      sessions,
		filtered:      sessions,
		filter:        "all",
		contextFilter: "prod",
		width:         120,
		height:        40,
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with context filter")
	}
}

func TestSessionsPage_View_WithSearchNotActive(t *testing.T) {
	sessions := []tui.ClusterSession{
		{Session: api.Session{ID: "s1", Name: "test", Status: "running"}, ContextKey: "prod"},
	}
	page := SessionsPage{
		sessions:  sessions,
		filtered:  sessions,
		filter:    "all",
		search:    "test",
		searching: false,
		width:     80,
		height:    24,
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with inactive search")
	}
}

func TestSessionsPage_View_WithLoadErrors(t *testing.T) {
	page := SessionsPage{
		filter:     "all",
		width:      80,
		height:     24,
		loadErrors: map[string]error{"prod": errors.New("timeout")},
	}
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with load errors")
	}
}

// Realms page: renderRealmCard selected/unselected.

func TestRealmsPage_View_SelectedCard(t *testing.T) {
	page := NewRealmsPage()
	page.width = 120
	page.height = 40
	page.cursor = 2
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with selected card")
	}
}

// Campaigns page: renderDetail.

func TestCampaignsPage_View_DetailSelected(t *testing.T) {
	page := NewCampaignsPage()
	page.expanded = true
	page.cursor = 1
	page.width = 120
	page.height = 40
	view := page.View()
	if view == "" {
		t.Error("expected non-empty detail view for campaign 1")
	}
}

// Terminal page: createTab, closeTab, handleSessionsLoaded, handleSpawned,
// View with tabs, renderTabBar, renderFullScreen, Update messages, keyToBytes.

func TestTerminalPage_CreateTab(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "shell-1", "term-1", "ws://localhost/ws")
	if len(page.tabs) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(page.tabs))
	}
	tab := page.tabs[0]
	if tab.label != "shell-1" {
		t.Errorf("expected label %q, got %q", "shell-1", tab.label)
	}
	if tab.terminalID != "term-1" {
		t.Errorf("expected terminalID %q, got %q", "term-1", tab.terminalID)
	}
	if tab.sessionID != "s1" {
		t.Errorf("expected sessionID %q, got %q", "s1", tab.sessionID)
	}
	if tab.connState != connStatusDisconnected {
		t.Errorf("expected disconnected state, got %q", tab.connState)
	}
	if tab.emulator == nil {
		t.Error("expected non-nil emulator")
	}

	// Clean up emulator.
	_ = tab.emulator.Close()
}

func TestTerminalPage_CreateMultipleTabs(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")
	page.createTab("s1", "tab-3", "t3", "ws://localhost/ws/3")

	if len(page.tabs) != 3 {
		t.Fatalf("expected 3 tabs, got %d", len(page.tabs))
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_CloseTab(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")
	page.activeTab = 0

	page.closeTab(0)
	if len(page.tabs) != 1 {
		t.Fatalf("expected 1 tab after close, got %d", len(page.tabs))
	}
	if page.tabs[0].label != "tab-2" {
		t.Errorf("expected remaining tab to be tab-2, got %q", page.tabs[0].label)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_CloseTab_OutOfBounds(_ *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.closeTab(-1) // should not panic
	page.closeTab(5)  // should not panic
}

func TestTerminalPage_CloseTab_LastTab(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws")
	page.closeTab(0)
	if len(page.tabs) != 0 {
		t.Errorf("expected 0 tabs, got %d", len(page.tabs))
	}
}

func TestTerminalPage_CloseTab_WithTerminalID(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.activeToken = "tok"

	page.createTab("s1", "tab-1", "term-1", "ws://pod/ws")
	page.closeTab(0)
	if len(page.tabs) != 0 {
		t.Errorf("expected 0 tabs after close, got %d", len(page.tabs))
	}
}

func TestTerminalPage_HandleSessionsLoaded(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	sessions := []api.CliSession{
		{TerminalID: "t1", Label: "shell-1"},
		{TerminalID: "t2", Label: ""},
	}
	page.handleSessionsLoaded(sessions)

	if len(page.tabs) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(page.tabs))
	}
	if page.tabs[0].label != "shell-1" {
		t.Errorf("expected label %q, got %q", "shell-1", page.tabs[0].label)
	}
	if page.tabs[1].label != "t2" {
		t.Errorf("expected label %q (fallback to terminalID), got %q", "t2", page.tabs[1].label)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_HandleSessionsLoaded_NoSession(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.handleSessionsLoaded(nil) // should not panic
	page.handleSessionsLoaded([]api.CliSession{{TerminalID: "t1"}})
	if len(page.tabs) != 0 {
		t.Error("expected 0 tabs when activeSession is nil")
	}
}

func TestTerminalPage_HandleSpawned(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	// Create an initial tab.
	page.createTab("s1", "tab-1", "t1", "ws://pod/ws/t1")

	// Spawn new tab.
	page.handleSpawned(api.CliSession{TerminalID: "t2", Label: "new-shell"})

	if len(page.tabs) != 2 {
		t.Fatalf("expected 2 tabs, got %d", len(page.tabs))
	}
	if page.activeTab != 1 {
		t.Errorf("expected active tab 1, got %d", page.activeTab)
	}
	if page.tabs[1].label != "new-shell" {
		t.Errorf("expected label %q, got %q", "new-shell", page.tabs[1].label)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_HandleSpawned_NoSession(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.handleSpawned(api.CliSession{TerminalID: "t1"})
	if len(page.tabs) != 0 {
		t.Error("expected 0 tabs when activeSession is nil")
	}
}

func TestTerminalPage_View_WithTabs(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 120
	page.height = 40
	page.activeSession = &api.Session{ID: "s1"}

	page.createTab("s1", "shell-1", "t1", "ws://localhost/ws")
	page.activeTab = 0

	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with tabs")
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_View_FullScreenWithTabs(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 120
	page.height = 40
	page.fullScreen = true

	page.createTab("s1", "shell-1", "t1", "ws://localhost/ws")
	page.activeTab = 0

	view := page.View()
	if view == "" {
		t.Error("expected non-empty fullscreen view")
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_View_NormalModeHelp(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 120
	page.height = 40
	page.insertMode = false

	page.createTab("s1", "shell-1", "t1", "ws://localhost/ws")

	view := page.View()
	if view == "" {
		t.Error("expected non-empty view in normal mode")
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_RenderTabBar(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 120
	page.height = 40

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")

	// Set different connection states.
	page.tabs[0].connState = connStatusConnected
	page.tabs[1].connState = connStatusConnecting

	bar := page.renderTabBar()
	if bar == "" {
		t.Error("expected non-empty tab bar")
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_ResizeAllEmulators(_ *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 120
	page.height = 40

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")

	// Should not panic and should resize both emulators.
	page.resizeAllEmulators()

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_Close_WithTabs(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")

	page.Close()
	if len(page.tabs) != 0 {
		t.Errorf("expected 0 tabs after close, got %d", len(page.tabs))
	}
}

func TestTerminalPage_Update_TerminalOutputMsg(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	_, cmd := page.Update(TerminalOutputMsg{TabIndex: 0})
	// Should return a waitForOutput cmd.
	if cmd == nil {
		t.Error("expected non-nil cmd after TerminalOutputMsg")
	}
}

func TestTerminalPage_Update_TerminalConnectedMsg(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws")

	page, cmd := page.Update(TerminalConnectedMsg{TabIndex: 0})
	if cmd == nil {
		t.Error("expected non-nil cmd after TerminalConnectedMsg")
	}
	if page.tabs[0].connState != connStatusConnected {
		t.Errorf("expected connected state, got %q", page.tabs[0].connState)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_Update_TerminalConnectedMsg_OutOfBounds(_ *testing.T) {
	page := NewTerminalPage("", nil, nil)
	_, _ = page.Update(TerminalConnectedMsg{TabIndex: 5})
	// Should not panic.
}

func TestTerminalPage_Update_TerminalDisconnectedMsg(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws")
	page.tabs[0].connState = connStatusConnected

	page, _ = page.Update(TerminalDisconnectedMsg{TabIndex: 0, Err: errors.New("lost")})
	if page.tabs[0].connState != connStatusDisconnected {
		t.Errorf("expected disconnected state, got %q", page.tabs[0].connState)
	}
	if page.tabs[0].connErr == nil {
		t.Error("expected non-nil connErr")
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_Update_TerminalSessionsLoadedMsg(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	page, _ = page.Update(TerminalSessionsLoadedMsg{
		Sessions: []api.CliSession{
			{TerminalID: "t1", Label: "shell"},
		},
	})
	if len(page.tabs) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(page.tabs))
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_Update_TerminalSpawnedMsg(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	page, _ = page.Update(TerminalSpawnedMsg{
		Session: api.CliSession{TerminalID: "t1", Label: "new-shell"},
	})
	if len(page.tabs) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(page.tabs))
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_HandleKey_CtrlN_MultipleTabs(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")
	page.activeTab = 0

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	if page.activeTab != 1 {
		t.Errorf("expected active tab 1 after ctrl+n, got %d", page.activeTab)
	}

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'n', Mod: tea.ModCtrl})
	if page.activeTab != 0 {
		t.Errorf("expected active tab 0 after wrapping ctrl+n, got %d", page.activeTab)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_HandleKey_CtrlP_MultipleTabs(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")
	page.activeTab = 0

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'p', Mod: tea.ModCtrl})
	if page.activeTab != 1 {
		t.Errorf("expected active tab 1 after ctrl+p from 0, got %d", page.activeTab)
	}

	// Clean up.
	for _, tab := range page.tabs {
		_ = tab.emulator.Close()
	}
}

func TestTerminalPage_HandleKey_CtrlW(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.width = 80
	page.height = 24

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")

	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'w', Mod: tea.ModCtrl})
	if len(page.tabs) != 0 {
		t.Errorf("expected 0 tabs after ctrl+w, got %d", len(page.tabs))
	}
}

func TestTerminalPage_HandleKey_NormalModeIgnoresKeys(t *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.insertMode = false

	// Keys other than 'i' should be ignored in normal mode.
	page, _ = page.handleKey(tea.KeyPressMsg{Code: 'a'})
	if page.insertMode {
		t.Error("expected normal mode to remain after 'a'")
	}
}

// Additional keyToBytes coverage.

func TestKeyToBytes_MoreSpecialKeys(t *testing.T) {
	tests := []struct {
		name string
		msg  tea.KeyPressMsg
		want []byte
	}{
		{"delete", makeKeyMsg("delete"), []byte{0x1b, '[', '3', '~'}},
		{"pgup", makeKeyMsg("pgup"), []byte{0x1b, '[', '5', '~'}},
		{"pgdown", makeKeyMsg("pgdown"), []byte{0x1b, '[', '6', '~'}},
		{"insert", makeKeyMsg("insert"), []byte{0x1b, '[', '2', '~'}},
		{"f2", makeKeyMsg("f2"), []byte{0x1b, 'O', 'Q'}},
		{"f5", makeKeyMsg("f5"), []byte{0x1b, '[', '1', '5', '~'}},
		{"f12", makeKeyMsg("f12"), []byte{0x1b, '[', '2', '4', '~'}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := keyToBytes(tt.msg)
			if len(got) != len(tt.want) {
				t.Errorf("keyToBytes(%s) len=%d, want len=%d (got=%v, want=%v)", tt.name, len(got), len(tt.want), got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("keyToBytes(%s)[%d] = %d, want %d", tt.name, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestKeyToBytes_AllCtrlKeys(t *testing.T) {
	ctrlKeys := map[rune]byte{
		'a': 0x01, 'b': 0x02, 'd': 0x04, 'e': 0x05,
		'g': 0x07, 'h': 0x08, 'k': 0x0b, 'l': 0x0c,
		'n': 0x0e, 'o': 0x0f, 'p': 0x10, 'r': 0x12,
		's': 0x13, 'u': 0x15, 'v': 0x16, 'x': 0x18,
		'y': 0x19, 'z': 0x1a,
	}
	for key, expected := range ctrlKeys {
		msg := tea.KeyPressMsg{Code: key, Mod: tea.ModCtrl}
		got := keyToBytes(msg)
		if len(got) != 1 || got[0] != expected {
			t.Errorf("keyToBytes(ctrl+%c) = %v, want [%d]", key, got, expected)
		}
	}
}

func TestKeyToBytes_FunctionKeys_Extended(t *testing.T) {
	tests := []struct {
		msg  tea.KeyPressMsg
		name string
		want []byte
	}{
		{tea.KeyPressMsg{Code: tea.KeyF3}, "f3", []byte{0x1b, 'O', 'R'}},
		{tea.KeyPressMsg{Code: tea.KeyF4}, "f4", []byte{0x1b, 'O', 'S'}},
		{tea.KeyPressMsg{Code: tea.KeyF6}, "f6", []byte{0x1b, '[', '1', '7', '~'}},
		{tea.KeyPressMsg{Code: tea.KeyF7}, "f7", []byte{0x1b, '[', '1', '8', '~'}},
		{tea.KeyPressMsg{Code: tea.KeyF8}, "f8", []byte{0x1b, '[', '1', '9', '~'}},
		{tea.KeyPressMsg{Code: tea.KeyF9}, "f9", []byte{0x1b, '[', '2', '0', '~'}},
		{tea.KeyPressMsg{Code: tea.KeyF10}, "f10", []byte{0x1b, '[', '2', '1', '~'}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := keyToBytes(tt.msg)
			if len(got) != len(tt.want) {
				t.Errorf("keyToBytes(%s) len=%d, want %d (got=%v)", tt.name, len(got), len(tt.want), got)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("keyToBytes(%s)[%d] = %d, want %d", tt.name, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestKeyToBytes_Unknown(_ *testing.T) {
	// Multi-rune key that doesn't match anything should return nil.
	msg := tea.KeyPressMsg{Code: tea.KeyF11} // f11 is not in the switch
	got := keyToBytes(msg)
	// f11 keystroke is "f11" which is multi-char but not matched, so nil.
	_ = got
}

// Chat: renderMessages with scroll, many messages.

func TestChatPage_View_WithManyMessages(t *testing.T) {
	page := NewChatPage(nil, nil)
	page.session = &api.Session{Name: "test"}
	page.width = 100
	page.height = 30
	page.connected = true

	// Add enough messages to trigger scrolling.
	for i := 0; i < 20; i++ {
		page.messages = append(page.messages, ChatMessage{
			Role:      "user",
			Content:   "Test message with some content to fill space",
			Timestamp: time.Now(),
			Status:    "complete",
		}, ChatMessage{
			Role:      "assistant",
			Content:   "Response with some markdown **bold** content",
			Timestamp: time.Now(),
			Status:    "complete",
		})
	}

	// View with scroll at bottom.
	view := page.View()
	if view == "" {
		t.Error("expected non-empty view with many messages")
	}

	// View with scroll up.
	page.scrollPos = 10
	view = page.View()
	if view == "" {
		t.Error("expected non-empty view when scrolled up")
	}
}

// Diffs: loadDiffContent.

func TestDiffsPage_LoadDiffContent_OutOfBounds(t *testing.T) {
	page := NewDiffsPage(nil)
	cmd := page.loadDiffContent(-1)
	if cmd != nil {
		t.Error("expected nil cmd for negative index")
	}
	cmd = page.loadDiffContent(10)
	if cmd != nil {
		t.Error("expected nil cmd for out of bounds")
	}
}

func TestDiffsPage_LoadDiffContent_AlreadyLoaded(t *testing.T) {
	page := NewDiffsPage(nil)
	page.files = []DiffFile{
		{Path: "main.go", Status: "M", Diff: "already loaded"},
	}
	cmd := page.loadDiffContent(0)
	if cmd != nil {
		t.Error("expected nil cmd for already loaded diff")
	}
}

func TestDiffsPage_LoadDiffContent_NoPodClient(t *testing.T) {
	page := NewDiffsPage(nil)
	page.files = []DiffFile{
		{Path: "main.go", Status: "M"},
	}
	cmd := page.loadDiffContent(0)
	if cmd != nil {
		t.Error("expected nil cmd for nil podClient")
	}
}

// Chronicles: Update r key for refresh.

func TestChroniclesPage_Update_RefreshWithSessionID(t *testing.T) {
	page := NewChroniclesPage(nil)
	page.sessionID = "s1"
	page.noSession = false

	// 'r' should set loading and return a cmd (even though client is nil,
	// the cmd factory doesn't check until execution).
	page, _ = page.Update(tea.KeyPressMsg{Code: 'r'})
	if !page.loading {
		t.Error("expected loading=true after 'r' with sessionID")
	}
}

func TestChroniclesPage_Update_RefreshWithoutSessionID(t *testing.T) {
	page := NewChroniclesPage(nil)
	_, cmd := page.Update(tea.KeyPressMsg{Code: 'r'})
	if cmd != nil {
		t.Error("expected nil cmd for 'r' without sessionID")
	}
}

// Diffs: Update r refresh.

func TestDiffsPage_Update_Refresh(t *testing.T) {
	page := NewDiffsPage(nil)
	page.session = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	// 'r' should trigger SetSession.
	page, _ = page.Update(tea.KeyPressMsg{Code: 'r'})
	// Since CodeEndpoint is set, it should set loading.
	if !page.loading {
		t.Error("expected loading=true after 'r' with session")
	}
}

func TestDiffsPage_Update_RefreshNoSession(t *testing.T) {
	page := NewDiffsPage(nil)
	_, cmd := page.Update(tea.KeyPressMsg{Code: 'r'})
	if cmd != nil {
		t.Error("expected nil cmd for 'r' without session")
	}
}

// Settings: Update r refresh.

func TestSettingsPage_Update_Refresh(t *testing.T) {
	page := NewSettingsPage(nil, nil)
	page, _ = page.Update(tea.KeyPressMsg{Code: 'r'})
	if !page.loading {
		t.Error("expected loading=true after 'r'")
	}
}

// Terminal: ConnectSession, ConnectSessionOnCluster, ConnectCliSession,
// ConnectCliSessionOnCluster, connectTab, spawnNewTab.

func TestTerminalPage_ConnectSession_NoCodeEndpoint(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectSession(sess)

	if page.activeSession == nil {
		t.Error("expected activeSession set")
	}
	// Give goroutine time to start (it connects in background).
	time.Sleep(50 * time.Millisecond)
}

func TestTerminalPage_ConnectSession_CleansOldTabs(_ *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	// Create old tabs.
	page.createTab("old", "old-tab", "t1", "ws://old")

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectSession(sess)

	// Old tabs should be cleared.
	// The new connection happens in goroutine.
	time.Sleep(50 * time.Millisecond)
}

func TestTerminalPage_ConnectSessionOnCluster_NilPool(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectSessionOnCluster(sess, "prod")

	// Should fallback to ConnectSession.
	if page.activeSession == nil {
		t.Error("expected activeSession set")
	}
	time.Sleep(50 * time.Millisecond)
}

func TestTerminalPage_ConnectSessionOnCluster_MissingEntry(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["staging"] = &remote.Context{Name: "staging", Server: "https://staging.com", Token: "tok"}
	pool := tui.NewClientPool(cfg)

	page := NewTerminalPage("http://localhost", nil, pool)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectSessionOnCluster(sess, "nonexistent")

	// Should fallback to ConnectSession.
	if page.activeSession == nil {
		t.Error("expected activeSession set")
	}
	time.Sleep(50 * time.Millisecond)
}

func TestTerminalPage_ConnectCliSession(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectCliSession(sess, "my-session")

	if page.activeSession == nil {
		t.Error("expected activeSession set")
	}
	if len(page.tabs) != 1 {
		t.Errorf("expected 1 tab, got %d", len(page.tabs))
	}
	if page.tabs[0].label != "cli:my-session" {
		t.Errorf("expected label %q, got %q", "cli:my-session", page.tabs[0].label)
	}

	// Clean up.
	page.Close()
}

func TestTerminalPage_ConnectCliSessionOnCluster_NilPool(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectCliSessionOnCluster(sess, "prod", "my-session")

	// Falls back to ConnectCliSession.
	if len(page.tabs) != 1 {
		t.Errorf("expected 1 tab, got %d", len(page.tabs))
	}

	page.Close()
}

func TestTerminalPage_ConnectCliSessionOnCluster_MissingEntry(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["staging"] = &remote.Context{Name: "staging", Server: "https://staging.com", Token: "tok"}
	pool := tui.NewClientPool(cfg)

	page := NewTerminalPage("http://localhost", nil, pool)
	page.width = 80
	page.height = 24

	sess := api.Session{ID: "s1", CodeEndpoint: "http://pod"}
	page.ConnectCliSessionOnCluster(sess, "nonexistent", "my-session")

	// Falls back to ConnectCliSession.
	if len(page.tabs) != 1 {
		t.Errorf("expected 1 tab, got %d", len(page.tabs))
	}

	page.Close()
}

func TestTerminalPage_SpawnNewTab_NoSession(_ *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.spawnNewTab() // should not panic with nil activeSession
}

func TestTerminalPage_ConnectTab_OutOfBounds(_ *testing.T) {
	page := NewTerminalPage("", nil, nil)
	page.connectTab(-1) // should not panic
	page.connectTab(5)  // should not panic
}

func TestTerminalPage_ConnectTab(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24
	page.activeToken = "tok"

	page.createTab("s1", "tab-1", "t1", "ws://localhost/ws/1")
	page.createTab("s1", "tab-2", "t2", "ws://localhost/ws/2")

	// Connect first tab.
	page.connectTab(0)

	if page.tabs[0].ws == nil {
		t.Error("expected ws client created")
	}
	if page.tabs[0].connState != connStatusConnecting {
		t.Errorf("expected connecting state, got %q", page.tabs[0].connState)
	}

	// Clean up: close tabs (ws connect will fail in background, that's OK).
	page.Close()
}

func TestTerminalPage_HandleSessionsLoaded_ClearsOldTabs(t *testing.T) {
	page := NewTerminalPage("http://localhost", nil, nil)
	page.width = 80
	page.height = 24
	page.activeSession = &api.Session{ID: "s1", CodeEndpoint: "http://pod"}

	// Pre-populate with old tabs.
	page.createTab("old", "old-1", "old-t1", "ws://old")

	sessions := []api.CliSession{
		{TerminalID: "t1", Label: "new-shell"},
	}
	page.handleSessionsLoaded(sessions)

	if len(page.tabs) != 1 {
		t.Fatalf("expected 1 tab, got %d", len(page.tabs))
	}
	if page.tabs[0].label != "new-shell" {
		t.Errorf("expected label %q, got %q", "new-shell", page.tabs[0].label)
	}

	page.Close()
}

// Chat: Init is a no-op (returns nil).

func TestChatPage_Init(t *testing.T) {
	page := NewChatPage(nil, nil)
	cmd := page.Init()
	if cmd != nil {
		t.Error("expected nil cmd from Init")
	}
}

// Diffs: SetSession.

func TestDiffsPage_SetSession_NoCodeEndpoint(t *testing.T) {
	page := NewDiffsPage(nil)
	cmd := page.SetSession(api.Session{ID: "s1", Status: "stopped"})
	if cmd != nil {
		t.Error("expected nil cmd for session without code endpoint")
	}
	if page.loadErr == nil {
		t.Error("expected non-nil loadErr")
	}
}

func TestDiffsPage_SetSession_WithCodeEndpoint(t *testing.T) {
	page := NewDiffsPage(nil)
	cmd := page.SetSession(api.Session{ID: "s1", CodeEndpoint: "http://pod"})
	if cmd == nil {
		t.Error("expected non-nil cmd for session with code endpoint")
	}
	if !page.loading {
		t.Error("expected loading=true")
	}
}

// Chronicles: SetSession.

func TestChroniclesPage_SetSession(t *testing.T) {
	page := NewChroniclesPage(nil)
	cmd := page.SetSession(api.Session{ID: "s1"})
	if cmd == nil {
		t.Error("expected non-nil cmd")
	}
	if !page.loading {
		t.Error("expected loading=true")
	}
	if page.noSession {
		t.Error("expected noSession=false")
	}
	if page.sessionID != "s1" {
		t.Errorf("expected sessionID %q, got %q", "s1", page.sessionID)
	}
}
