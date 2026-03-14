package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OIDCDiscovery holds the relevant fields from a standard OpenID Connect
// discovery document (/.well-known/openid-configuration).
type OIDCDiscovery struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	DeviceAuthEndpoint    string `json:"device_authorization_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	JwksURI               string `json:"jwks_uri"`
}

// TokenResponse is the token endpoint response shared by all grant types.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	IDToken      string `json:"id_token"`
}

// DeviceCodeResponse is the initial response from the device authorization endpoint.
type DeviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// UserinfoResponse holds common userinfo claims.
type UserinfoResponse struct {
	Sub               string `json:"sub"`
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	Email             string `json:"email"`
	EmailVerified     bool   `json:"email_verified"`
}

// OIDCClient is an IDP-agnostic OIDC client that discovers endpoints from
// the issuer's well-known configuration.
type OIDCClient struct {
	issuer     string
	discovery  *OIDCDiscovery
	httpClient *http.Client
}

// NewOIDCClient creates a new client for the given issuer URL.
func NewOIDCClient(issuer string) *OIDCClient {
	return &OIDCClient{
		issuer: strings.TrimRight(issuer, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Discover fetches and caches the OIDC discovery document.
func (c *OIDCClient) Discover() (*OIDCDiscovery, error) {
	if c.discovery != nil {
		return c.discovery, nil
	}

	endpoint := c.issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("creating discovery request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching discovery document: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("discovery endpoint returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var disc OIDCDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&disc); err != nil {
		return nil, fmt.Errorf("decoding discovery document: %w", err)
	}

	c.discovery = &disc
	return c.discovery, nil
}

// AuthorizationCodeFlow performs the Authorization Code flow with PKCE.
// It starts a local HTTP server, opens the browser, waits for the callback,
// then exchanges the code for tokens.
//
// The openBrowser function is injected so callers can provide platform-specific
// browser launching (or a no-op in tests).
func (c *OIDCClient) AuthorizationCodeFlow(ctx context.Context, clientID string, openBrowser func(string) error) (*TokenResponse, string, error) {
	disc, err := c.Discover()
	if err != nil {
		return nil, "", err
	}

	verifier, err := GenerateCodeVerifier()
	if err != nil {
		return nil, "", fmt.Errorf("generating code verifier: %w", err)
	}
	challenge := CodeChallenge(verifier)

	// Start a local listener on a random port.
	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp", "127.0.0.1:0")
	if err != nil {
		return nil, "", fmt.Errorf("starting local listener: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	// Build the authorization URL.
	authURL, err := url.Parse(disc.AuthorizationEndpoint)
	if err != nil {
		_ = listener.Close()
		return nil, "", fmt.Errorf("parsing authorization endpoint: %w", err)
	}

	q := authURL.Query()
	q.Set("response_type", "code")
	q.Set("client_id", clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", "openid profile email offline_access")
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	authURL.RawQuery = q.Encode()

	// Channel to receive the authorization code from the callback handler.
	type callbackResult struct {
		code string
		err  error
	}
	resultCh := make(chan callbackResult, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		if errMsg := r.URL.Query().Get("error"); errMsg != "" {
			desc := r.URL.Query().Get("error_description")
			_, _ = fmt.Fprintf(w, "<html><body><h1>Login failed</h1><p>%s: %s</p></body></html>", html.EscapeString(errMsg), html.EscapeString(desc))
			resultCh <- callbackResult{err: fmt.Errorf("authorization error: %s — %s", errMsg, desc)}
			return
		}

		code := r.URL.Query().Get("code")
		if code == "" {
			_, _ = fmt.Fprint(w, "<html><body><h1>Login failed</h1><p>No authorization code received.</p></body></html>")
			resultCh <- callbackResult{err: fmt.Errorf("no authorization code in callback")}
			return
		}

		_, _ = fmt.Fprint(w, "<html><body><h1>Login successful!</h1><p>You can close this tab and return to the terminal.</p></body></html>")
		resultCh <- callbackResult{code: code}
	})

	server := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()

	// Open the browser.
	if err := openBrowser(authURL.String()); err != nil {
		_ = server.Close()
		return nil, "", fmt.Errorf("opening browser: %w", err)
	}

	// Wait for callback or context cancellation.
	var result callbackResult
	select {
	case result = <-resultCh:
	case <-ctx.Done():
		_ = server.Close()
		return nil, "", ctx.Err()
	}

	_ = server.Close()

	if result.err != nil {
		return nil, "", result.err
	}

	// Exchange the authorization code for tokens.
	token, err := c.exchangeCode(clientID, result.code, redirectURI, verifier)
	if err != nil {
		return nil, "", err
	}

	return token, redirectURI, nil
}

// exchangeCode exchanges an authorization code for tokens.
func (c *OIDCClient) exchangeCode(clientID, code, redirectURI, verifier string) (*TokenResponse, error) {
	disc, err := c.Discover()
	if err != nil {
		return nil, err
	}

	data := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {verifier},
	}

	return c.postToken(disc.TokenEndpoint, data)
}

// DeviceCodeFlow performs the OAuth 2.0 Device Authorization Grant.
// The displayCode callback is called with the user code and verification URI
// so the caller can present them to the user.
func (c *OIDCClient) DeviceCodeFlow(ctx context.Context, clientID string, displayCode func(DeviceCodeResponse)) (*TokenResponse, error) {
	disc, err := c.Discover()
	if err != nil {
		return nil, err
	}

	if disc.DeviceAuthEndpoint == "" {
		return nil, fmt.Errorf("issuer does not support device authorization")
	}

	// Request a device code.
	data := url.Values{
		"client_id": {clientID},
		"scope":     {"openid profile email offline_access"},
	}

	deviceReq, err := http.NewRequestWithContext(ctx, http.MethodPost, disc.DeviceAuthEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating device code request: %w", err)
	}
	deviceReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(deviceReq)
	if err != nil {
		return nil, fmt.Errorf("requesting device code: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("device auth endpoint returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var deviceResp DeviceCodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&deviceResp); err != nil {
		return nil, fmt.Errorf("decoding device code response: %w", err)
	}

	displayCode(deviceResp)

	// Poll the token endpoint.
	interval := time.Duration(deviceResp.Interval) * time.Second
	if interval == 0 {
		interval = 5 * time.Second
	}

	deadline := time.Now().Add(time.Duration(deviceResp.ExpiresIn) * time.Second)

	for {
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("device authorization timed out")
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}

		tokenData := url.Values{
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
			"client_id":   {clientID},
			"device_code": {deviceResp.DeviceCode},
		}

		token, err := c.postToken(disc.TokenEndpoint, tokenData)
		if err != nil {
			// Check for "authorization_pending" or "slow_down" errors which
			// are expected during polling.
			errStr := err.Error()
			if strings.Contains(errStr, "authorization_pending") {
				continue
			}
			if strings.Contains(errStr, "slow_down") {
				interval += 5 * time.Second
				continue
			}
			return nil, err
		}

		return token, nil
	}
}

// RefreshToken exchanges a refresh token for a new access token.
func (c *OIDCClient) RefreshToken(clientID, refreshToken string) (*TokenResponse, error) {
	disc, err := c.Discover()
	if err != nil {
		return nil, err
	}

	data := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {clientID},
		"refresh_token": {refreshToken},
	}

	return c.postToken(disc.TokenEndpoint, data)
}

// Userinfo calls the userinfo endpoint with the given access token.
func (c *OIDCClient) Userinfo(accessToken string) (*UserinfoResponse, error) {
	disc, err := c.Discover()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, disc.UserinfoEndpoint, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("creating userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling userinfo endpoint: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("userinfo endpoint returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var info UserinfoResponse
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decoding userinfo response: %w", err)
	}

	return &info, nil
}

// postToken sends a POST request to the token endpoint and decodes the response.
func (c *OIDCClient) postToken(endpoint string, data url.Values) (*TokenResponse, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var token TokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("decoding token response: %w", err)
	}

	return &token, nil
}
