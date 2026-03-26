package forge

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPATAuth_NoneMode(t *testing.T) {
	auth := NewPATAuth(&AuthConfig{Mode: "none"})

	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions", nil)
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

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions", nil)
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

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions", nil)
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

	req := httptest.NewRequest("GET", "/api/v1/volundr/sessions", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
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

	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /health without token, got %d", rec.Code)
	}
}
