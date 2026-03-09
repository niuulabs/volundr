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
// pathOrURL can be a relative path (appended to baseURL with Bearer auth)
// or a full ws(s):// URL (used as-is with access_token query param).
func (t *TerminalWSClient) Connect(pathOrURL string) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.setState(WSConnecting)

	var url string
	header := http.Header{}

	if strings.HasPrefix(pathOrURL, "ws://") || strings.HasPrefix(pathOrURL, "wss://") {
		url = appendAccessToken(pathOrURL, t.token)
	} else {
		url = t.baseURL + pathOrURL
		if t.token != "" {
			header.Set("Authorization", "Bearer "+t.token)
		}
	}

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

// SendRaw sends keyboard input over the WebSocket as a JSON input message.
// The session pod expects {"type":"input","data":"..."} for keyboard input.
func (t *TerminalWSClient) SendRaw(data []byte) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.conn == nil {
		return fmt.Errorf("not connected")
	}

	msg := struct {
		Type string `json:"type"`
		Data string `json:"data"`
	}{
		Type: "input",
		Data: string(data),
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshaling input message: %w", err)
	}

	return t.conn.WriteMessage(websocket.TextMessage, payload)
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

// terminalMsg represents a JSON-wrapped terminal message from the session pod.
type terminalMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

// readLoop continuously reads messages from the WebSocket.
// The session pod sends JSON-wrapped PTY output: {"type":"output","data":"<escaped PTY data>"}.
// We parse the JSON and extract the raw PTY bytes for the vt emulator.
func (t *TerminalWSClient) readLoop() {
	for {
		msgType, data, err := t.conn.ReadMessage()
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

		if t.OnData == nil {
			continue
		}

		// Binary messages are raw PTY data — pass through directly.
		if msgType == websocket.BinaryMessage {
			t.OnData(data)
			continue
		}

		// Text messages may be JSON-wrapped PTY output.
		var msg terminalMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			// Not valid JSON — treat as raw PTY data.
			t.OnData(data)
			continue
		}

		switch msg.Type {
		case "output":
			// PTY output — the data field contains the terminal bytes.
			t.OnData([]byte(msg.Data))
		default:
			// Unknown message type — ignore (e.g., ack, resize echo).
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
