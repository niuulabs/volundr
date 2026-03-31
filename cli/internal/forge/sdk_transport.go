package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// SDKTransport manages a WebSocket server that Claude Code connects back to
// via --sdk-url. Messages are exchanged as NDJSON (newline-delimited JSON).
type SDKTransport struct {
	sessionID string
	port      int
	bus       EventEmitter

	mu       sync.Mutex
	conn     *websocket.Conn
	ready    chan struct{} // closed when CLI connects
	listener net.Listener
	srv      *http.Server

	// cliSessionID is the Claude Code session ID received from the init message.
	cliSessionID string

	// onCLIEvent is called for every parsed CLI message, allowing the broker
	// to intercept and forward events to browser clients.
	onCLIEvent func(map[string]any)

	// pendingMessages are sent to the CLI after it connects. Used for
	// initial prompts since --print doesn't work in SDK mode.
	pendingMessages []map[string]any
}

// NewSDKTransport creates a transport that listens on the given port.
func NewSDKTransport(sessionID string, port int, bus EventEmitter) *SDKTransport {
	return &SDKTransport{
		sessionID: sessionID,
		port:      port,
		bus:       bus,
		ready:     make(chan struct{}),
	}
}

// SDKURL returns the WebSocket URL the CLI should connect to.
func (t *SDKTransport) SDKURL() string {
	return fmt.Sprintf("ws://localhost:%d/ws/cli/%s", t.port, t.sessionID)
}

// SetOnCLIEvent registers a callback invoked for every CLI message.
// Used by the broker to intercept events for browser forwarding.
func (t *SDKTransport) SetOnCLIEvent(fn func(map[string]any)) {
	t.onCLIEvent = fn
}

// CLISessionID returns the Claude Code session ID captured from the init message.
func (t *SDKTransport) CLISessionID() string {
	return t.cliSessionID
}

// SendUserMessage sends a typed user message to the CLI, accepting any content
// (string or content block array) and the CLI session ID.
func (t *SDKTransport) SendUserMessage(content any, cliSessionID string) error {
	msg := map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": content,
		},
		"parent_tool_use_id": nil,
		"session_id":         cliSessionID,
	}
	return t.sendJSON(msg)
}

// SendControlResponse sends a control_response message to the CLI.
func (t *SDKTransport) SendControlResponse(response map[string]any) error {
	msg := map[string]any{
		"type":     "control_response",
		"response": response,
	}
	return t.sendJSON(msg)
}

// QueueInitialPrompt queues an initial prompt to be sent to the CLI
// after it connects. This replaces --print which doesn't work in SDK mode.
func (t *SDKTransport) QueueInitialPrompt(prompt string) {
	t.pendingMessages = append(t.pendingMessages, map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": prompt,
		},
		"parent_tool_use_id": nil,
		"session_id":         "",
	})
}

// Port returns the actual listening port (useful when port 0 is used).
func (t *SDKTransport) Port() int {
	if t.listener != nil {
		return t.listener.Addr().(*net.TCPAddr).Port
	}
	return t.port
}

// Start begins listening for the CLI WebSocket connection.
func (t *SDKTransport) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/ws/cli/%s", t.sessionID), t.handleCLIConnect)

	addr := fmt.Sprintf("127.0.0.1:%d", t.port)
	lc := net.ListenConfig{}
	ln, err := lc.Listen(context.Background(), "tcp", addr)
	if err != nil {
		return fmt.Errorf("sdk transport listen on %s: %w", addr, err)
	}
	t.listener = ln

	t.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := t.srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("sdk transport server error (session %s): %v", t.sessionID, err) //nolint:gosec // session ID is internal
		}
	}()

	log.Printf("sdk transport listening on port %d for session %s", t.Port(), t.sessionID) //nolint:gosec // session ID is internal
	return nil
}

// Ready returns a channel that is closed when the CLI has connected.
func (t *SDKTransport) Ready() <-chan struct{} {
	return t.ready
}

// Stop shuts down the WebSocket server and closes the connection.
func (t *SDKTransport) Stop() {
	t.mu.Lock()
	conn := t.conn
	t.conn = nil
	t.mu.Unlock()

	if conn != nil {
		_ = conn.Close()
	}
	if t.srv != nil {
		_ = t.srv.Close()
	}
}

// SendMessage sends a user message to the CLI via WebSocket.
func (t *SDKTransport) SendMessage(content string) error {
	t.mu.Lock()
	conn := t.conn
	t.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("cli not connected")
	}

	msg := map[string]any{
		"type": "user",
		"message": map[string]any{
			"role":    "user",
			"content": content,
		},
		"parent_tool_use_id": nil,
		"session_id":         t.cliSessionID,
	}

	return t.sendJSON(msg)
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

func (t *SDKTransport) handleCLIConnect(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("sdk transport: websocket upgrade failed: %v", err)
		return
	}

	t.mu.Lock()
	t.conn = conn
	t.mu.Unlock()

	log.Printf("sdk transport: CLI connected for session %s", t.sessionID)

	// Signal that CLI is ready.
	select {
	case <-t.ready:
		// Already closed, CLI reconnected.
	default:
		close(t.ready)
	}

	// Flush pending messages (initial prompt) to the CLI.
	if len(t.pendingMessages) > 0 {
		log.Printf("sdk transport: flushing %d pending messages to CLI", len(t.pendingMessages))
		for _, msg := range t.pendingMessages {
			if err := t.sendJSON(msg); err != nil {
				log.Printf("sdk transport: flush pending message: %v", err)
			}
			// Also emit to broker so the message appears in conversation history.
			if t.onCLIEvent != nil {
				t.onCLIEvent(msg)
			}
		}
		t.pendingMessages = nil
	}

	// Send keep-alive pings every 10 seconds to keep the CLI connection alive.
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = t.sendJSON(map[string]any{"type": "keep_alive"})
			}
		}
	}()

	// Read messages from CLI.
	t.receiveLoop(conn)
	close(done)
}

func (t *SDKTransport) receiveLoop(conn *websocket.Conn) {
	defer func() {
		t.mu.Lock()
		if t.conn == conn {
			t.conn = nil
		}
		t.mu.Unlock()
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("sdk transport: read error (session %s): %v", t.sessionID, err)
			}
			return
		}

		// Messages may be NDJSON (multiple JSON objects separated by newlines).
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			var data map[string]any
			if err := json.Unmarshal([]byte(line), &data); err != nil {
				log.Printf("sdk transport: invalid JSON from CLI: %v", err)
				continue
			}

			t.handleCLIMessage(data)

			if t.onCLIEvent != nil {
				t.onCLIEvent(data)
			}
		}
	}
}

func (t *SDKTransport) handleCLIMessage(data map[string]any) {
	msgType, _ := data["type"].(string)

	// Capture CLI session ID from init message.
	if msgType == "system" {
		subtype, _ := data["subtype"].(string)
		if subtype == "init" {
			if sid, ok := data["session_id"].(string); ok && sid != "" {
				t.cliSessionID = sid
			}
			log.Printf("sdk transport: CLI init (session_id=%s)", t.cliSessionID)
		}
	}

	// Capture session_id from non-system messages.
	if sid, ok := data["session_id"].(string); ok && sid != "" && msgType != "system" {
		t.cliSessionID = sid
	}

	// Emit activity state events based on message type.
	switch msgType {
	case "assistant":
		t.emitActivity(ActivityStateActive)
	case "result":
		t.emitActivity(ActivityStateIdle)
	}

	// Check for tool_use in assistant messages to emit tool_executing.
	if msgType == "assistant" {
		if content, ok := data["content"].([]any); ok {
			for _, item := range content {
				if m, ok := item.(map[string]any); ok {
					if m["type"] == "tool_use" {
						t.emitActivity(ActivityStateToolExecuting)
						break
					}
				}
			}
		}
	}
}

func (t *SDKTransport) emitActivity(state string) {
	t.bus.Emit(ActivityEvent{
		SessionID: t.sessionID,
		State:     state,
	})
}

func (t *SDKTransport) sendJSON(msg map[string]any) error {
	t.mu.Lock()
	conn := t.conn
	t.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("cli not connected")
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}

	// NDJSON: append newline.
	payload = append(payload, '\n')

	t.mu.Lock()
	defer t.mu.Unlock()
	return t.conn.WriteMessage(websocket.TextMessage, payload)
}
