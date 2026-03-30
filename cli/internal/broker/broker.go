package broker

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// ConversationTurn is a single user or assistant turn in the conversation.
// Matches the shape the web UI expects from GET /api/conversation/history.
type ConversationTurn struct {
	ID        string         `json:"id"`
	Role      string         `json:"role"` // "user" | "assistant"
	Content   string         `json:"content"`
	Parts     []any          `json:"parts"`
	CreatedAt string         `json:"created_at"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

// Broker bridges browser WebSocket clients (Skuld protocol) and a Claude
// Code CLI process (SDK protocol) via the Transport interface.
//
// Each session gets its own Broker instance. Multiple browser clients can
// connect simultaneously; all receive the same CLI event stream.
//
// TODO(standalone): When running as `niuu volundr broker`, a single Broker
// is created with a standalone Transport that spawns Claude CLI directly.
type Broker struct {
	sessionID string
	transport Transport

	mu       sync.RWMutex
	browsers []*browserConn
	history  []ConversationTurn
	active   bool // true while assistant is generating

	// Streaming accumulator for building assistant turns.
	pendingText      strings.Builder
	pendingParts     []any
	pendingModel     string
	pendingUsage     map[string]any
	currentBlockType string
}

// browserConn wraps a WebSocket connection with a buffered send channel
// so slow clients don't block the CLI receive loop.
type browserConn struct {
	conn *websocket.Conn
	send chan []byte
	done chan struct{}
}

const browserSendBuffer = 256

func newBrowserConn(conn *websocket.Conn) *browserConn {
	bc := &browserConn{
		conn: conn,
		send: make(chan []byte, browserSendBuffer),
		done: make(chan struct{}),
	}
	go bc.writeLoop()
	return bc
}

func (bc *browserConn) writeLoop() {
	defer close(bc.done)
	for msg := range bc.send {
		if err := bc.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (bc *browserConn) close() {
	close(bc.send)
	<-bc.done
	_ = bc.conn.Close()
}

// NewBroker creates a broker for the given session and CLI transport.
func NewBroker(sessionID string, transport Transport) *Broker {
	return &Broker{
		sessionID: sessionID,
		transport: transport,
	}
}

// Routes registers the broker's HTTP/WebSocket handlers on a mux.
// prefix is the path prefix (e.g. "/s/{session_id}" or "" for standalone).
//
// Registered routes:
//   - GET  {prefix}/session                  — browser WebSocket
//   - GET  {prefix}/api/conversation/history  — conversation replay
//   - POST {prefix}/api/message               — external message injection
//   - GET  {prefix}/health                    — health check
func (b *Broker) Routes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc(fmt.Sprintf("GET %s/session", prefix), b.HandleBrowserWS)
	mux.HandleFunc(fmt.Sprintf("GET %s/api/conversation/history", prefix), b.handleConversationHistory)
	mux.HandleFunc(fmt.Sprintf("POST %s/api/message", prefix), b.handleInjectMessage)
	mux.HandleFunc(fmt.Sprintf("GET %s/health", prefix), b.handleHealth)
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// HandleBrowserWS upgrades an HTTP request to a WebSocket and adds it
// to the set of browser clients receiving CLI events.
func (b *Broker) HandleBrowserWS(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("broker: websocket upgrade failed: %v", err)
		return
	}

	bc := newBrowserConn(conn)

	b.mu.Lock()
	b.browsers = append(b.browsers, bc)
	b.mu.Unlock()

	log.Printf("broker: browser connected (session %s, %d clients)", b.sessionID, b.browserCount())

	// Send welcome.
	b.sendTo(bc, map[string]any{
		"type":    "system",
		"content": fmt.Sprintf("Connected to session %s", b.sessionID),
	})

	// Read loop — browser messages.
	b.browserReadLoop(bc)

	// Remove on disconnect.
	b.removeBrowser(bc)
	log.Printf("broker: browser disconnected (session %s, %d clients)", b.sessionID, b.browserCount())
}

func (b *Broker) browserReadLoop(bc *browserConn) {
	for {
		_, raw, err := bc.conn.ReadMessage()
		if err != nil {
			return
		}

		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("broker: invalid JSON from browser: %v", err)
			continue
		}

		b.handleBrowserMessage(msg)
	}
}

func (b *Broker) handleBrowserMessage(msg map[string]any) {
	msgType, _ := msg["type"].(string)

	// Legacy format: {content: "text"} without type field.
	if msgType == "" {
		if content, ok := msg["content"]; ok {
			msgType = "user"
			msg["type"] = "user"
			msg["content"] = content
		}
	}

	switch msgType {
	case "user", "message":
		content := msg["content"]
		if content == nil {
			return
		}

		// Record user turn.
		contentStr := ""
		if s, ok := content.(string); ok {
			contentStr = s
		} else {
			raw, _ := json.Marshal(content)
			contentStr = string(raw)
		}
		b.appendTurn("user", contentStr, nil, nil)

		// Echo confirmation to all browsers.
		b.broadcast(map[string]any{
			"type":    "user_confirmed",
			"id":      uuid.New().String(),
			"content": contentStr,
		})

		// Forward to CLI.
		cliSessionID := b.transport.CLISessionID()
		if err := b.transport.SendUserMessage(content, cliSessionID); err != nil {
			log.Printf("broker: send user message: %v", err)
			b.broadcast(map[string]any{
				"type":  "error",
				"error": fmt.Sprintf("Failed to send message: %v", err),
			})
		}

	case "permission_response":
		resp := translatePermissionResponse(msg)
		if err := b.transport.SendControlResponse(resp); err != nil {
			log.Printf("broker: send permission response: %v", err)
		}

	case "interrupt", "set_model", "set_max_thinking_tokens",
		"set_permission_mode", "rewind_files", "mcp_set_servers":
		resp := translateControlMessage(msgType, msg)
		if err := b.transport.SendControlResponse(resp); err != nil {
			log.Printf("broker: send control %s: %v", msgType, err)
		}
	}
}

// OnCLIEvent is the callback registered on the SDKTransport. It is called
// for every message received from the CLI process.
func (b *Broker) OnCLIEvent(data map[string]any) {
	if !filterCLIEvent(data) {
		return
	}

	msgType, _ := data["type"].(string)

	// Track conversation state for history.
	switch msgType {
	case "system":
		subtype, _ := data["subtype"].(string)
		if subtype == "init" {
			// Extract and broadcast available_commands.
			cmds := map[string]any{"type": "available_commands"}
			if sc, ok := data["slash_commands"]; ok {
				cmds["slash_commands"] = sc
			}
			if sk, ok := data["skills"]; ok {
				cmds["skills"] = sk
			}
			b.broadcast(cmds)
		}

	case "assistant":
		b.mu.Lock()
		b.active = true
		b.pendingText.Reset()
		b.pendingParts = nil
		b.pendingModel = ""
		b.pendingUsage = nil
		b.currentBlockType = ""
		if msg, ok := data["message"].(map[string]any); ok {
			if model, ok := msg["model"].(string); ok {
				b.pendingModel = model
			}
		}
		b.mu.Unlock()

	case "content_block_start":
		if cb, ok := data["content_block"].(map[string]any); ok {
			b.mu.Lock()
			b.currentBlockType, _ = cb["type"].(string)
			b.mu.Unlock()
		}

	case "content_block_delta":
		if delta, ok := data["delta"].(map[string]any); ok {
			b.mu.Lock()
			if text, ok := delta["text"].(string); ok {
				b.pendingText.WriteString(text)
			}
			if thinking, ok := delta["thinking"].(string); ok {
				b.pendingParts = append(b.pendingParts, map[string]any{
					"type": "reasoning", "text": thinking,
				})
			}
			b.mu.Unlock()
		}

	case "result":
		b.mu.Lock()
		b.active = false
		content := b.pendingText.String()
		parts := b.pendingParts
		model := b.pendingModel
		if parts == nil {
			parts = []any{}
		}
		// Fallback: if no streaming text was accumulated, use the result field.
		if content == "" {
			if r, ok := data["result"].(string); ok {
				content = r
			}
		}
		if content != "" {
			parts = append(parts, map[string]any{"type": "text", "text": content})
		}
		metadata := map[string]any{}
		if model != "" {
			metadata["model"] = model
		}
		if usage, ok := data["modelUsage"]; ok {
			metadata["usage"] = usage
		}
		b.pendingText.Reset()
		b.pendingParts = nil
		b.mu.Unlock()

		if content != "" || len(parts) > 0 {
			b.appendTurn("assistant", content, parts, metadata)
		}
	}

	// Broadcast to all browser clients.
	b.broadcast(data)
}

// Stop closes all browser connections.
func (b *Broker) Stop() {
	b.mu.Lock()
	browsers := b.browsers
	b.browsers = nil
	b.mu.Unlock()

	for _, bc := range browsers {
		bc.close()
	}
}

// ConversationHistory returns the history payload for the HTTP endpoint.
func (b *Broker) ConversationHistory() map[string]any {
	b.mu.RLock()
	defer b.mu.RUnlock()

	turns := b.history
	if turns == nil {
		turns = []ConversationTurn{}
	}

	lastActivity := ""
	if b.active {
		lastActivity = "Assistant is responding..."
	}

	return map[string]any{
		"turns":         turns,
		"is_active":     b.active,
		"last_activity": lastActivity,
	}
}

func (b *Broker) handleConversationHistory(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(b.ConversationHistory())
}

func (b *Broker) handleInjectMessage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if req.Content == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	cliSessionID := b.transport.CLISessionID()
	if err := b.transport.SendUserMessage(req.Content, cliSessionID); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"detail": err.Error()})
		return
	}

	b.appendTurn("user", req.Content, nil, nil)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

func (b *Broker) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":     "healthy",
		"session_id": b.sessionID,
	})
}

// InjectMessage sends a message to the CLI from an external source (e.g. Tyr).
func (b *Broker) InjectMessage(content string) error {
	cliSessionID := b.transport.CLISessionID()
	if err := b.transport.SendUserMessage(content, cliSessionID); err != nil {
		return err
	}
	b.appendTurn("user", content, nil, nil)
	return nil
}

// --- internal helpers ---

func (b *Broker) broadcast(data map[string]any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}

	b.mu.RLock()
	defer b.mu.RUnlock()

	for _, bc := range b.browsers {
		select {
		case bc.send <- payload:
		default:
			// Browser is too slow, skip this message.
			log.Printf("broker: dropping message for slow browser client (session %s)", b.sessionID)
		}
	}
}

func (b *Broker) sendTo(bc *browserConn, data map[string]any) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	select {
	case bc.send <- payload:
	default:
	}
}

func (b *Broker) removeBrowser(bc *browserConn) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for i, c := range b.browsers {
		if c == bc {
			b.browsers = append(b.browsers[:i], b.browsers[i+1:]...)
			bc.close()
			return
		}
	}
}

func (b *Broker) browserCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.browsers)
}

func (b *Broker) appendTurn(role, content string, parts []any, metadata map[string]any) {
	if parts == nil {
		parts = []any{}
	}
	if metadata == nil {
		metadata = map[string]any{}
	}

	turn := ConversationTurn{
		ID:        uuid.New().String(),
		Role:      role,
		Content:   content,
		Parts:     parts,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Metadata:  metadata,
	}

	b.mu.Lock()
	b.history = append(b.history, turn)
	b.mu.Unlock()
}
