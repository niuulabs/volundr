package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SessionPodClient makes REST calls directly to a session pod using its code_endpoint.
type SessionPodClient struct {
	baseURL    string // code_endpoint (e.g., "https://sessions.../s/{id}/")
	token      string
	httpClient *http.Client
}

// NewSessionPodClient creates a client for a session pod's REST API.
// codeEndpoint is the session's CodeEndpoint field.
func NewSessionPodClient(codeEndpoint, token string) *SessionPodClient {
	return &SessionPodClient{
		baseURL: strings.TrimRight(codeEndpoint, "/"),
		token:   token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// DiffFilesResponse represents the response from the diff/files endpoint.
type DiffFilesResponse struct {
	Files []DiffFileEntry `json:"files"`
}

// DiffFileEntry represents a single changed file from the session pod.
type DiffFileEntry struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // "M", "A", "D"
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// DiffResponse represents the structured diff content from the session pod.
// The backend returns {"filePath": "...", "hunks": [...]}.
type DiffResponse struct {
	FilePath string     `json:"filePath"`
	Hunks    []DiffHunk `json:"hunks"`
}

// DiffHunk represents a single hunk in a unified diff.
type DiffHunk struct {
	OldStart int        `json:"oldStart"`
	OldCount int        `json:"oldCount"`
	NewStart int        `json:"newStart"`
	NewCount int        `json:"newCount"`
	Lines    []DiffLine `json:"lines"`
}

// DiffLine represents a single line within a diff hunk.
type DiffLine struct {
	Type    string `json:"type"` // "add", "remove", "context"
	Content string `json:"content"`
}

// ConversationTurn represents a single turn from the conversation history API.
type ConversationTurn struct {
	ID        string         `json:"id"`
	Role      string         `json:"role"` // "user", "assistant"
	Content   string         `json:"content"`
	CreatedAt string         `json:"created_at"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

// ConversationHistoryResponse is the response from /api/conversation/history.
type ConversationHistoryResponse struct {
	Turns []ConversationTurn `json:"turns"`
}

// FileEntry represents a file in the workspace.
type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

// do executes an HTTP request to the session pod with token auth.
//
//nolint:unparam // method is always GET today but kept for API symmetry with doWithBody.
func (s *SessionPodClient) do(method, path string) (*http.Response, error) {
	return s.doWithBody(method, path, nil)
}

// doWithBody executes an HTTP request with an optional JSON body.
func (s *SessionPodClient) doWithBody(method, path string, body any) (*http.Response, error) {
	url := s.baseURL + path

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshaling request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("session pod request failed: %w", err)
	}

	return resp, nil
}

// GetDiffFiles returns the list of changed files in the session workspace.
func (s *SessionPodClient) GetDiffFiles(base string) ([]DiffFileEntry, error) {
	path := "/api/diff/files"
	if base != "" {
		path += "?base=" + base
	}

	resp, err := s.do("GET", path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result DiffFilesResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding diff files: %w", err)
	}
	return result.Files, nil
}

// GetFileDiff returns the unified diff content for a single file.
// The backend returns structured hunks; this method reconstructs unified diff text.
func (s *SessionPodClient) GetFileDiff(base, filePath string) (string, error) {
	path := fmt.Sprintf("/api/diff?base=%s&file=%s", base, filePath)

	resp, err := s.do("GET", path)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result DiffResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding diff: %w", err)
	}
	return hunksToUnifiedDiff(result), nil
}

// hunksToUnifiedDiff reconstructs a unified diff string from structured hunks.
func hunksToUnifiedDiff(resp DiffResponse) string {
	if len(resp.Hunks) == 0 {
		return ""
	}

	var b strings.Builder
	for _, hunk := range resp.Hunks {
		fmt.Fprintf(&b, "@@ -%d,%d +%d,%d @@\n",
			hunk.OldStart, hunk.OldCount, hunk.NewStart, hunk.NewCount)
		for _, line := range hunk.Lines {
			switch line.Type {
			case "add":
				b.WriteString("+" + line.Content + "\n")
			case "remove":
				b.WriteString("-" + line.Content + "\n")
			default: // context
				b.WriteString(" " + line.Content + "\n")
			}
		}
	}
	return b.String()
}

// GetConversationHistory fetches the chat history from the session pod.
func (s *SessionPodClient) GetConversationHistory() ([]ConversationTurn, error) {
	resp, err := s.do("GET", "/api/conversation/history")
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result ConversationHistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding conversation history: %w", err)
	}
	return result.Turns, nil
}

// ListFiles returns files in the session workspace at the given path.
func (s *SessionPodClient) ListFiles(dirPath string) ([]FileEntry, error) {
	path := "/api/files"
	if dirPath != "" {
		path += "?path=" + dirPath
	}

	resp, err := s.do("GET", path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result []FileEntry
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding files: %w", err)
	}
	return result, nil
}

// CliSession represents a persistent tmux-backed terminal session on a session pod.
// Maps to devrunner's terminal.py API response format.
type CliSession struct {
	TerminalID string `json:"terminalId"`
	Label      string `json:"label"`
	CliType    string `json:"cli_type"`
	Status     string `json:"status"`
	Persistent bool   `json:"persistent"`
}

// CliSessionList is the response from listing terminal sessions.
type CliSessionList struct {
	Sessions []CliSession `json:"sessions"`
	Tmux     bool         `json:"tmux"`
}

// CreateCliSessionRequest holds parameters for spawning a terminal session.
type CreateCliSessionRequest struct {
	CliType string `json:"cli_type"`
	Name    string `json:"name,omitempty"`
	Label   string `json:"label,omitempty"`
}

// ListCliSessions returns all terminal sessions from the devrunner.
func (s *SessionPodClient) ListCliSessions() (*CliSessionList, error) {
	resp, err := s.do("GET", "/terminal/api/terminal/sessions")
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result CliSessionList
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding terminal sessions: %w", err)
	}
	return &result, nil
}

// CreateCliSession spawns a new persistent terminal session on the devrunner.
func (s *SessionPodClient) CreateCliSession(req CreateCliSessionRequest) (*CliSession, error) {
	resp, err := s.doWithBody("POST", "/terminal/api/terminal/spawn", req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result CliSession
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding terminal session: %w", err)
	}
	return &result, nil
}

// KillCliSession kills a terminal session by ID.
func (s *SessionPodClient) KillCliSession(terminalID string) error {
	body := map[string]string{"terminalId": terminalID}
	resp, err := s.doWithBody("POST", "/terminal/api/terminal/kill", body)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// CliSessionWSURL builds the WebSocket URL for attaching to a terminal session.
// codeEndpoint is the session's HTTPS code_endpoint.
func CliSessionWSURL(codeEndpoint, terminalID string) string {
	base := strings.TrimRight(codeEndpoint, "/")
	base = strings.Replace(base, "https://", "wss://", 1)
	base = strings.Replace(base, "http://", "ws://", 1)
	return base + "/terminal/ws/" + terminalID
}

// ChatWSURL returns the full WebSocket URL for chat on this session.
// chatEndpoint is the session's ChatEndpoint field (e.g., "wss://sessions.../s/{id}/session").
func ChatWSURL(chatEndpoint, token string) string {
	return appendAccessToken(chatEndpoint, token)
}
