package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// newTestDiscoveryServer creates an httptest server that serves OIDC discovery
// and optionally token/userinfo/device endpoints. It returns the server and
// the discovery document it will serve.
func newTestDiscoveryServer(t *testing.T, handlers map[string]http.HandlerFunc) (*httptest.Server, *OIDCDiscovery) {
	t.Helper()

	mux := http.NewServeMux()

	// We need the server URL for the discovery doc, so we create the server
	// first with a temporary handler, then update it.
	srv := httptest.NewServer(mux)

	disc := &OIDCDiscovery{
		Issuer:                srv.URL,
		AuthorizationEndpoint: srv.URL + "/authorize",
		TokenEndpoint:         srv.URL + "/token",
		DeviceAuthEndpoint:    srv.URL + "/device",
		UserinfoEndpoint:      srv.URL + "/userinfo",
		JwksURI:               srv.URL + "/jwks",
	}

	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(disc)
	})

	for path, handler := range handlers {
		mux.HandleFunc(path, handler)
	}

	return srv, disc
}

func TestNewOIDCClient(t *testing.T) {
	t.Run("trims trailing slash from issuer", func(t *testing.T) {
		c := NewOIDCClient("https://idp.example.com/")
		if c.issuer != "https://idp.example.com" {
			t.Errorf("expected trimmed issuer, got %q", c.issuer)
		}
	})

	t.Run("preserves issuer without trailing slash", func(t *testing.T) {
		c := NewOIDCClient("https://idp.example.com")
		if c.issuer != "https://idp.example.com" {
			t.Errorf("expected issuer %q, got %q", "https://idp.example.com", c.issuer)
		}
	})

	t.Run("sets non-nil http client", func(t *testing.T) {
		c := NewOIDCClient("https://idp.example.com")
		if c.httpClient == nil {
			t.Fatal("expected non-nil httpClient")
		}
	})
}

func TestDiscover(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv, wantDisc := newTestDiscoveryServer(t, nil)
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		got, err := c.Discover()
		if err != nil {
			t.Fatalf("Discover: %v", err)
		}
		if got.Issuer != wantDisc.Issuer {
			t.Errorf("expected issuer %q, got %q", wantDisc.Issuer, got.Issuer)
		}
		if got.TokenEndpoint != wantDisc.TokenEndpoint {
			t.Errorf("expected token endpoint %q, got %q", wantDisc.TokenEndpoint, got.TokenEndpoint)
		}
		if got.AuthorizationEndpoint != wantDisc.AuthorizationEndpoint {
			t.Errorf("expected authorization endpoint %q, got %q", wantDisc.AuthorizationEndpoint, got.AuthorizationEndpoint)
		}
		if got.DeviceAuthEndpoint != wantDisc.DeviceAuthEndpoint {
			t.Errorf("expected device auth endpoint %q, got %q", wantDisc.DeviceAuthEndpoint, got.DeviceAuthEndpoint)
		}
		if got.UserinfoEndpoint != wantDisc.UserinfoEndpoint {
			t.Errorf("expected userinfo endpoint %q, got %q", wantDisc.UserinfoEndpoint, got.UserinfoEndpoint)
		}
	})

	t.Run("caches discovery document", func(t *testing.T) {
		callCount := 0
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			callCount++
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(OIDCDiscovery{Issuer: "test"})
		}))
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, _ = c.Discover()
		_, _ = c.Discover()

		if callCount != 1 {
			t.Errorf("expected discovery to be called once (cached), got %d", callCount)
		}
	})

	t.Run("error on non-200 status", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("not found"))
		}))
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.Discover()
		if err == nil {
			t.Fatal("expected error for non-200 response")
		}
		if !strings.Contains(err.Error(), "HTTP 404") {
			t.Errorf("expected error to contain HTTP 404, got %q", err.Error())
		}
	})

	t.Run("error on invalid JSON", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("not valid json"))
		}))
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.Discover()
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
		if !strings.Contains(err.Error(), "decoding discovery document") {
			t.Errorf("expected decoding error, got %q", err.Error())
		}
	})

	t.Run("error on connection failure", func(t *testing.T) {
		c := NewOIDCClient("http://127.0.0.1:1")
		_, err := c.Discover()
		if err == nil {
			t.Fatal("expected error for connection failure")
		}
		if !strings.Contains(err.Error(), "fetching discovery document") {
			t.Errorf("expected fetch error, got %q", err.Error())
		}
	})
}

func TestRefreshToken(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tokenResp := TokenResponse{ //nolint:gosec // test fixture, not real credentials
			AccessToken:  "new-access-token",
			RefreshToken: "new-refresh-token",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/token": func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Errorf("expected POST, got %s", r.Method)
				}
				if err := r.ParseForm(); err != nil { //nolint:gosec // test handler, no real risk
					t.Fatalf("parsing form: %v", err)
				}
				if r.FormValue("grant_type") != "refresh_token" { //nolint:gosec // test handler
					t.Errorf("expected grant_type=refresh_token, got %q", r.FormValue("grant_type")) //nolint:gosec // test handler
				}
				if r.FormValue("client_id") != "my-client" { //nolint:gosec // test handler
					t.Errorf("expected client_id=my-client, got %q", r.FormValue("client_id")) //nolint:gosec // test handler
				}
				if r.FormValue("refresh_token") != "old-refresh" { //nolint:gosec // test handler
					t.Errorf("expected refresh_token=old-refresh, got %q", r.FormValue("refresh_token")) //nolint:gosec // test handler
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(tokenResp) //nolint:gosec // test fixture
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		got, err := c.RefreshToken("my-client", "old-refresh")
		if err != nil {
			t.Fatalf("RefreshToken: %v", err)
		}
		if got.AccessToken != "new-access-token" {
			t.Errorf("expected access token %q, got %q", "new-access-token", got.AccessToken)
		}
		if got.RefreshToken != "new-refresh-token" {
			t.Errorf("expected refresh token %q, got %q", "new-refresh-token", got.RefreshToken)
		}
	})

	t.Run("error on token endpoint failure", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/token": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.RefreshToken("my-client", "bad-refresh")
		if err == nil {
			t.Fatal("expected error for bad refresh token")
		}
		if !strings.Contains(err.Error(), "HTTP 400") {
			t.Errorf("expected HTTP 400 error, got %q", err.Error())
		}
	})

	t.Run("error on discovery failure", func(t *testing.T) {
		c := NewOIDCClient("http://127.0.0.1:1")
		_, err := c.RefreshToken("my-client", "refresh")
		if err == nil {
			t.Fatal("expected error when discovery fails")
		}
	})
}

func TestUserinfo(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		wantInfo := UserinfoResponse{
			Sub:               "user-123",
			Name:              "Test User",
			PreferredUsername: "testuser",
			Email:             "test@example.com",
			EmailVerified:     true,
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/userinfo": func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet {
					t.Errorf("expected GET, got %s", r.Method)
				}
				auth := r.Header.Get("Authorization")
				if auth != "Bearer my-access-token" {
					t.Errorf("expected Bearer my-access-token, got %q", auth)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(wantInfo)
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		got, err := c.Userinfo("my-access-token")
		if err != nil {
			t.Fatalf("Userinfo: %v", err)
		}
		if got.Sub != wantInfo.Sub {
			t.Errorf("expected sub %q, got %q", wantInfo.Sub, got.Sub)
		}
		if got.Name != wantInfo.Name {
			t.Errorf("expected name %q, got %q", wantInfo.Name, got.Name)
		}
		if got.PreferredUsername != wantInfo.PreferredUsername {
			t.Errorf("expected preferred_username %q, got %q", wantInfo.PreferredUsername, got.PreferredUsername)
		}
		if got.Email != wantInfo.Email {
			t.Errorf("expected email %q, got %q", wantInfo.Email, got.Email)
		}
		if !got.EmailVerified {
			t.Error("expected email_verified to be true")
		}
	})

	t.Run("error on non-200 status", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/userinfo": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte("unauthorized"))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.Userinfo("bad-token")
		if err == nil {
			t.Fatal("expected error for 401 response")
		}
		if !strings.Contains(err.Error(), "HTTP 401") {
			t.Errorf("expected HTTP 401 error, got %q", err.Error())
		}
	})

	t.Run("error on invalid JSON response", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/userinfo": func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte("not json"))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.Userinfo("my-token")
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
		if !strings.Contains(err.Error(), "decoding userinfo") {
			t.Errorf("expected decoding error, got %q", err.Error())
		}
	})

	t.Run("error on discovery failure", func(t *testing.T) {
		c := NewOIDCClient("http://127.0.0.1:1")
		_, err := c.Userinfo("tok")
		if err == nil {
			t.Fatal("expected error when discovery fails")
		}
	})
}

func TestExchangeCode(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tokenResp := TokenResponse{ //nolint:gosec // test fixture, not real credentials
			AccessToken:  "access-123",
			RefreshToken: "refresh-456",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
			IDToken:      "id-token-789",
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/token": func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseForm(); err != nil { //nolint:gosec // test handler, no real risk
					t.Fatalf("parsing form: %v", err)
				}
				if r.FormValue("grant_type") != "authorization_code" { //nolint:gosec // test handler
					t.Errorf("expected grant_type=authorization_code, got %q", r.FormValue("grant_type")) //nolint:gosec // test handler
				}
				if r.FormValue("client_id") != "my-client" { //nolint:gosec // test handler
					t.Errorf("expected client_id=my-client, got %q", r.FormValue("client_id")) //nolint:gosec // test handler
				}
				if r.FormValue("code") != "auth-code" { //nolint:gosec // test handler
					t.Errorf("expected code=auth-code, got %q", r.FormValue("code")) //nolint:gosec // test handler
				}
				if r.FormValue("redirect_uri") != "http://localhost:9999/callback" { //nolint:gosec // test handler
					t.Errorf("unexpected redirect_uri %q", r.FormValue("redirect_uri")) //nolint:gosec // test handler
				}
				if r.FormValue("code_verifier") != "my-verifier" { //nolint:gosec // test handler
					t.Errorf("expected code_verifier=my-verifier, got %q", r.FormValue("code_verifier")) //nolint:gosec // test handler
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(tokenResp) //nolint:gosec // test fixture
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		got, err := c.exchangeCode("my-client", "auth-code", "http://localhost:9999/callback", "my-verifier")
		if err != nil {
			t.Fatalf("exchangeCode: %v", err)
		}
		if got.AccessToken != "access-123" {
			t.Errorf("expected access token %q, got %q", "access-123", got.AccessToken)
		}
		if got.IDToken != "id-token-789" {
			t.Errorf("expected id token %q, got %q", "id-token-789", got.IDToken)
		}
	})

	t.Run("error on token endpoint failure", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/token": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.exchangeCode("my-client", "bad-code", "http://localhost/callback", "verifier")
		if err == nil {
			t.Fatal("expected error for bad code exchange")
		}
	})
}

func TestDeviceCodeFlow(t *testing.T) {
	t.Run("success after polling", func(t *testing.T) {
		pollCount := 0
		tokenResp := TokenResponse{ //nolint:gosec // test fixture, not real credentials
			AccessToken:  "device-access-token",
			RefreshToken: "device-refresh-token",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/device": func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Errorf("expected POST, got %s", r.Method)
				}
				if err := r.ParseForm(); err != nil { //nolint:gosec // test handler, no real risk
					t.Fatalf("parsing form: %v", err)
				}
				if r.FormValue("client_id") != "my-client" { //nolint:gosec // test handler
					t.Errorf("expected client_id=my-client, got %q", r.FormValue("client_id")) //nolint:gosec // test handler
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(DeviceCodeResponse{
					DeviceCode:              "device-code-123",
					UserCode:                "ABCD-EFGH",
					VerificationURI:         "https://example.com/verify",
					VerificationURIComplete: "https://example.com/verify?code=ABCD-EFGH",
					ExpiresIn:               300,
					Interval:                1,
				})
			},
			"/token": func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseForm(); err != nil { //nolint:gosec // test handler, no real risk
					t.Fatalf("parsing form: %v", err)
				}
				if r.FormValue("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" { //nolint:gosec // test handler
					t.Errorf("unexpected grant_type %q", r.FormValue("grant_type")) //nolint:gosec // test handler
				}
				pollCount++
				if pollCount < 2 {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(tokenResp) //nolint:gosec // test fixture
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)

		var displayedCode DeviceCodeResponse
		got, err := c.DeviceCodeFlow(context.Background(), "my-client", func(resp DeviceCodeResponse) {
			displayedCode = resp
		})
		if err != nil {
			t.Fatalf("DeviceCodeFlow: %v", err)
		}
		if got.AccessToken != "device-access-token" {
			t.Errorf("expected access token %q, got %q", "device-access-token", got.AccessToken)
		}
		if displayedCode.UserCode != "ABCD-EFGH" {
			t.Errorf("expected user code %q, got %q", "ABCD-EFGH", displayedCode.UserCode)
		}
		if pollCount < 2 {
			t.Errorf("expected at least 2 polls, got %d", pollCount)
		}
	})

	t.Run("no device auth endpoint", func(t *testing.T) {
		// Serve a discovery doc without device_authorization_endpoint.
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(OIDCDiscovery{ //nolint:gosec // test fixture
				Issuer:                "test",
				AuthorizationEndpoint: "http://example.com/auth",
				TokenEndpoint:         "http://example.com/token",
				DeviceAuthEndpoint:    "",
			})
		}))
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.DeviceCodeFlow(context.Background(), "client", func(_ DeviceCodeResponse) {})
		if err == nil {
			t.Fatal("expected error for missing device auth endpoint")
		}
		if !strings.Contains(err.Error(), "does not support device authorization") {
			t.Errorf("unexpected error: %q", err.Error())
		}
	})

	t.Run("context cancellation", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/device": func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(DeviceCodeResponse{
					DeviceCode:      "code",
					UserCode:        "XXXX",
					VerificationURI: "https://example.com/verify",
					ExpiresIn:       300,
					Interval:        1,
				})
			},
			"/token": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
			},
		})
		defer srv.Close()

		ctx, cancel := context.WithCancel(context.Background())
		c := NewOIDCClient(srv.URL)

		// Cancel immediately after display.
		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		_, err := c.DeviceCodeFlow(ctx, "my-client", func(_ DeviceCodeResponse) {})
		if err == nil {
			t.Fatal("expected error on context cancellation")
		}
	})

	t.Run("device auth endpoint error", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/device": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte("server error"))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.DeviceCodeFlow(context.Background(), "client", func(_ DeviceCodeResponse) {})
		if err == nil {
			t.Fatal("expected error for device endpoint failure")
		}
		if !strings.Contains(err.Error(), "HTTP 500") {
			t.Errorf("expected HTTP 500 error, got %q", err.Error())
		}
	})

	t.Run("slow_down increases interval", func(t *testing.T) {
		pollCount := 0
		tokenResp := TokenResponse{ //nolint:gosec // test fixture, not real credentials
			AccessToken: "tok",
			ExpiresIn:   3600,
			TokenType:   "Bearer",
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/device": func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(DeviceCodeResponse{
					DeviceCode:      "code",
					UserCode:        "XXXX",
					VerificationURI: "https://example.com/verify",
					ExpiresIn:       300,
					Interval:        1,
				})
			},
			"/token": func(w http.ResponseWriter, _ *http.Request) {
				pollCount++
				if pollCount == 1 {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":"slow_down"}`))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(tokenResp) //nolint:gosec // test fixture
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		got, err := c.DeviceCodeFlow(context.Background(), "client", func(_ DeviceCodeResponse) {})
		if err != nil {
			t.Fatalf("DeviceCodeFlow: %v", err)
		}
		if got.AccessToken != "tok" {
			t.Errorf("expected access token %q, got %q", "tok", got.AccessToken)
		}
	})

	t.Run("non-pending error terminates polling", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/device": func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(DeviceCodeResponse{
					DeviceCode:      "code",
					UserCode:        "XXXX",
					VerificationURI: "https://example.com/verify",
					ExpiresIn:       300,
					Interval:        1,
				})
			},
			"/token": func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"access_denied"}`))
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)
		_, err := c.DeviceCodeFlow(context.Background(), "client", func(_ DeviceCodeResponse) {})
		if err == nil {
			t.Fatal("expected error for access_denied")
		}
	})

	t.Run("discovery failure", func(t *testing.T) {
		c := NewOIDCClient("http://127.0.0.1:1")
		_, err := c.DeviceCodeFlow(context.Background(), "client", func(_ DeviceCodeResponse) {})
		if err == nil {
			t.Fatal("expected error when discovery fails")
		}
	})
}

func TestAuthorizationCodeFlow(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		tokenResp := TokenResponse{ //nolint:gosec // test fixture, not real credentials
			AccessToken:  "auth-code-access",
			RefreshToken: "auth-code-refresh",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
		}

		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/authorize": func(w http.ResponseWriter, r *http.Request) {
				// The real flow would redirect the browser; in tests we
				// simulate the callback by calling the redirect_uri directly.
				redirectURI := r.URL.Query().Get("redirect_uri")
				code := "test-auth-code"

				// Verify PKCE parameters are present.
				if r.URL.Query().Get("code_challenge") == "" {
					t.Error("expected code_challenge parameter")
				}
				if r.URL.Query().Get("code_challenge_method") != "S256" {
					t.Error("expected code_challenge_method=S256")
				}
				if r.URL.Query().Get("response_type") != "code" {
					t.Error("expected response_type=code")
				}

				// Simulate browser callback.
				go func() {
					time.Sleep(50 * time.Millisecond)
					callbackURL := fmt.Sprintf("%s?code=%s", redirectURI, code)
					req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, callbackURL, nil) //nolint:gosec // test URL from httptest server
					if err != nil {
						return
					}
					resp, err := http.DefaultClient.Do(req) //nolint:gosec // test request to httptest server
					if err != nil {
						return
					}
					_ = resp.Body.Close()
				}()

				w.WriteHeader(http.StatusOK)
			},
			"/token": func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseForm(); err != nil { //nolint:gosec // test handler, no real risk
					t.Fatalf("parsing form: %v", err)
				}
				if r.FormValue("grant_type") != "authorization_code" { //nolint:gosec // test handler
					t.Errorf("expected grant_type=authorization_code, got %q", r.FormValue("grant_type")) //nolint:gosec // test handler
				}
				if r.FormValue("code") != "test-auth-code" { //nolint:gosec // test handler
					t.Errorf("expected code=test-auth-code, got %q", r.FormValue("code")) //nolint:gosec // test handler
				}
				if r.FormValue("code_verifier") == "" { //nolint:gosec // test handler
					t.Error("expected code_verifier to be present")
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(tokenResp) //nolint:gosec // test fixture
			},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)

		openBrowser := func(authURL string) error {
			// Simulate browser: parse the auth URL and call it, which triggers
			// the authorize handler to simulate the callback.
			req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, authURL, nil) //nolint:gosec // test URL
			if err != nil {
				return err
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				return err
			}
			return resp.Body.Close()
		}

		got, redirectURI, err := c.AuthorizationCodeFlow(context.Background(), "my-client", openBrowser)
		if err != nil {
			t.Fatalf("AuthorizationCodeFlow: %v", err)
		}
		if got.AccessToken != "auth-code-access" {
			t.Errorf("expected access token %q, got %q", "auth-code-access", got.AccessToken)
		}
		if !strings.HasPrefix(redirectURI, "http://127.0.0.1:") {
			t.Errorf("expected redirect URI to start with http://127.0.0.1:, got %q", redirectURI)
		}
	})

	t.Run("callback with error", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/authorize": func(_ http.ResponseWriter, _ *http.Request) {},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)

		openBrowser := func(authURL string) error {
			// Parse the redirect_uri from the auth URL and call it with an error.
			parsed, _ := url.Parse(authURL)
			redirectURI := parsed.Query().Get("redirect_uri")
			go func() {
				time.Sleep(50 * time.Millisecond)
				callbackURL := fmt.Sprintf("%s?error=access_denied&error_description=User+denied+access", redirectURI)
				req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, callbackURL, nil) //nolint:gosec // test URL
				if err != nil {
					return
				}
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					return
				}
				_ = resp.Body.Close()
			}()
			return nil
		}

		_, _, err := c.AuthorizationCodeFlow(context.Background(), "my-client", openBrowser)
		if err == nil {
			t.Fatal("expected error for authorization error callback")
		}
		if !strings.Contains(err.Error(), "access_denied") {
			t.Errorf("expected access_denied error, got %q", err.Error())
		}
	})

	t.Run("callback with no code", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/authorize": func(_ http.ResponseWriter, _ *http.Request) {},
		})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)

		openBrowser := func(authURL string) error {
			parsed, _ := url.Parse(authURL)
			redirectURI := parsed.Query().Get("redirect_uri")
			go func() {
				time.Sleep(50 * time.Millisecond)
				req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, redirectURI, nil) //nolint:gosec // test URL
				if err != nil {
					return
				}
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					return
				}
				_ = resp.Body.Close()
			}()
			return nil
		}

		_, _, err := c.AuthorizationCodeFlow(context.Background(), "my-client", openBrowser)
		if err == nil {
			t.Fatal("expected error for missing authorization code")
		}
		if !strings.Contains(err.Error(), "no authorization code") {
			t.Errorf("expected no-code error, got %q", err.Error())
		}
	})

	t.Run("context cancellation", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{
			"/authorize": func(_ http.ResponseWriter, _ *http.Request) {},
		})
		defer srv.Close()

		ctx, cancel := context.WithCancel(context.Background())
		c := NewOIDCClient(srv.URL)

		openBrowser := func(_ string) error {
			// Cancel the context instead of doing a callback.
			go func() {
				time.Sleep(50 * time.Millisecond)
				cancel()
			}()
			return nil
		}

		_, _, err := c.AuthorizationCodeFlow(ctx, "my-client", openBrowser)
		if err == nil {
			t.Fatal("expected error on context cancellation")
		}
	})

	t.Run("browser open failure", func(t *testing.T) {
		srv, _ := newTestDiscoveryServer(t, map[string]http.HandlerFunc{})
		defer srv.Close()

		c := NewOIDCClient(srv.URL)

		openBrowser := func(_ string) error {
			return fmt.Errorf("no browser available")
		}

		_, _, err := c.AuthorizationCodeFlow(context.Background(), "my-client", openBrowser)
		if err == nil {
			t.Fatal("expected error when browser fails to open")
		}
		if !strings.Contains(err.Error(), "opening browser") {
			t.Errorf("expected browser open error, got %q", err.Error())
		}
	})

	t.Run("discovery failure", func(t *testing.T) {
		c := NewOIDCClient("http://127.0.0.1:1")
		_, _, err := c.AuthorizationCodeFlow(context.Background(), "client", func(_ string) error { return nil })
		if err == nil {
			t.Fatal("expected error when discovery fails")
		}
	})
}

func TestPostToken(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
				t.Errorf("expected form content type, got %q", r.Header.Get("Content-Type"))
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(TokenResponse{ //nolint:gosec // test fixture
				AccessToken: "tok",
				ExpiresIn:   3600,
				TokenType:   "Bearer",
			})
		}))
		defer srv.Close()

		c := NewOIDCClient("http://unused")
		data := url.Values{"grant_type": {"test"}}
		got, err := c.postToken(srv.URL, data)
		if err != nil {
			t.Fatalf("postToken: %v", err)
		}
		if got.AccessToken != "tok" {
			t.Errorf("expected access token %q, got %q", "tok", got.AccessToken)
		}
	})

	t.Run("error on non-200", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("unauthorized"))
		}))
		defer srv.Close()

		c := NewOIDCClient("http://unused")
		_, err := c.postToken(srv.URL, url.Values{})
		if err == nil {
			t.Fatal("expected error for 401")
		}
	})

	t.Run("error on invalid JSON", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("not json"))
		}))
		defer srv.Close()

		c := NewOIDCClient("http://unused")
		_, err := c.postToken(srv.URL, url.Values{})
		if err == nil {
			t.Fatal("expected error for invalid JSON")
		}
	})

	t.Run("error on connection failure", func(t *testing.T) {
		c := NewOIDCClient("http://unused")
		_, err := c.postToken("http://127.0.0.1:1/token", url.Values{})
		if err == nil {
			t.Fatal("expected error for connection failure")
		}
	})
}
