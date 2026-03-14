// Package api provides REST, WebSocket, and SSE clients for the Volundr API.
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

// NewClientWithConfig creates an API client that can auto-refresh expired tokens.
//
// Deprecated: Use NewClientWithContext for multi-context support.
func NewClientWithConfig(baseURL, token string, cfg *remote.Config) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		cfg:     cfg,
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

// BaseURL returns the server base URL.
func (c *Client) BaseURL() string {
	return c.baseURL
}

// Token returns the current access token, refreshing it first if needed.
func (c *Client) Token() string {
	c.ensureValidToken()
	return c.token
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
	T      int    `json:"t"`
	Type   string `json:"type"`
	Label  string `json:"label"`
	Tokens *int   `json:"tokens,omitempty"`
	Action string `json:"action,omitempty"`
	Ins    *int   `json:"ins,omitempty"`
	Del    *int   `json:"del,omitempty"`
	Hash   string `json:"hash,omitempty"`
	Exit   *int   `json:"exit,omitempty"`
}

// TimelineFile represents a file summary in the timeline.
type TimelineFile struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	Ins    int    `json:"ins"`
	Del    int    `json:"del"`
}

// TimelineCommit represents a commit summary in the timeline.
type TimelineCommit struct {
	Hash string `json:"hash"`
	Msg  string `json:"msg"`
	Time string `json:"time"`
}

// TimelineResponse represents the full timeline for a session.
type TimelineResponse struct {
	Events    []TimelineEvent  `json:"events"`
	Files     []TimelineFile   `json:"files"`
	Commits   []TimelineCommit `json:"commits"`
	TokenBurn []int            `json:"token_burn"`
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
	ActiveSessions int     `json:"active_sessions"`
	TotalSessions  int     `json:"total_sessions"`
	TokensToday    int     `json:"tokens_today"`
	LocalTokens    int     `json:"local_tokens"`
	CloudTokens    int     `json:"cloud_tokens"`
	CostToday      float64 `json:"cost_today"`
}

// UserProfile represents the current authenticated user.
type UserProfile struct {
	UserID      string   `json:"user_id"`
	Email       string   `json:"email"`
	TenantID    string   `json:"tenant_id"`
	Roles       []string `json:"roles"`
	DisplayName string   `json:"display_name"`
	Status      string   `json:"status"`
}

// UserInfo represents a user in admin views.
type UserInfo struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	HomePVC     string `json:"home_pvc"`
	CreatedAt   string `json:"created_at"`
}

// Tenant represents an organization/tenant.
type Tenant struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	ParentID  string `json:"parent_id,omitempty"`
	CreatedAt string `json:"created_at"`
}

// IntegrationCatalogEntry represents an available integration type.
type IntegrationCatalogEntry struct {
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	IntegrationType string `json:"integration_type"`
	Adapter         string `json:"adapter"`
	Icon            string `json:"icon"`
}

// IntegrationConnection represents a user's configured integration.
type IntegrationConnection struct {
	ID              string         `json:"id"`
	IntegrationType string         `json:"integration_type"`
	Adapter         string         `json:"adapter"`
	CredentialName  string         `json:"credential_name"`
	Config          map[string]any `json:"config"`
	Enabled         bool           `json:"enabled"`
	Slug            string         `json:"slug"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
}

// AdminWorkspace represents a workspace in admin views.
type AdminWorkspace struct {
	ID        string `json:"id"`
	UserID    string `json:"user_id"`
	Status    string `json:"status"`
	PodName   string `json:"pod_name"`
	CreatedAt string `json:"created_at"`
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
	req, err := http.NewRequestWithContext(context.Background(), method, url, bodyReader)
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
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return result, fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	// Check Content-Type to catch HTML responses (e.g. auth redirects).
	ct := resp.Header.Get("Content-Type")
	if ct != "" && !strings.Contains(ct, "json") {
		body, _ := io.ReadAll(resp.Body)
		preview := string(body)
		if len(preview) > 200 {
			preview = preview[:200]
		}
		return result, fmt.Errorf("unexpected response (Content-Type: %s): %s", ct, preview)
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return result, fmt.Errorf("decoding response: %w", err)
	}

	return result, nil
}

// ListSessions returns all sessions for the current user.
func (c *Client) ListSessions() ([]Session, error) {
	resp, err := c.do("GET", "/api/v1/volundr/sessions", nil) //nolint:bodyclose // closed in decodeResponse
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]Session](resp)
}

// GetSession returns a single session by ID.
func (c *Client) GetSession(id string) (*Session, error) {
	resp, err := c.do("GET", "/api/v1/volundr/sessions/"+id, nil) //nolint:bodyclose // closed in decodeResponsePtr
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[Session](resp)
}

// CreateSession creates a new session.
func (c *Client) CreateSession(create SessionCreate) (*Session, error) {
	resp, err := c.do("POST", "/api/v1/volundr/sessions", create) //nolint:bodyclose // closed in decodeResponsePtr
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[Session](resp)
}

// StartSession starts a stopped session.
func (c *Client) StartSession(id string) error {
	resp, err := c.do("POST", "/api/v1/volundr/sessions/"+id+"/start", nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// StopSession stops a running session.
func (c *Client) StopSession(id string) error {
	resp, err := c.do("POST", "/api/v1/volundr/sessions/"+id+"/stop", nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// DeleteSession deletes a session by ID.
func (c *Client) DeleteSession(id string) error {
	resp, err := c.do("DELETE", "/api/v1/volundr/sessions/"+id, nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// ListChronicles returns all chronicles.
func (c *Client) ListChronicles() ([]Chronicle, error) {
	resp, err := c.do(http.MethodGet, "/api/v1/volundr/chronicles", nil) //nolint:bodyclose // body closed in decodeResponse
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]Chronicle](resp)
}

// GetTimeline returns the full timeline for a session's chronicle.
func (c *Client) GetTimeline(sessionID string) (*TimelineResponse, error) {
	resp, err := c.do(http.MethodGet, "/api/v1/volundr/chronicles/"+sessionID+"/timeline", nil) //nolint:bodyclose // body closed in decodeResponsePtr->decodeResponse
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[TimelineResponse](resp)
}

// ListModels returns all available AI models.
func (c *Client) ListModels() ([]ModelInfo, error) {
	resp, err := c.do(http.MethodGet, "/api/v1/volundr/models", nil) //nolint:bodyclose // body closed in decodeResponse
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]ModelInfo](resp)
}

// GetStats returns aggregate statistics.
func (c *Client) GetStats() (*StatsResponse, error) {
	resp, err := c.do("GET", "/api/v1/volundr/stats", nil)
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

// GetMe returns the current authenticated user's profile.
func (c *Client) GetMe() (*UserProfile, error) {
	resp, err := c.do("GET", "/api/v1/volundr/me", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponsePtr[UserProfile](resp)
}

// ListUsers returns all users (admin only).
func (c *Client) ListUsers() ([]UserInfo, error) {
	resp, err := c.do("GET", "/api/v1/volundr/users", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]UserInfo](resp)
}

// ListTenants returns all tenants.
func (c *Client) ListTenants() ([]Tenant, error) {
	resp, err := c.do("GET", "/api/v1/volundr/tenants", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]Tenant](resp)
}

// ListIntegrationCatalog returns all available integration definitions.
func (c *Client) ListIntegrationCatalog() ([]IntegrationCatalogEntry, error) {
	resp, err := c.do("GET", "/api/v1/volundr/integrations/catalog", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]IntegrationCatalogEntry](resp)
}

// ListIntegrations returns the current user's integration connections.
func (c *Client) ListIntegrations() ([]IntegrationConnection, error) {
	resp, err := c.do("GET", "/api/v1/volundr/integrations", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]IntegrationConnection](resp)
}

// TestIntegration tests an integration connection.
func (c *Client) TestIntegration(connectionID string) error {
	resp, err := c.do("POST", "/api/v1/volundr/integrations/"+connectionID+"/test", nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// ListAdminWorkspaces returns all workspaces (admin only).
func (c *Client) ListAdminWorkspaces() ([]AdminWorkspace, error) {
	resp, err := c.do("GET", "/api/v1/volundr/admin/workspaces", nil)
	if err != nil {
		return nil, err
	}
	return decodeResponse[[]AdminWorkspace](resp)
}

// Ping checks if the server is reachable by hitting the stats endpoint.
func (c *Client) Ping() error {
	resp, err := c.do("GET", "/api/v1/volundr/stats", nil)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	return nil
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
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
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
