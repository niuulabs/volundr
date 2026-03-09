package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

// TerminalWSClient manages a raw binary WebSocket connection for PTY streaming.
// Unlike WSClient, it does not attempt JSON parsing on received messages;
// all received data is treated as raw PTY output bytes.
type TerminalWSClient struct {
	baseURL string
	token   string
	conn    *websocket.Conn
	state   WSState
	mu      sync.Mutex

	// OnData is called with raw PTY output bytes.
	OnData func([]byte)
	// OnStateChange is called when the connection state changes.
	OnStateChange func(WSState)
	// OnError is called when an error occurs.
	OnError func(error)
}

// NewTerminalWSClient creates a new terminal-specific WebSocket client.
func NewTerminalWSClient(baseURL, token string) *TerminalWSClient {
	wsURL := strings.Replace(baseURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	return &TerminalWSClient{
		baseURL: wsURL,
		token:   token,
		state:   WSDisconnected,
	}
}

// Connect establishes a WebSocket connection to the terminal endpoint.
func (t *TerminalWSClient) Connect(path string) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.setState(WSConnecting)

	header := http.Header{}
	if t.token != "" {
		header.Set("Authorization", "Bearer "+t.token)
	}

	url := t.baseURL + path
	conn, _, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		t.setState(WSDisconnected)
		return fmt.Errorf("terminal WebSocket dial failed: %w", err)
	}

	t.conn = conn
	t.setState(WSConnected)

	go t.readLoop()

	return nil
}

// SendRaw sends raw keyboard input bytes over the WebSocket.
func (t *TerminalWSClient) SendRaw(data []byte) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return fmt.Errorf("not connected")
	}

	return t.conn.WriteMessage(websocket.BinaryMessage, data)
}

// SendResize sends a resize control message over the WebSocket.
func (t *TerminalWSClient) SendResize(cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return fmt.Errorf("not connected")
	}

	msg := struct {
		Type string `json:"type"`
		Cols int    `json:"cols"`
		Rows int    `json:"rows"`
	}{
		Type: "resize",
		Cols: cols,
		Rows: rows,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshaling resize message: %w", err)
	}

	return t.conn.WriteMessage(websocket.TextMessage, data)
}

// Close closes the WebSocket connection.
func (t *TerminalWSClient) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return nil
	}

	err := t.conn.Close()
	t.conn = nil
	t.setState(WSDisconnected)
	return err
}

// State returns the current connection state.
func (t *TerminalWSClient) State() WSState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state
}

// readLoop continuously reads raw bytes from the WebSocket.
func (t *TerminalWSClient) readLoop() {
	for {
		_, data, err := t.conn.ReadMessage()
		if err != nil {
			if t.OnError != nil {
				t.OnError(err)
			}
			t.mu.Lock()
			t.setState(WSDisconnected)
			t.conn = nil
			t.mu.Unlock()
			return
		}

		if t.OnData != nil {
			t.OnData(data)
		}
	}
}

// setState updates the connection state and notifies the callback.
func (t *TerminalWSClient) setState(state WSState) {
	t.state = state
	if t.OnStateChange != nil {
		t.OnStateChange(state)
	}
}
