package proxy

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRouter(t *testing.T) {
	r, err := NewRouter("http://localhost:8081")
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	if r == nil {
		t.Fatal("expected non-nil Router")
	}
}

func TestNewRouterInvalidURL(t *testing.T) {
	_, err := NewRouter("://invalid")
	if err == nil {
		t.Error("expected error for invalid URL")
	}
}

func TestAddRemoveSession(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	route := &SessionRoute{
		SessionID: "test-123",
		Skuld:     "localhost:9001",
		Code:      "localhost:9002",
		Terminal:  "localhost:9003",
	}

	r.AddSession(route)

	r.mu.RLock()
	_, exists := r.sessions["test-123"]
	r.mu.RUnlock()

	if !exists {
		t.Error("expected session to exist after AddSession")
	}

	r.RemoveSession("test-123")

	r.mu.RLock()
	_, exists = r.sessions["test-123"]
	r.mu.RUnlock()

	if exists {
		t.Error("expected session to be removed after RemoveSession")
	}
}

func TestHandlerRootPage(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	handler := r.Handler()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if ct := w.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Errorf("expected Content-Type text/html, got %q", ct)
	}

	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty body")
	}
}

func TestHandlerSPAFallback(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	handler := r.Handler()

	// Unknown paths should serve index.html (SPA client-side routing).
	req := httptest.NewRequest(http.MethodGet, "/sessions/abc-123", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 (SPA fallback), got %d", w.Code)
	}

	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty body from SPA fallback")
	}
}

func TestHandlerConfigJSON(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	handler := r.Handler()

	req := httptest.NewRequest(http.MethodGet, "/config.json", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	body := w.Body.String()
	if body == "" {
		t.Error("expected non-empty config.json body")
	}
}
