package forge

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPATAuth_NoneMode(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{Mode: "none"})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestPATAuth_ValidToken(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode: "pat",
		Tokens: []PATEntry{
			{Name: "tyr", Token: "secret-token-123"},
		},
	})

	var gotUserID string
	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = r.Header.Get("X-Auth-User-Id")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	req.Header.Set("Authorization", "Bearer secret-token-123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if gotUserID != "tyr" {
		t.Errorf("expected user ID 'tyr', got %q", gotUserID)
	}
}

func TestPATAuth_InvalidToken(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode: "pat",
		Tokens: []PATEntry{
			{Name: "tyr", Token: "secret-token-123"},
		},
	})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestPATAuth_MissingToken(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode:   "pat",
		Tokens: []PATEntry{{Name: "tyr", Token: "secret"}},
	})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestPATAuth_JWTSubAsOwnerID(t *testing.T) {
	// Build a fake JWT with sub claim: header.payload.signature
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"user-42","iss":"forge"}`))
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	jwtToken := header + "." + payload + ".fake-signature"

	auth := NewPATAuth(&AuthConfig{
		Mode: "pat",
		Tokens: []PATEntry{
			{Name: "tyr-service", Token: jwtToken},
		},
	})

	var gotUserID string
	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = r.Header.Get("X-Auth-User-Id")
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/volundr/sessions", http.NoBody)
	req.Header.Set("Authorization", "Bearer "+jwtToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	// Should use JWT sub claim instead of token name.
	if gotUserID != "user-42" {
		t.Errorf("expected user ID 'user-42' from JWT sub, got %q", gotUserID)
	}
}

func TestExtractJWTSub(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  string
	}{
		{
			name:  "valid JWT with sub",
			token: base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`)) + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"alice"}`)) + ".sig",
			want:  "alice",
		},
		{
			name:  "not a JWT",
			token: "plain-token",
			want:  "",
		},
		{
			name:  "JWT without sub",
			token: base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`)) + "." + base64.RawURLEncoding.EncodeToString([]byte(`{"iss":"forge"}`)) + ".sig",
			want:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractJWTSub(tt.token)
			if got != tt.want {
				t.Errorf("extractJWTSub() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		name string
		auth string
		want string
	}{
		{"empty", "", ""},
		{"bearer token", "Bearer secret", "secret"},
		{"bearer lowercase", "bearer secret", "secret"},
		{"no space", "Bearersecret", ""},
		{"basic auth", "Basic dXNlcjpwYXNz", ""},
		{"just bearer", "Bearer", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", http.NoBody)
			if tt.auth != "" {
				req.Header.Set("Authorization", tt.auth)
			}
			got := extractBearerToken(req)
			if got != tt.want {
				t.Errorf("extractBearerToken() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractJWTSub_InvalidBase64(t *testing.T) {
	// JWT with invalid base64 payload.
	got := extractJWTSub("header.!!!invalid!!!.sig")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestExtractJWTSub_InvalidJSON(t *testing.T) {
	// JWT with valid base64 but invalid JSON payload.
	payload := base64.RawURLEncoding.EncodeToString([]byte("not json"))
	got := extractJWTSub("header." + payload + ".sig")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestPATAuth_HealthBypassesAuth(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode:   "pat",
		Tokens: []PATEntry{{Name: "tyr", Token: "secret"}},
	})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", http.NoBody)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /health without token, got %d", rec.Code)
	}
}

func TestPATAuth_AdminShutdownBypassesAuth(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode:   "pat",
		Tokens: []PATEntry{{Name: "tyr", Token: "secret"}},
	})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Admin endpoints must come from localhost.
	req := httptest.NewRequest(http.MethodPost, "/admin/shutdown", http.NoBody)
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /admin/shutdown from localhost, got %d", rec.Code)
	}
}

func TestPATAuth_AdminShutdownBlocksRemote(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{
		Mode:   "pat",
		Tokens: []PATEntry{{Name: "tyr", Token: "secret"}},
	})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Non-localhost should be rejected.
	req := httptest.NewRequest(http.MethodPost, "/admin/shutdown", http.NoBody)
	req.RemoteAddr = "10.0.0.5:54321"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for /admin/shutdown from remote, got %d", rec.Code)
	}
}
