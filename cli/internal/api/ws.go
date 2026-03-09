package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

// WSState represents the WebSocket connection state.
type WSState int

const (
	WSDisconnected WSState = iota
	WSConnecting
	WSConnected
	WSReconnecting
)

// StreamEvent represents a Claude CLI stream-json event received over WebSocket.
type StreamEvent struct {
	Type string `json:"type"`

	// 'assistant' event — start of assistant turn
	Message *StreamEventMessage `json:"message,omitempty"`

	// 'content_block_start' event
	Index        *int                `json:"index,omitempty"`
	ContentBlock *StreamContentBlock `json:"content_block,omitempty"`

	// 'content_block_delta' event
	Delta *StreamDelta `json:"delta,omitempty"`

	// 'result' event
	Subtype  string  `json:"subtype,omitempty"`
	CostUSD  float64 `json:"cost_usd,omitempty"`
	IsError  bool    `json:"is_error,omitempty"`
	Result   string  `json:"result,omitempty"`

	// 'error' event
	Error json.RawMessage `json:"error,omitempty"`

	// 'system' event
	Content json.RawMessage `json:"content,omitempty"`

	// Legacy / fallback fields
	Role string `json:"role,omitempty"`
}

// StreamEventMessage holds the message field from an 'assistant' event.
type StreamEventMessage struct {
	ID    string `json:"id,omitempty"`
	Role  string `json:"role,omitempty"`
	Model string `json:"model,omitempty"`
}

// StreamContentBlock describes a content block from a 'content_block_start' event.
type StreamContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}

// StreamDelta carries the delta payload from a 'content_block_delta' event.
type StreamDelta struct {
	Type     string `json:"type,omitempty"`
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}

// WSClient manages a WebSocket connection to the Volundr API.
type WSClient struct {
	baseURL string
	token   string
	conn    *websocket.Conn
	state   WSState
	mu      sync.Mutex

	// OnMessage is called for each stream event received.
	OnMessage func(StreamEvent)
	// OnStateChange is called when the connection state changes.
	OnStateChange func(WSState)
	// OnError is called when an error occurs.
	OnError func(error)
}

// NewWSClient creates a new WebSocket client.
func NewWSClient(baseURL, token string) *WSClient {
	// Convert http(s) URL to ws(s)
	wsURL := strings.Replace(baseURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	return &WSClient{
		baseURL: wsURL,
		token:   token,
		state:   WSDisconnected,
	}
}

// Connect establishes a WebSocket connection.
// pathOrURL can be a relative path (appended to baseURL with Bearer auth)
// or a full ws(s):// URL (used as-is with access_token query param).
func (w *WSClient) Connect(pathOrURL string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.setState(WSConnecting)

	var url string
	header := http.Header{}

	if strings.HasPrefix(pathOrURL, "ws://") || strings.HasPrefix(pathOrURL, "wss://") {
		// Full URL — append token as query param (session-pod style auth).
		url = appendAccessToken(pathOrURL, w.token)
	} else {
		// Relative path — use base URL with Bearer header.
		url = w.baseURL + pathOrURL
		if w.token != "" {
			header.Set("Authorization", "Bearer "+w.token)
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		w.setState(WSDisconnected)
		return fmt.Errorf("WebSocket dial failed: %w", err)
	}

	w.conn = conn
	w.setState(WSConnected)

	go w.readLoop()

	return nil
}

// SendText sends a user chat message in the Claude CLI expected format.
func (w *WSClient) SendText(content string) error {
	msg := map[string]string{
		"type":    "user",
		"content": content,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshaling message: %w", err)
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if w.conn == nil {
		return fmt.Errorf("not connected")
	}

	return w.conn.WriteMessage(websocket.TextMessage, data)
}

// SendRaw sends raw bytes over the WebSocket (used for terminal PTY data).
func (w *WSClient) SendRaw(data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.conn == nil {
		return fmt.Errorf("not connected")
	}

	return w.conn.WriteMessage(websocket.BinaryMessage, data)
}

// Close closes the WebSocket connection.
func (w *WSClient) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.conn == nil {
		return nil
	}

	err := w.conn.Close()
	w.conn = nil
	w.setState(WSDisconnected)
	return err
}

// State returns the current connection state.
func (w *WSClient) State() WSState {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.state
}

// readLoop continuously reads messages from the WebSocket, handling NDJSON.
func (w *WSClient) readLoop() {
	for {
		_, data, err := w.conn.ReadMessage()
		if err != nil {
			if w.OnError != nil {
				w.OnError(err)
			}
			w.mu.Lock()
			w.setState(WSDisconnected)
			w.conn = nil
			w.mu.Unlock()
			return
		}

		// Handle NDJSON: a single WS frame may contain multiple newline-separated JSON events.
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			// Strip SSE prefix if present
			if strings.HasPrefix(line, "data:") {
				line = strings.TrimSpace(line[5:])
			}

			var event StreamEvent
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				// Not valid JSON — emit as raw event
				event = StreamEvent{Type: "raw", Result: line}
			}

			if w.OnMessage != nil {
				w.OnMessage(event)
			}
		}
	}
}

// setState updates the connection state and notifies the callback.
func (w *WSClient) setState(state WSState) {
	w.state = state
	if w.OnStateChange != nil {
		w.OnStateChange(state)
	}
}

// appendAccessToken appends an access_token query parameter to a URL.
func appendAccessToken(rawURL, token string) string {
	if token == "" {
		return rawURL
	}
	sep := "?"
	if strings.Contains(rawURL, "?") {
		sep = "&"
	}
	return rawURL + sep + "access_token=" + token
}

// SessionWSURL builds a full WebSocket URL for a session pod endpoint.
// codeEndpoint is the session's HTTPS code_endpoint, path is the WS path to append.
func SessionWSURL(codeEndpoint, path string) string {
	base := strings.TrimRight(codeEndpoint, "/")
	base = strings.Replace(base, "https://", "wss://", 1)
	base = strings.Replace(base, "http://", "ws://", 1)
	return base + path
}

// TerminalWSURLFromChat derives the terminal WebSocket URL from the chat endpoint.
// This matches the web UI pattern: strip /session or /api/session, append /terminal/ws.
func TerminalWSURLFromChat(chatEndpoint string) string {
	// Convert wss to wss (already ws), or https to wss
	wsURL := strings.Replace(chatEndpoint, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	// Strip /session or /api/session suffix
	wsURL = strings.TrimSuffix(wsURL, "/session")
	wsURL = strings.TrimSuffix(wsURL, "/api/session")

	return wsURL + "/terminal/ws"
}

// String returns a human-readable representation of the connection state.
func (s WSState) String() string {
	switch s {
	case WSDisconnected:
		return "disconnected"
	case WSConnecting:
		return "connecting"
	case WSConnected:
		return "connected"
	case WSReconnecting:
		return "reconnecting"
	}
	return "unknown"
}
