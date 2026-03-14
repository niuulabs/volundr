package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestTerminalWSClient_Connect_FullURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("access_token") != "my-tok" {
			t.Errorf("expected access_token=my-tok, got %q", r.URL.Query().Get("access_token"))
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send a JSON-wrapped output message.
		msg := `{"type":"output","data":"hello terminal"}`
		_ = conn.WriteMessage(websocket.TextMessage, []byte(msg))
	}))
	defer srv.Close()

	wsURL := "ws" + srv.URL[4:] // http -> ws

	tw := NewTerminalWSClient("http://unused", "my-tok")

	var received []string
	var mu sync.Mutex
	done := make(chan struct{})

	tw.OnData = func(data []byte) {
		mu.Lock()
		received = append(received, string(data))
		mu.Unlock()
	}
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect(wsURL + "/terminal/ws/t1"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if tw.State() != WSConnected {
		t.Errorf("expected connected, got %v", tw.State())
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for readLoop")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) == 0 {
		t.Fatal("expected at least one data callback")
	}
	if received[0] != "hello terminal" {
		t.Errorf("expected %q, got %q", "hello terminal", received[0])
	}
}

func TestTerminalWSClient_Connect_RelativePath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok123" {
			t.Errorf("expected Bearer auth, got %q", r.Header.Get("Authorization"))
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"output","data":"ok"}`))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok123")
	done := make(chan struct{})
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/terminal/ws/t1"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}

func TestTerminalWSClient_ReadLoop_BinaryMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send binary message (raw PTY data).
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte("raw pty bytes"))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok")
	var received []byte
	var mu sync.Mutex
	done := make(chan struct{})

	tw.OnData = func(data []byte) {
		mu.Lock()
		received = append(received, data...)
		mu.Unlock()
	}
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	if string(received) != "raw pty bytes" {
		t.Errorf("expected %q, got %q", "raw pty bytes", string(received))
	}
}

func TestTerminalWSClient_ReadLoop_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send text that is not valid JSON -- should be treated as raw PTY data.
		_ = conn.WriteMessage(websocket.TextMessage, []byte("not json"))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok")
	var received []string
	var mu sync.Mutex
	done := make(chan struct{})

	tw.OnData = func(data []byte) {
		mu.Lock()
		received = append(received, string(data))
		mu.Unlock()
	}
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) == 0 {
		t.Fatal("expected data callback for invalid JSON")
	}
	if received[0] != "not json" {
		t.Errorf("expected %q, got %q", "not json", received[0])
	}
}

func TestTerminalWSClient_ReadLoop_UnknownType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send a valid JSON message with unknown type -- should be silently ignored.
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ack","data":"ok"}`))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok")
	var received []string
	var mu sync.Mutex
	done := make(chan struct{})

	tw.OnData = func(data []byte) {
		mu.Lock()
		received = append(received, string(data))
		mu.Unlock()
	}
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	mu.Lock()
	defer mu.Unlock()
	// Unknown type messages are ignored, so OnData should not be called.
	if len(received) != 0 {
		t.Errorf("expected no data callbacks for unknown type, got %d", len(received))
	}
}

func TestTerminalWSClient_ReadLoop_NoOnData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"output","data":"x"}`))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok")
	// Do NOT set OnData -- should not panic.
	done := make(chan struct{})
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}
}

func TestTerminalWSClient_SendRaw_Connected(t *testing.T) {
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

	tw := NewTerminalWSClient(srv.URL, "tok")

	errDone := make(chan struct{}, 1)
	tw.OnError = func(_ error) {
		select {
		case errDone <- struct{}{}:
		default:
		}
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if err := tw.SendRaw([]byte("ls -la")); err != nil {
		t.Fatalf("SendRaw: %v", err)
	}

	select {
	case msg := <-received:
		var parsed struct {
			Type string `json:"type"`
			Data string `json:"data"`
		}
		if err := json.Unmarshal([]byte(msg), &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if parsed.Type != "input" {
			t.Errorf("expected type %q, got %q", "input", parsed.Type)
		}
		if parsed.Data != "ls -la" {
			t.Errorf("expected data %q, got %q", "ls -la", parsed.Data)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	// Wait for readLoop to finish before closing to avoid race on setState.
	select {
	case <-errDone:
	case <-time.After(2 * time.Second):
	}

	_ = tw.Close()
}

func TestTerminalWSClient_SendResize_Connected(t *testing.T) {
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

	tw := NewTerminalWSClient(srv.URL, "tok")

	errDone := make(chan struct{}, 1)
	tw.OnError = func(_ error) {
		select {
		case errDone <- struct{}{}:
		default:
		}
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	if err := tw.SendResize(120, 40); err != nil {
		t.Fatalf("SendResize: %v", err)
	}

	select {
	case msg := <-received:
		var parsed struct {
			Type string `json:"type"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}
		if err := json.Unmarshal([]byte(msg), &parsed); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if parsed.Type != "resize" {
			t.Errorf("expected type %q, got %q", "resize", parsed.Type)
		}
		if parsed.Cols != 120 {
			t.Errorf("expected cols 120, got %d", parsed.Cols)
		}
		if parsed.Rows != 40 {
			t.Errorf("expected rows 40, got %d", parsed.Rows)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	// Wait for readLoop to finish before closing to avoid race on setState.
	select {
	case <-errDone:
	case <-time.After(2 * time.Second):
	}

	_ = tw.Close()
}

func TestTerminalWSClient_Close_Connected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		// Send a message then close from server side.
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"output","data":"x"}`))
	}))
	defer srv.Close()

	tw := NewTerminalWSClient(srv.URL, "tok")
	done := make(chan struct{})
	tw.OnError = func(_ error) {
		close(done)
	}

	if err := tw.Connect("/ws"); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	// Wait for readLoop to finish.
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out")
	}

	if tw.State() != WSDisconnected {
		t.Errorf("expected disconnected, got %v", tw.State())
	}

	// Close after readLoop has finished should be safe.
	if err := tw.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestTerminalWSClient_Connect_ErrorIncludes_Debug(t *testing.T) {
	// Connect to an unreachable address to test the error formatting.
	tw := NewTerminalWSClient("http://127.0.0.1:1", "my-secret-token")
	err := tw.Connect("/terminal/ws/t1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
	// Error should include token length.
	errStr := err.Error()
	if !containsSubstring(errStr, "token_len=") {
		t.Errorf("expected token_len in error, got %q", errStr)
	}
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || s != "" && containsCheck(s, sub))
}

func containsCheck(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
