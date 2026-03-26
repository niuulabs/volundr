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
	}
	defer transport.Stop()

	// Connect as the CLI.
	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Wait for ready.
	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("CLI connection not signaled as ready")
	}

	// Send a message via the transport.
	if err := transport.SendMessage("test content"); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	// Read the message on the CLI side.
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if msg["type"] != "user" {
		t.Errorf("expected type 'user', got %v", msg["type"])
	}

	message, ok := msg["message"].(map[string]any)
	if !ok {
		t.Fatal("expected message field")
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
	}
	defer transport.Stop()

	// Connect as the CLI.
	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("CLI connection not signaled as ready")
	}

	// Send an assistant message from the CLI (simulating Claude responding).
	assistantMsg := map[string]any{
		"type":    "assistant",
		"content": []any{map[string]any{"type": "text", "text": "hello"}},
	}
	payload, _ := json.Marshal(assistantMsg)
	if err := conn.WriteMessage(websocket.TextMessage, append(payload, '\n')); err != nil {
		t.Fatalf("write: %v", err)
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
	}

	// Should receive an "idle" activity event.
	select {
	case event := <-ch:
		if event.State != ActivityStateIdle {
			t.Errorf("expected state 'idle', got %q", event.State)
		}
	case <-time.After(2 * time.Second):
		t.Error("expected idle event, timed out")
	}
}

func TestSDKTransport_EmitsToolExecuting(t *testing.T) {
	bus := NewEventBus()
	subID, ch := bus.Subscribe()
	defer bus.Unsubscribe(subID)

	transport := NewSDKTransport("test-session", 0, bus)

	if err := transport.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer transport.Stop()

	wsURL := fmt.Sprintf("ws://localhost:%d/ws/cli/test-session", transport.Port())
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	select {
	case <-transport.Ready():
	case <-time.After(2 * time.Second):
		t.Fatal("not ready")
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
	}

	// Should get active first, then tool_executing.
	events := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		select {
		case event := <-ch:
			events = append(events, event.State)
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for events")
		}
	}

	if events[0] != ActivityStateActive {
		t.Errorf("expected first event 'active', got %q", events[0])
	}
	if events[1] != ActivityStateToolExecuting {
		t.Errorf("expected second event 'tool_executing', got %q", events[1])
	}
}
