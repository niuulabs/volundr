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

// WSMessage represents a message received over WebSocket.
type WSMessage struct {
	Type    string          `json:"type"`
	Content string          `json:"content"`
	Role    string          `json:"role"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// WSClient manages a WebSocket connection to the Volundr API.
type WSClient struct {
	baseURL string
	token   string
	conn    *websocket.Conn
	state   WSState
	mu      sync.Mutex

	// OnMessage is called when a message is received.
	OnMessage func(WSMessage)
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

// Send sends a message over the WebSocket connection.
func (w *WSClient) Send(msg WSMessage) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshaling message: %w", err)
	}

	return w.conn.WriteMessage(websocket.TextMessage, data)
}

// SendText sends a plain text chat message.
func (w *WSClient) SendText(content string) error {
	return w.Send(WSMessage{
		Type:    "message",
		Role:    "user",
		Content: content,
	})
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

// readLoop continuously reads messages from the WebSocket.
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

		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			// If it's not JSON, treat it as raw terminal data
			msg = WSMessage{
				Type:    "raw",
				Content: string(data),
			}
		}

		if w.OnMessage != nil {
			w.OnMessage(msg)
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
