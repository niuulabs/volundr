package forge

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestSDKTransport_StartAndStop(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	if transport.Port() == 0 {
		t.Error("expected non-zero port after start")
	}

	url := transport.SDKURL()
	if !strings.Contains(url, "ws://localhost:") {
		t.Errorf("unexpected SDK URL: %s", url)
	}
	if !strings.Contains(url, "/ws/cli/test-session") {
		t.Errorf("SDK URL should contain session path: %s", url)
	}
}

func TestSDKTransport_SendMessage_NoConnection(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	err := transport.SendMessage("hello")
	if err == nil {
		t.Error("expected error when CLI not connected")
	}
}

func TestSDKTransport_CLIConnectsAndReceivesMessage(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	// Connect as the CLI.
	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	// Wait for ready.
	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("CLI connection not signaled as ready")
		return
	}

	// Send a message via the transport.
	if err := transport.SendMessage("test content"); err != nil {
		t.Fatalf("SendMessage: %v", err)
		return
	}

	// Read the message on the CLI side.
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
		return
	}

	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}

	if msg["type"] != "user" {
		t.Errorf("expected type 'user', got %v", msg["type"])
	}

	message, ok := msg["message"].(map[string]any)
	if !ok {
		t.Fatal("expected message field")
		return
	}
	if message["content"] != "test content" {
		t.Errorf("expected content 'test content', got %v", message["content"])
	}
}

func TestSDKTransport_EmitsActivityEvents(t *testing.T) {
	bus := NewEventBus()
	subID, ch := bus.Subscribe()
	defer bus.Unsubscribe(subID)

	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	// Connect as the CLI.
	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("CLI connection not signaled as ready")
		return
	}

	// Send an assistant message from the CLI (simulating Claude responding).
	assistantMsg := map[string]any{
		"type":    "assistant",
		"content": []any{map[string]any{"type": "text", "text": "hello"}},
	}
	payload, _ := json.Marshal(assistantMsg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Should receive an "active" activity event.
	select {
	case event := <-ch:
		if event.SessionID != "test-session" {
			t.Errorf("expected session 'test-session', got %q", event.SessionID)
		}
		if event.State != ActivityStateActive {
			t.Errorf("expected state 'active', got %q", event.State)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected activity event, timed out")
	}

	// Send a result message (turn complete).
	resultMsg := map[string]any{
		"type":        "result",
		"stop_reason": "end_turn",
	}
	payload, _ = json.Marshal(resultMsg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Should receive a "turn_complete" event followed by "idle".
	select {
	case event := <-ch:
		if event.State != ActivityStateTurnComplete {
			t.Errorf("expected state 'turn_complete', got %q", event.State)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected turn_complete event, timed out")
	}
	select {
	case event := <-ch:
		if event.State != ActivityStateIdle {
			t.Errorf("expected state 'idle', got %q", event.State)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected idle event, timed out")
	}
}

func TestSDKTransport_PortBeforeStart(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 9999, bus)
	if transport.Port() != 9999 {
		t.Errorf("expected port 9999 before start, got %d", transport.Port())
	}
}

func TestSDKTransport_InitMessage(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
		return
	}

	// Send a system init message to set CLI session ID.
	initMsg := map[string]any{
		"type":       "system",
		"subtype":    "init",
		"session_id": "cli-session-42",
	}
	payload, _ := json.Marshal(initMsg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Give time for processing.
	time.Sleep(50 * time.Millisecond)

	// Send a message and verify session_id is populated in the sent message.
	if err := transport.SendMessage("hello"); err != nil {
		t.Fatalf("SendMessage: %v", err)
		return
	}

	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
		return
	}

	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if msg["session_id"] != "cli-session-42" {
		t.Errorf("expected session_id 'cli-session-42', got %v", msg["session_id"])
	}
}

func TestSDKTransport_InvalidJSON(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
		return
	}

	// Send invalid JSON — should not crash.
	if err := conn.WriteMessage(websocket.TextMessage, []byte("{bad json}\n")); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Give time for processing; no panic means success.
	time.Sleep(50 * time.Millisecond)
}

func TestSDKTransport_SessionIDFromNonSystemMessage(t *testing.T) {
	bus := NewEventBus()
	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
		return
	}

	// Send an assistant message with session_id.
	msg := map[string]any{
		"type":       "assistant",
		"session_id": "from-assistant-msg",
		"content":    []any{map[string]any{"type": "text", "text": "hi"}},
	}
	payload, _ := json.Marshal(msg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Give time for processing.
	time.Sleep(50 * time.Millisecond)

	// The session_id should now be captured.
	if err := transport.SendMessage("response"); err != nil {
		t.Fatalf("SendMessage: %v", err)
		return
	}

	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
		return
	}

	var reply map[string]any
	if err := json.Unmarshal(raw, &reply); err != nil {
		t.Fatalf("unmarshal: %v", err)
		return
	}
	if reply["session_id"] != "from-assistant-msg" {
		t.Errorf("expected session_id 'from-assistant-msg', got %v", reply["session_id"])
	}
}

func TestSDKTransport_EmitsToolExecuting(t *testing.T) {
	bus := NewEventBus()
	subID, ch := bus.Subscribe()
	defer bus.Unsubscribe(subID)

	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
		return
	}
	defer transport.Stop()

	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
		return
	}
	defer func() { _ = conn.Close() }()
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
		return
	}

	// Send assistant message with tool_use.
	toolMsg := map[string]any{
		"type": "assistant",
		"content": []any{
			map[string]any{
				"type":  "tool_use",
				"name":  "Bash",
				"input": map[string]any{"command": "ls"},
			},
		},
	}
	payload, _ := json.Marshal(toolMsg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
		return
	}

	// Should get active first, then tool_executing.
	events := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		select {
		case event := <-ch:
			events = append(events, event.State)
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for events")
			return
		}
	}

	if events[0] != ActivityStateActive {
		t.Errorf("expected first event 'active', got %q", events[0])
	}
	if events[1] != ActivityStateToolExecuting {
		t.Errorf("expected second event 'tool_executing', got %q", events[1])
	}
}
