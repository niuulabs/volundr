package api

import (
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

// DiffResponse represents the diff content for a single file.
type DiffResponse struct {
	Path string `json:"path"`
	Diff string `json:"diff"`
}

// FileEntry represents a file in the workspace.
type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

// do executes an HTTP request to the session pod with token auth.
func (s *SessionPodClient) do(method, path string) (*http.Response, error) {
	url := s.baseURL + path
	req, err := http.NewRequest(method, url, nil)
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
	defer resp.Body.Close()

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

// GetFileDiff returns the diff content for a single file.
func (s *SessionPodClient) GetFileDiff(base, filePath string) (string, error) {
	path := fmt.Sprintf("/api/diff?base=%s&file=%s", base, filePath)

	resp, err := s.do("GET", path)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("session pod error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result DiffResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding diff: %w", err)
	}
	return result.Diff, nil
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
	defer resp.Body.Close()

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

// ChatWSURL returns the full WebSocket URL for chat on this session.
// chatEndpoint is the session's ChatEndpoint field (e.g., "wss://sessions.../s/{id}/session").
func ChatWSURL(chatEndpoint, token string) string {
	return appendAccessToken(chatEndpoint, token)
}
