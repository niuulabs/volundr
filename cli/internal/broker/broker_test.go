package broker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// mockTransport implements Transport for testing.
type mockTransport struct {
	mu               sync.Mutex
	userMessages     []any
	controlResponses []map[string]any
	cliSessionID     string
	sendErr          error
}

func (m *mockTransport) SendUserMessage(content any, cliSessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sendErr != nil {
		return m.sendErr
	}
	m.userMessages = append(m.userMessages, content)
	return nil
}

func (m *mockTransport) SendControlResponse(response map[string]any) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sendErr != nil {
		return m.sendErr
	}
	m.controlResponses = append(m.controlResponses, response)
	return nil
}

func (m *mockTransport) CLISessionID() string {
	if m.cliSessionID == "" {
		return "cli-session-1"
	}
	return m.cliSessionID
}

// Helper to create a test WebSocket server from a broker.
func setupWSServer(t *testing.T, b *Broker) (*httptest.Server, string) {
	t.Helper()
	mux := http.NewServeMux()
	b.Routes(mux, "")
	srv := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/session"
	return srv, wsURL
}

// Helper to dial a WebSocket and read the welcome message.
func dialAndReadWelcome(t *testing.T, wsURL string) *websocket.Conn {
	t.Helper()
	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// Read welcome message.
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read welcome: %v", err)
	}

	var welcome map[string]any
	if err := json.Unmarshal(msg, &welcome); err != nil {
		t.Fatalf("unmarshal welcome: %v", err)
	}
	if welcome["type"] != "system" {
		t.Errorf("welcome type = %v, want system", welcome["type"])
	}

	return conn
}

func TestNewBroker(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-1", tr, "/tmp/workspace")

	if b.sessionID != "sess-1" {
		t.Errorf("sessionID = %v, want sess-1", b.sessionID)
	}
	if b.transport != tr {
		t.Error("transport not set correctly")
	}
	if b.workspaceDir != "/tmp/workspace" {
		t.Errorf("workspaceDir = %v, want /tmp/workspace", b.workspaceDir)
	}
}

func TestHandleBrowserWS_AcceptsAndSendsWelcome(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-ws", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	if b.browserCount() != 1 {
		t.Errorf("browserCount = %d, want 1", b.browserCount())
	}
}

func TestHandleBrowserMessage_UserMessage(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-user", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	// Send a user message.
	msg := map[string]any{"type": "user", "content": "Hello Claude"}
	if err := conn.WriteJSON(msg); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Read user_confirmed echo.
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var confirmed map[string]any
	json.Unmarshal(raw, &confirmed)
	if confirmed["type"] != "user_confirmed" {
		t.Errorf("type = %v, want user_confirmed", confirmed["type"])
	}
	if confirmed["content"] != "Hello Claude" {
		t.Errorf("content = %v, want Hello Claude", confirmed["content"])
	}

	// Verify transport received the message.
	time.Sleep(50 * time.Millisecond)
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 1 {
		t.Fatalf("userMessages count = %d, want 1", len(tr.userMessages))
	}
	if tr.userMessages[0] != "Hello Claude" {
		t.Errorf("userMessages[0] = %v, want Hello Claude", tr.userMessages[0])
	}

	// Verify history was recorded.
	hist := b.ConversationHistory()
	turns := hist["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Role != "user" || turns[0].Content != "Hello Claude" {
		t.Errorf("turn = %+v, want user/Hello Claude", turns[0])
	}
}

func TestHandleBrowserMessage_LegacyFormat(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-legacy", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	// Legacy format: no "type" field, just "content".
	msg := map[string]any{"content": "legacy message"}
	if err := conn.WriteJSON(msg); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Read user_confirmed.
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var confirmed map[string]any
	json.Unmarshal(raw, &confirmed)
	if confirmed["type"] != "user_confirmed" {
		t.Errorf("type = %v, want user_confirmed", confirmed["type"])
	}

	time.Sleep(50 * time.Millisecond)
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 1 {
		t.Fatalf("userMessages count = %d, want 1", len(tr.userMessages))
	}
}

func TestHandleBrowserMessage_PermissionResponse(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-perm", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	msg := map[string]any{
		"type":       "permission_response",
		"request_id": "req-1",
		"behavior":   "allow",
	}
	if err := conn.WriteJSON(msg); err != nil {
		t.Fatalf("write: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.controlResponses) != 1 {
		t.Fatalf("controlResponses count = %d, want 1", len(tr.controlResponses))
	}
	resp := tr.controlResponses[0]
	if resp["subtype"] != "success" {
		t.Errorf("subtype = %v, want success", resp["subtype"])
	}
}

func TestHandleBrowserMessage_ControlMessages(t *testing.T) {
	types := []string{"interrupt", "set_model", "set_max_thinking_tokens", "rewind_files"}

	for _, msgType := range types {
		t.Run(msgType, func(t *testing.T) {
			tr := &mockTransport{}
			b := NewBroker("sess-ctrl", tr, "")
			srv, wsURL := setupWSServer(t, b)
			defer srv.Close()
			defer b.Stop()

			conn := dialAndReadWelcome(t, wsURL)
			defer conn.Close()

			msg := map[string]any{"type": msgType}
			if msgType == "set_model" {
				msg["model"] = "claude-opus-4-20250514"
			}
			if err := conn.WriteJSON(msg); err != nil {
				t.Fatalf("write: %v", err)
			}

			time.Sleep(50 * time.Millisecond)
			tr.mu.Lock()
			defer tr.mu.Unlock()
			if len(tr.controlResponses) != 1 {
				t.Fatalf("controlResponses count = %d, want 1", len(tr.controlResponses))
			}
			if tr.controlResponses[0]["subtype"] != msgType {
				t.Errorf("subtype = %v, want %v", tr.controlResponses[0]["subtype"], msgType)
			}
		})
	}
}

func TestHandleBrowserMessage_UserNilContent(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-nil", tr, "")

	// Directly call handleBrowserMessage with nil content.
	b.handleBrowserMessage(map[string]any{"type": "user", "content": nil})

	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 0 {
		t.Errorf("should not send when content is nil, got %d messages", len(tr.userMessages))
	}
}

func TestOnCLIEvent_SystemInit(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-init", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	b.OnCLIEvent(map[string]any{
		"type":           "system",
		"subtype":        "init",
		"slash_commands": []any{"/help"},
		"skills":         []any{"code"},
	})

	// Should receive available_commands then the system event itself.
	for i := 0; i < 2; i++ {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		var msg map[string]any
		json.Unmarshal(raw, &msg)
		if msg["type"] == "available_commands" {
			if msg["slash_commands"] == nil {
				t.Error("slash_commands should be present")
			}
			return // test passes
		}
	}
	t.Error("did not receive available_commands message")
}

func TestOnCLIEvent_AssistantContentBlockDeltaResult(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-stream", tr, "")

	// Simulate streaming: assistant -> content_block_delta -> result.
	b.OnCLIEvent(map[string]any{
		"type": "assistant",
		"message": map[string]any{
			"model": "claude-opus-4-20250514",
		},
	})

	if !b.active {
		t.Error("should be active after assistant event")
	}

	b.OnCLIEvent(map[string]any{
		"type":  "content_block_start",
		"content_block": map[string]any{"type": "text"},
	})

	b.OnCLIEvent(map[string]any{
		"type":  "content_block_delta",
		"delta": map[string]any{"text": "Hello "},
	})
	b.OnCLIEvent(map[string]any{
		"type":  "content_block_delta",
		"delta": map[string]any{"text": "world"},
	})

	b.OnCLIEvent(map[string]any{
		"type": "result",
	})

	if b.active {
		t.Error("should not be active after result")
	}

	hist := b.ConversationHistory()
	turns := hist["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Role != "assistant" {
		t.Errorf("role = %v, want assistant", turns[0].Role)
	}
	if turns[0].Content != "Hello world" {
		t.Errorf("content = %q, want 'Hello world'", turns[0].Content)
	}
	if turns[0].Metadata["model"] != "claude-opus-4-20250514" {
		t.Errorf("model = %v, want claude-opus-4-20250514", turns[0].Metadata["model"])
	}
}

func TestOnCLIEvent_ThinkingDelta(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-think", tr, "")

	b.OnCLIEvent(map[string]any{"type": "assistant", "message": map[string]any{}})
	b.OnCLIEvent(map[string]any{
		"type":  "content_block_delta",
		"delta": map[string]any{"thinking": "let me think..."},
	})
	b.OnCLIEvent(map[string]any{
		"type":  "content_block_delta",
		"delta": map[string]any{"text": "Answer"},
	})
	b.OnCLIEvent(map[string]any{"type": "result"})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	// Should have reasoning part + text part.
	if len(turns[0].Parts) < 2 {
		t.Errorf("parts = %d, want >= 2", len(turns[0].Parts))
	}
}

func TestOnCLIEvent_ResultFallbackString(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-fallback", tr, "")

	b.OnCLIEvent(map[string]any{"type": "assistant", "message": map[string]any{}})
	// No content_block_delta, result has string content.
	b.OnCLIEvent(map[string]any{"type": "result", "result": "fallback answer"})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Content != "fallback answer" {
		t.Errorf("content = %q, want 'fallback answer'", turns[0].Content)
	}
}

func TestOnCLIEvent_ResultEmpty(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-empty", tr, "")

	b.OnCLIEvent(map[string]any{"type": "assistant", "message": map[string]any{}})
	b.OnCLIEvent(map[string]any{"type": "result"})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 0 {
		t.Errorf("turns = %d, want 0 (empty result should not record turn)", len(turns))
	}
}

func TestOnCLIEvent_UserStringContent(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-user-cli", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	b.OnCLIEvent(map[string]any{
		"type": "user",
		"message": map[string]any{
			"content": "initial prompt",
		},
	})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Content != "initial prompt" {
		t.Errorf("content = %q, want 'initial prompt'", turns[0].Content)
	}
}

func TestOnCLIEvent_UserArrayContent_NotRecorded(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-user-arr", tr, "")

	// Tool result arrays should NOT be recorded in history.
	b.OnCLIEvent(map[string]any{
		"type": "user",
		"message": map[string]any{
			"content": []any{
				map[string]any{"type": "tool_result", "content": "result"},
			},
		},
	})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 0 {
		t.Errorf("turns = %d, want 0 (tool_result array should not record turn)", len(turns))
	}
}

func TestOnCLIEvent_UserEmptyString_NotRecorded(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-user-empty", tr, "")

	b.OnCLIEvent(map[string]any{
		"type": "user",
		"message": map[string]any{
			"content": "",
		},
	})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 0 {
		t.Errorf("turns = %d, want 0 (empty content should not record turn)", len(turns))
	}
}

func TestOnCLIEvent_KeepAlive_Filtered(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-ka", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	b.OnCLIEvent(map[string]any{"type": "keep_alive"})

	// Set a short read deadline — we should NOT receive anything.
	conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, _, err := conn.ReadMessage()
	if err == nil {
		t.Error("should not receive keep_alive event")
	}
}

func TestConversationHistory_EmptyAndActive(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-hist", tr, "")

	hist := b.ConversationHistory()
	turns := hist["turns"].([]ConversationTurn)
	if len(turns) != 0 {
		t.Errorf("turns = %d, want 0", len(turns))
	}
	if hist["is_active"] != false {
		t.Error("is_active should be false")
	}
	if hist["last_activity"] != "" {
		t.Errorf("last_activity = %v, want empty", hist["last_activity"])
	}

	// Set active.
	b.mu.Lock()
	b.active = true
	b.mu.Unlock()

	hist = b.ConversationHistory()
	if hist["is_active"] != true {
		t.Error("is_active should be true")
	}
	if hist["last_activity"] != "Assistant is responding..." {
		t.Errorf("last_activity = %v, want 'Assistant is responding...'", hist["last_activity"])
	}
}

func TestInjectMessage(t *testing.T) {
	tr := &mockTransport{cliSessionID: "cli-42"}
	b := NewBroker("sess-inject", tr, "")

	err := b.InjectMessage("injected content")
	if err != nil {
		t.Fatalf("InjectMessage: %v", err)
	}

	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 1 {
		t.Fatalf("userMessages = %d, want 1", len(tr.userMessages))
	}
	if tr.userMessages[0] != "injected content" {
		t.Errorf("message = %v, want 'injected content'", tr.userMessages[0])
	}

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Content != "injected content" {
		t.Errorf("content = %v, want 'injected content'", turns[0].Content)
	}
}

func TestInjectMessage_Error(t *testing.T) {
	tr := &mockTransport{sendErr: fmt.Errorf("connection closed")}
	b := NewBroker("sess-inject-err", tr, "")

	err := b.InjectMessage("fail")
	if err == nil {
		t.Error("expected error from InjectMessage")
	}
}

func TestBroadcast_MultipleConnections(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-multi", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn1 := dialAndReadWelcome(t, wsURL)
	defer conn1.Close()
	conn2 := dialAndReadWelcome(t, wsURL)
	defer conn2.Close()

	if b.browserCount() != 2 {
		t.Fatalf("browserCount = %d, want 2", b.browserCount())
	}

	// Broadcast a message.
	b.broadcast(map[string]any{"type": "test", "data": "hello"})

	// Both connections should receive it.
	for i, conn := range []*websocket.Conn{conn1, conn2} {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("conn%d read: %v", i+1, err)
		}
		var msg map[string]any
		json.Unmarshal(raw, &msg)
		if msg["type"] != "test" {
			t.Errorf("conn%d type = %v, want test", i+1, msg["type"])
		}
	}
}

func TestStop_ClosesAllConnections(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-stop", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()

	conn1 := dialAndReadWelcome(t, wsURL)
	conn2 := dialAndReadWelcome(t, wsURL)

	if b.browserCount() != 2 {
		t.Fatalf("browserCount = %d, want 2", b.browserCount())
	}

	b.Stop()

	// After stop, reading should fail.
	conn1.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _, err1 := conn1.ReadMessage()
	conn2.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, _, err2 := conn2.ReadMessage()

	if err1 == nil && err2 == nil {
		t.Error("at least one connection should be closed after Stop")
	}

	if b.browserCount() != 0 {
		t.Errorf("browserCount after stop = %d, want 0", b.browserCount())
	}
}

func TestHandleConversationHistory_HTTP(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-http", tr, "")

	b.appendTurn("user", "hi", nil, nil)

	mux := http.NewServeMux()
	b.Routes(mux, "")

	req := httptest.NewRequest("GET", "/api/conversation/history", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	turns, ok := resp["turns"].([]any)
	if !ok || len(turns) != 1 {
		t.Errorf("turns = %v, want 1 turn", resp["turns"])
	}
}

func TestHandleInjectMessage_HTTP(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-http-inject", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	body := strings.NewReader(`{"content":"injected"}`)
	req := httptest.NewRequest("POST", "/api/message", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 1 {
		t.Fatalf("userMessages = %d, want 1", len(tr.userMessages))
	}
}

func TestHandleInjectMessage_EmptyContent(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-http-empty", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	body := strings.NewReader(`{"content":""}`)
	req := httptest.NewRequest("POST", "/api/message", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestHandleInjectMessage_BadJSON(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-http-bad", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	body := strings.NewReader(`not json`)
	req := httptest.NewRequest("POST", "/api/message", body)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestHandleInjectMessage_TransportError(t *testing.T) {
	tr := &mockTransport{sendErr: fmt.Errorf("broken")}
	b := NewBroker("sess-http-err", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	body := strings.NewReader(`{"content":"fail"}`)
	req := httptest.NewRequest("POST", "/api/message", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", w.Code)
	}
}

func TestHandleHealth_HTTP(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-health", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "healthy" {
		t.Errorf("status = %v, want healthy", resp["status"])
	}
	if resp["session_id"] != "sess-health" {
		t.Errorf("session_id = %v, want sess-health", resp["session_id"])
	}
}

func TestOnCLIEvent_SystemNonInit(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-sys", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	// A system event without subtype "init" should be broadcast but not trigger available_commands.
	b.OnCLIEvent(map[string]any{
		"type":    "system",
		"subtype": "error",
		"message": "something went wrong",
	})

	conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var msg map[string]any
	json.Unmarshal(raw, &msg)
	// Should be the system event itself, not available_commands.
	if msg["type"] != "system" {
		t.Errorf("type = %v, want system", msg["type"])
	}
}

func TestOnCLIEvent_ResultWithUsage(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-usage", tr, "")

	b.OnCLIEvent(map[string]any{
		"type":    "assistant",
		"message": map[string]any{"model": "claude-opus-4-20250514"},
	})
	b.OnCLIEvent(map[string]any{
		"type":  "content_block_delta",
		"delta": map[string]any{"text": "hi"},
	})
	b.OnCLIEvent(map[string]any{
		"type":       "result",
		"modelUsage": map[string]any{"input_tokens": 100, "output_tokens": 50},
	})

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	if turns[0].Metadata["usage"] == nil {
		t.Error("usage should be present in metadata")
	}
}

func TestHandleBrowserMessage_UserNonStringContent(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-obj", tr, "")

	// Content as a structured object (not a string).
	b.handleBrowserMessage(map[string]any{
		"type":    "user",
		"content": map[string]any{"blocks": []any{"text block"}},
	})

	time.Sleep(50 * time.Millisecond)
	tr.mu.Lock()
	defer tr.mu.Unlock()
	if len(tr.userMessages) != 1 {
		t.Fatalf("userMessages = %d, want 1", len(tr.userMessages))
	}

	turns := b.ConversationHistory()["turns"].([]ConversationTurn)
	if len(turns) != 1 {
		t.Fatalf("turns = %d, want 1", len(turns))
	}
	// Content should be JSON-serialized.
	if !strings.Contains(turns[0].Content, "blocks") {
		t.Errorf("content = %q, want JSON with 'blocks'", turns[0].Content)
	}
}

func TestParseDiffOutput(t *testing.T) {
	raw := `diff --git a/file.go b/file.go
index abc..def 100644
--- a/file.go
+++ b/file.go
@@ -1,3 +1,4 @@
 package main
+import "fmt"
 func main() {
-    println("hi")
+    fmt.Println("hi")
`

	result := parseDiffOutput(raw, "file.go")
	if result["filePath"] != "file.go" {
		t.Errorf("filePath = %v, want file.go", result["filePath"])
	}
	hunks := result["hunks"].([]map[string]any)
	if len(hunks) != 1 {
		t.Fatalf("hunks = %d, want 1", len(hunks))
	}
	lines := hunks[0]["lines"].([]map[string]any)
	if len(lines) < 3 {
		t.Errorf("lines = %d, want >= 3", len(lines))
	}
}

func TestParseDiffOutput_Empty(t *testing.T) {
	result := parseDiffOutput("", "empty.go")
	hunks := result["hunks"].([]map[string]any)
	if len(hunks) != 0 {
		t.Errorf("hunks = %d, want 0", len(hunks))
	}
}

func TestHandleDiffFiles_NoWorkspace(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-diff", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	req := httptest.NewRequest("GET", "/api/diff/files", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	files := resp["files"].([]any)
	if len(files) != 0 {
		t.Errorf("files = %d, want 0", len(files))
	}
}

func TestHandleDiff_NoFile(t *testing.T) {
	tr := &mockTransport{}
	b := NewBroker("sess-diff-nofile", tr, "")

	mux := http.NewServeMux()
	b.Routes(mux, "")

	req := httptest.NewRequest("GET", "/api/diff", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	hunks := resp["hunks"].([]any)
	if len(hunks) != 0 {
		t.Errorf("hunks = %d, want 0", len(hunks))
	}
}

func TestHandleDiffFiles_WithWorkspace(t *testing.T) {
	// Create a temp git repo with a changed file.
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=t@t.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=t@t.com")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("cmd %v: %v\n%s", args, err, out)
		}
	}
	run("git", "init")
	run("git", "checkout", "-b", "main")
	os.WriteFile(dir+"/file.txt", []byte("hello\n"), 0644)
	run("git", "add", ".")
	run("git", "commit", "-m", "init")
	// Make a change (unstaged).
	os.WriteFile(dir+"/file.txt", []byte("hello\nworld\n"), 0644)

	tr := &mockTransport{}
	b := NewBroker("sess-diff-ws", tr, dir)
	mux := http.NewServeMux()
	b.Routes(mux, "")

	// Default base (HEAD).
	req := httptest.NewRequest("GET", "/api/diff/files", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	files := resp["files"].([]any)
	if len(files) != 1 {
		t.Errorf("files = %d, want 1", len(files))
	}

	// base=default-branch (main...HEAD) — no commits diverged, so no files.
	req2 := httptest.NewRequest("GET", "/api/diff/files?base=default-branch", nil)
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("status = %d", w2.Code)
	}
}

func TestHandleDiff_WithWorkspace(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=t@t.com",
			"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=t@t.com")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("cmd %v: %v\n%s", args, err, out)
		}
	}
	run("git", "init")
	run("git", "checkout", "-b", "main")
	os.WriteFile(dir+"/file.txt", []byte("line1\n"), 0644)
	run("git", "add", ".")
	run("git", "commit", "-m", "init")
	os.WriteFile(dir+"/file.txt", []byte("line1\nline2\n"), 0644)

	tr := &mockTransport{}
	b := NewBroker("sess-diff-detail", tr, dir)
	mux := http.NewServeMux()
	b.Routes(mux, "")

	// Default base.
	req := httptest.NewRequest("GET", "/api/diff?file=file.txt", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var resp map[string]any
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["filePath"] != "file.txt" {
		t.Errorf("filePath = %v", resp["filePath"])
	}
	hunks := resp["hunks"].([]any)
	if len(hunks) == 0 {
		t.Error("expected at least 1 hunk")
	}

	// base=default-branch.
	req2 := httptest.NewRequest("GET", "/api/diff?file=file.txt&base=default-branch", nil)
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("status = %d", w2.Code)
	}
}

func TestHandleBrowserMessage_TransportError(t *testing.T) {
	tr := &mockTransport{sendErr: fmt.Errorf("broken")}
	b := NewBroker("sess-err", tr, "")
	srv, wsURL := setupWSServer(t, b)
	defer srv.Close()
	defer b.Stop()

	conn := dialAndReadWelcome(t, wsURL)
	defer conn.Close()

	// Send user message — should get error broadcast.
	msg := map[string]any{"type": "user", "content": "test"}
	conn.WriteJSON(msg)

	// Read user_confirmed first, then error.
	for i := 0; i < 2; i++ {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		var resp map[string]any
		json.Unmarshal(raw, &resp)
		if resp["type"] == "error" {
			return // got the error, test passes
		}
	}
	t.Error("did not receive error broadcast")
}
