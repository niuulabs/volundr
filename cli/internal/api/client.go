// Package api provides REST, WebSocket, and SSE clients for the Volundr API.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/niuulabs/volundr/cli/internal/auth"
	"github.com/niuulabs/volundr/cli/internal/remote"
)

// Client is the REST API client for Volundr.
type Client struct {
	baseURL    string
	token      string
	ctx        *remote.Context
	cfg        *remote.Config
	httpClient *http.Client
}

// NewClient creates a new API client with the given base URL and auth token.
func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// NewClientWithContext creates an API client that can auto-refresh expired tokens
// using the given context for OIDC credentials and the config for saving.
func NewClientWithContext(baseURL, token string, rctx *remote.Context, cfg *remote.Config) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		ctx:     rctx,
		cfg:     cfg,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Token returns the current auth token. It ensures the token is valid first.
func (c *Client) Token() string {
	c.ensureValidToken()
	return c.token
}

// BaseURL returns the base URL of the client.
func (c *Client) BaseURL() string {
	return c.baseURL
}

// ensureValidToken checks whether the current token is expired and, if a
// refresh token is available, transparently refreshes it.
func (c *Client) ensureValidToken() {
	if c.ctx == nil || c.ctx.RefreshToken == "" || c.ctx.TokenExpiry == "" {
		return
	}

	expiry, err := time.Parse(time.RFC3339, c.ctx.TokenExpiry)
	if err != nil {
		return
	}

	// Refresh if the token expires within the next 30 seconds.
	if time.Until(expiry) > 30*time.Second {
		return
	}

	if c.ctx.Issuer == "" || c.ctx.ClientID == "" {
		return
	}

	oidc := auth.NewOIDCClient(c.ctx.Issuer)
	token, err := oidc.RefreshToken(c.ctx.ClientID, c.ctx.RefreshToken)
	if err != nil {
		return
	}

	c.token = token.AccessToken
	c.ctx.Token = token.AccessToken
	if token.RefreshToken != "" {
		c.ctx.RefreshToken = token.RefreshToken
	}
	if token.ExpiresIn > 0 {
		c.ctx.TokenExpiry = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).UTC().Format(time.RFC3339)
	}

	// Best-effort save; ignore errors.
	if c.cfg != nil {
		_ = c.cfg.Save()
	}
}

// Session represents a Volundr coding session.
type Session struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Model        string `json:"model"`
	Repo         string `json:"repo"`
	Branch       string `json:"branch"`
	Status       string `json:"status"`
	ChatEndpoint string `json:"chat_endpoint"`
	CodeEndpoint string `json:"code_endpoint"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	LastActive   string `json:"last_active"`
	MessageCount int    `json:"message_count"`
	TokensUsed   int    `json:"tokens_used"`
	PodName      string `json:"pod_name"`
	Error        string `json:"error"`
	OwnerID      string `json:"owner_id"`
	TenantID     string `json:"tenant_id"`
}

// SessionCreate holds parameters for creating a new session.
type SessionCreate struct {
	Name     string `json:"name"`
	Model    string `json:"model,omitempty"`
	Repo     string `json:"repo,omitempty"`
	Branch   string `json:"branch,omitempty"`
	Template string `json:"template_name,omitempty"`
}

// Chronicle represents an event log entry.
type Chronicle struct {
	ID              string   `json:"id"`
	SessionID       string   `json:"session_id"`
	Status          string   `json:"status"`
	Project         string   `json:"project"`
	Repo            string   `json:"repo"`
	Branch          string   `json:"branch"`
	Model           string   `json:"model"`
	Summary         string   `json:"summary"`
	KeyChanges      []string `json:"key_changes"`
	UnfinishedWork  string   `json:"unfinished_work"`
	TokenUsage      int      `json:"token_usage"`
	Cost            float64  `json:"cost"`
	DurationSeconds int      `json:"duration_seconds"`
	Tags            []string `json:"tags"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

// TimelineEvent represents a single event in a session timeline.
type TimelineEvent struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	Type      string `json:"type"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
	Metadata  any    `json:"metadata"`
}

// ModelInfo describes an available AI model.
type ModelInfo struct {
	ID                   string  `json:"id"`
	Name                 string  `json:"name"`
	Description          string  `json:"description"`
	Provider             string  `json:"provider"`
	Tier                 string  `json:"tier"`
	Color                string  `json:"color"`
	CostPerMillionTokens float64 `json:"cost_per_million_tokens"`
}

// ChatMessage represents a message in the chat interface.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// StatsResponse holds aggregate statistics.
type StatsResponse struct {
	TotalSessions   int     `json:"total_sessions"`
	ActiveSessions  int     `json:"active_sessions"`
	TotalTokens     int     `json:"total_tokens"`
	TotalCost       float64 `json:"total_cost"`
	AvgSessionTime  float64 `json:"avg_session_time_minutes"`
	RunningPods     int     `json:"running_pods"`
}

// do executes an HTTP request with auth headers.
func (c *Client) do(method, path string, body any) (*http.Response, error) {
	c.ensureValidToken()

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshaling request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	url := c.baseURL + path
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}

	return resp, nil
}

// decodeResponse reads and decodes a JSON response body.
func decodeResponse[T any](resp *http.Response) (T, error) {
	var result T
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return result, fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return result, fmt.Errorf("decoding response: %w", err)
	}

	return result, nil
}

// ListSessions returns all sessions for the current user.
func (c *Client) ListSessions() ([]Session, error) {
	resp, err := c.do("GET", "/api/sessions", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]Session](resp)
}

// GetSession returns a single session by ID.
func (c *Client) GetSession(id string) (*Session, error) {
	resp, err := c.do("GET", "/api/sessions/"+id, nil)
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[Session](resp)
}

// CreateSession creates a new session.
func (c *Client) CreateSession(create SessionCreate) (*Session, error) {
	resp, err := c.do("POST", "/api/sessions", create)
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[Session](resp)
}

// StartSession starts a stopped session.
func (c *Client) StartSession(id string) error {
	resp, err := c.do("POST", "/api/sessions/"+id+"/start", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// StopSession stops a running session.
func (c *Client) StopSession(id string) error {
	resp, err := c.do("POST", "/api/sessions/"+id+"/stop", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// DeleteSession deletes a session by ID.
func (c *Client) DeleteSession(id string) error {
	resp, err := c.do("DELETE", "/api/sessions/"+id, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// ListChronicles returns all chronicles.
func (c *Client) ListChronicles() ([]Chronicle, error) {
	resp, err := c.do("GET", "/api/chronicles", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]Chronicle](resp)
}

// GetTimeline returns timeline events for a session.
func (c *Client) GetTimeline(sessionID string) ([]TimelineEvent, error) {
	resp, err := c.do("GET", "/api/sessions/"+sessionID+"/timeline", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]TimelineEvent](resp)
}

// ListModels returns all available AI models.
func (c *Client) ListModels() ([]ModelInfo, error) {
	resp, err := c.do("GET", "/api/models", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]ModelInfo](resp)
}

// GetStats returns aggregate statistics.
func (c *Client) GetStats() (*StatsResponse, error) {
	resp, err := c.do("GET", "/api/stats", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[StatsResponse](resp)
}

// decodeResponsePtr decodes a JSON response into a pointer type.
func decodeResponsePtr[T any](resp *http.Response) (*T, error) {
	result, err := decodeResponse[T](resp)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// AuthDiscoveryResponse holds the OIDC configuration returned by the Volundr server.
type AuthDiscoveryResponse struct {
	Issuer                       string `json:"issuer"`
	ClientID                     string `json:"client_id"`
	Scopes                       string `json:"scopes"`
	DeviceAuthorizationSupported bool   `json:"device_authorization_supported"`
}

// GetAuthConfig fetches OIDC auth configuration from the Volundr server.
// This endpoint is unauthenticated, so no Bearer token is sent.
func (c *Client) GetAuthConfig() (*AuthDiscoveryResponse, error) {
	url := c.baseURL + "/api/v1/volundr/auth/config"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("contacting server: %w", err)
	}

	return decodeResponsePtr[AuthDiscoveryResponse](resp)
}
