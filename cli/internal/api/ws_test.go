package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestAppendAccessToken(t *testing.T) {
	tests := []struct {
		name  string
		url   string
		token string
		want  string
	}{
		{"empty token", "wss://example.com/ws", "", "wss://example.com/ws"},
		{"simple URL", "wss://example.com/ws", "tok123", "wss://example.com/ws?access_token=tok123"},
		{"URL with query", "wss://example.com/ws?foo=bar", "tok", "wss://example.com/ws?foo=bar&access_token=tok"},
		{"token with special chars", "wss://example.com/ws", "a=b&c", "wss://example.com/ws?access_token=a%3Db%26c"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := appendAccessToken(tt.url, tt.token)
			if got != tt.want {
				t.Errorf("appendAccessToken(%q, %q) = %q, want %q", tt.url, tt.token, got, tt.want)
			}
		})
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

func TestWSClient_Connect_FullURL(t *testing.T) {
	// Test connecting with a full ws:// URL (session-pod style).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify access_token is in query params.
		if r.URL.Query().Get("access_token") != "my-token" {
			t.Errorf("expected access_token=my-token, got %q", r.URL.Query().Get("access_token"))
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade error: %v", err)
			return
		}
		defer func() { _ = conn.Close() }()
		// Send one event then close.
		evt := StreamEvent{Type: "result", Result: "done"}
		data, _ := json.Marshal(evt)
		_ = conn.WriteMessage(websocket.TextMessage, data)
	}))
	defer srv.Close()

	wsURL := strings.Replace(srv.URL, "http://", "ws://", 1)

	ws := NewWSClient("http://unused", "my-token")

	var received []StreamEvent
	var mu sync.Mutex
	done := make(chan struct{})

	ws.OnMessage = func(e StreamEvent) {
		mu.Lock()
		received = append(received, e)
		mu.Unlock()
	}
	ws.OnError = func(_ error) {
		close(done)
	}

	if err := ws.Connect(wsURL + "/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if ws.State() != WSConnected {
		t.Errorf("expected connected, got %v", ws.State())
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for read loop to finish")
	}

	mu.Lock()
	if len(received) == 0 {
		t.Error("expected at least one event")
	} else if received[0].Type != "result" {
		t.Errorf("expected type %q, got %q", "result", received[0].Type)
	}
	mu.Unlock()
}

func TestWSClient_Connect_RelativePath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-tok" {
			t.Errorf("expected Bearer auth, got %q", r.Header.Get("Authorization"))
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send one message so the client can read it, then close.
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`))
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "test-tok")

	errCh := make(chan struct{}, 1)
	ws.OnError = func(_ error) {
		select {
		case errCh <- struct{}{}:
		default:
		}
	}

	if err := ws.Connect("/ws/chat"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-errCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	_ = ws.Close()
}

func TestWSClient_SendText_Connected(t *testing.T) {
	received := make(chan string, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		received <- string(data)
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	errDone := make(chan struct{}, 1)
	ws.OnError = func(_ error) {
		select {
		case errDone <- struct{}{}:
		default:
		}
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if err := ws.SendText("hello world"); err != nil {
		t.Fatalf("SendText: %v", err)
	}

	select {
	case msg := <-received:
		var parsed map[string]string
		if err := json.Unmarshal([]byte(msg), &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if parsed["type"] != "user" {
			t.Errorf("expected type %q, got %q", "user", parsed["type"])
		}
		if parsed["content"] != "hello world" {
			t.Errorf("expected content %q, got %q", "hello world", parsed["content"])
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for message")
	}

	// Wait for readLoop to finish before closing to avoid race on setState.
	select {
	case <-errDone:
	case <-time.After(2 * time.Second):
	}

	_ = ws.Close()
}

func TestWSClient_SendRaw_Connected(t *testing.T) {
	received := make(chan []byte, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		received <- data
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	errDone := make(chan struct{}, 1)
	ws.OnError = func(_ error) {
		select {
		case errDone <- struct{}{}:
		default:
		}
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if err := ws.SendRaw([]byte("raw bytes")); err != nil {
		t.Fatalf("SendRaw: %v", err)
	}

	select {
	case msg := <-received:
		if string(msg) != "raw bytes" {
			t.Errorf("expected %q, got %q", "raw bytes", string(msg))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	// Wait for readLoop to finish before closing to avoid race on setState.
	select {
	case <-errDone:
	case <-time.After(2 * time.Second):
	}

	_ = ws.Close()
}

func TestWSClient_Close_Connected(t *testing.T) {
	serverDone := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send a message then close from server side to let readLoop exit cleanly.
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`))
		// Wait for test to signal we can close the server conn.
		<-serverDone
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	var stateChanges []WSState
	var mu sync.Mutex
	ws.OnStateChange = func(s WSState) {
		mu.Lock()
		stateChanges = append(stateChanges, s)
		mu.Unlock()
	}

	errCh := make(chan struct{}, 1)
	ws.OnError = func(_ error) {
		select {
		case errCh <- struct{}{}:
		default:
		}
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	// Close server side first so readLoop exits cleanly.
	close(serverDone)

	// Wait for readLoop to finish (it will call OnError when server closes).
	select {
	case <-errCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for readLoop to finish")
	}

	if ws.State() != WSDisconnected {
		t.Errorf("expected disconnected after server close, got %v", ws.State())
	}

	// Close should be safe even after readLoop has set state to disconnected.
	if err := ws.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestWSClient_ReadLoop_NDJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()

		// Send NDJSON: multiple JSON events in one frame.
		ndjson := `{"type":"content_block_start"}
{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}
`
		_ = conn.WriteMessage(websocket.TextMessage, []byte(ndjson))
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	var events []StreamEvent
	var mu sync.Mutex
	done := make(chan struct{})

	ws.OnMessage = func(e StreamEvent) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	}
	ws.OnError = func(_ error) {
		close(done)
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(events))
	}
	if events[0].Type != "content_block_start" {
		t.Errorf("expected type %q, got %q", "content_block_start", events[0].Type)
	}
	if events[1].Delta == nil || events[1].Delta.Text != "hello" {
		t.Error("expected delta text 'hello'")
	}
}

func TestWSClient_ReadLoop_SSEPrefix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()

		// Send SSE-prefixed data.
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`data: {"type":"result","result":"ok"}`))
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	var events []StreamEvent
	var mu sync.Mutex
	done := make(chan struct{})

	ws.OnMessage = func(e StreamEvent) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	}
	ws.OnError = func(_ error) {
		close(done)
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "result" {
		t.Errorf("expected type %q, got %q", "result", events[0].Type)
	}
	if events[0].Result != "ok" {
		t.Errorf("expected result %q, got %q", "ok", events[0].Result)
	}
}

func TestWSClient_ReadLoop_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()

		_ = conn.WriteMessage(websocket.TextMessage, []byte("not valid json at all"))
	}))
	defer srv.Close()

	ws := NewWSClient(srv.URL, "tok")

	var events []StreamEvent
	var mu sync.Mutex
	done := make(chan struct{})

	ws.OnMessage = func(e StreamEvent) {
		mu.Lock()
		events = append(events, e)
		mu.Unlock()
	}
	ws.OnError = func(_ error) {
		close(done)
	}

	if err := ws.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "raw" {
		t.Errorf("expected type %q for invalid JSON, got %q", "raw", events[0].Type)
	}
}
