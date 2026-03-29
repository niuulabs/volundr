package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/web"
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

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
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
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/sessions/abc-123", nil)
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

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/config.json", nil)
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

func TestSetWebConfig(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	cfg := &web.RuntimeConfig{APIBaseURL: "http://api.example.com"}
	r.SetWebConfig(cfg)

	if r.webConfig != cfg {
		t.Error("expected webConfig to be set")
	}
}

func TestSetWebConfigConfigJSON(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	cfg := &web.RuntimeConfig{
		APIBaseURL: "http://api.example.com",
		OIDC: &web.OIDCConfig{
			Authority: "https://auth.example.com",
			ClientID:  "my-client",
		},
	}
	r.SetWebConfig(cfg)
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/config.json", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var result web.RuntimeConfig
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal config.json: %v", err)
	}
	if result.APIBaseURL != "http://api.example.com" {
		t.Errorf("expected apiBaseUrl %q, got %q", "http://api.example.com", result.APIBaseURL)
	}
	if result.OIDC == nil || result.OIDC.ClientID != "my-client" {
		t.Error("expected OIDC config to be present with clientId my-client")
	}
}

func TestSetSessionBackend(t *testing.T) {
	t.Run("valid URL", func(t *testing.T) {
		r, _ := NewRouter("http://localhost:8081")
		err := r.SetSessionBackend("http://127.0.0.1:80")
		if err != nil {
			t.Fatalf("SetSessionBackend() error: %v", err)
		}
		if r.sessionBackend == nil {
			t.Fatal("expected sessionBackend to be set")
		}
		if r.sessionBackend.Host != "127.0.0.1:80" {
			t.Errorf("expected host 127.0.0.1:80, got %s", r.sessionBackend.Host)
		}
	})

	t.Run("invalid URL", func(t *testing.T) {
		r, _ := NewRouter("http://localhost:8081")
		err := r.SetSessionBackend("://invalid")
		if err == nil {
			t.Error("expected error for invalid URL")
		}
	})
}

func TestAddRewriteHost(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	r.AddRewriteHost("internal-host:8080")
	if len(r.rewriteHosts) != 1 {
		t.Fatalf("expected 1 rewrite host, got %d", len(r.rewriteHosts))
	}
	if r.rewriteHosts[0] != "internal-host:8080" {
		t.Errorf("expected rewrite host %q, got %q", "internal-host:8080", r.rewriteHosts[0])
	}

	r.AddRewriteHost("another-host:9090")
	if len(r.rewriteHosts) != 2 {
		t.Fatalf("expected 2 rewrite hosts, got %d", len(r.rewriteHosts))
	}
}

func TestRewriteBody(t *testing.T) {
	tests := []struct {
		name         string
		hosts        []string
		body         string
		externalHost string
		want         string
	}{
		{
			name:         "no rewrite hosts configured",
			hosts:        nil,
			body:         `{"url":"http://internal:8080/api"}`,
			externalHost: "external.com",
			want:         `{"url":"http://internal:8080/api"}`,
		},
		{
			name:         "single host rewrite",
			hosts:        []string{"internal:8080"},
			body:         `{"url":"http://internal:8080/api"}`,
			externalHost: "external.com",
			want:         `{"url":"http://external.com/api"}`,
		},
		{
			name:         "multiple host rewrites",
			hosts:        []string{"host-a:8080", "host-b:9090"},
			body:         `{"a":"http://host-a:8080/x","b":"http://host-b:9090/y"}`,
			externalHost: "public.example.com",
			want:         `{"a":"http://public.example.com/x","b":"http://public.example.com/y"}`,
		},
		{
			name:         "no match in body",
			hosts:        []string{"internal:8080"},
			body:         `{"url":"http://other:9999/api"}`,
			externalHost: "external.com",
			want:         `{"url":"http://other:9999/api"}`,
		},
		{
			name:         "multiple occurrences of same host",
			hosts:        []string{"internal:8080"},
			body:         `internal:8080 and internal:8080`,
			externalHost: "ext.com",
			want:         `ext.com and ext.com`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r, _ := NewRouter("http://localhost:8081")
			for _, h := range tc.hosts {
				r.AddRewriteHost(h)
			}
			got := string(r.rewriteBody([]byte(tc.body), tc.externalHost))
			if got != tc.want {
				t.Errorf("rewriteBody() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestHandlerAPIProxy(t *testing.T) {
	// Create a fake API backend.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"path":%q}`, r.URL.Path) //nolint:gosec // test handler, no real XSS risk
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	handler := r.Handler()

	tests := []struct {
		name string
		path string
	}{
		{"api path", "/api/sessions"},
		{"health path", "/health"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200, got %d", w.Code)
			}

			ct := w.Header().Get("Content-Type")
			if !strings.Contains(ct, "json") {
				t.Errorf("expected JSON content type, got %q", ct)
			}

			if !strings.Contains(w.Body.String(), tc.path) {
				t.Errorf("expected body to contain path %q, got %q", tc.path, w.Body.String())
			}
		})
	}
}

func TestHandlerSessionProxy(t *testing.T) {
	// Create a fake session backend.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = fmt.Fprintf(w, "session:%s", r.URL.Path) //nolint:gosec // test handler, no real XSS risk
	}))
	defer backend.Close()

	r, err := NewRouter("http://localhost:8081")
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	if err := r.SetSessionBackend(backend.URL); err != nil {
		t.Fatalf("SetSessionBackend() error: %v", err)
	}
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/s/abc-123/skuld/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "/s/abc-123/skuld/") {
		t.Errorf("expected body to contain session path, got %q", w.Body.String())
	}
}

func TestHandlerRewriteHostsInAPIResponse(t *testing.T) {
	internalHost := "docker-internal:8080"

	// Backend returns JSON containing internal hostnames.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"url":"http://%s/api/v1"}`, internalHost)
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	r.AddRewriteHost(internalHost)
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", nil)
	req.Host = "browser.example.com"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	body := w.Body.String()
	if strings.Contains(body, internalHost) {
		t.Errorf("response should not contain internal host %q, got %q", internalHost, body)
	}
	if !strings.Contains(body, "browser.example.com") {
		t.Errorf("response should contain external host, got %q", body)
	}
}

func TestHandlerRewriteSkipsNonTextContent(t *testing.T) {
	internalHost := "docker-internal:8080"

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = fmt.Fprintf(w, "binary data with %s inside", internalHost)
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	r.AddRewriteHost(internalHost)
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/binary", nil)
	req.Host = "browser.example.com"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if !strings.Contains(body, internalHost) {
		t.Errorf("binary content should NOT be rewritten, but internal host was removed from %q", body)
	}
}

func TestHandlerRewriteWithTextContentType(t *testing.T) {
	internalHost := "docker-internal:8080"

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = fmt.Fprintf(w, `<a href="http://%s/page">link</a>`, internalHost)
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	r.AddRewriteHost(internalHost)
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/page", nil)
	req.Host = "external.example.com"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if strings.Contains(body, internalHost) {
		t.Errorf("text/html response should be rewritten, but still contains internal host: %q", body)
	}
	if !strings.Contains(body, "external.example.com") {
		t.Errorf("expected rewritten host in response, got %q", body)
	}
}

func TestHandlerRewriteNoHostHeader(t *testing.T) {
	internalHost := "docker-internal:8080"

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"url":"http://%s/api"}`, internalHost)
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	r.AddRewriteHost(internalHost)
	handler := r.Handler()

	// Request with empty Host header — rewrite should be skipped.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", nil)
	req.Host = ""
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	// When Host is empty, ModifyResponse returns early without rewriting.
	if !strings.Contains(body, internalHost) {
		t.Errorf("expected internal host to remain when Host header is empty, got %q", body)
	}
}

func TestRemoveNonexistentSession(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	// Should not panic.
	r.RemoveSession("does-not-exist")

	r.mu.RLock()
	count := len(r.sessions)
	r.mu.RUnlock()

	if count != 0 {
		t.Errorf("expected 0 sessions, got %d", count)
	}
}

func TestAddSessionOverwrite(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	r.AddSession(&SessionRoute{
		SessionID: "s1",
		Skuld:     "localhost:9001",
	})
	r.AddSession(&SessionRoute{
		SessionID: "s1",
		Skuld:     "localhost:9999",
	})

	r.mu.RLock()
	route := r.sessions["s1"]
	r.mu.RUnlock()

	if route.Skuld != "localhost:9999" {
		t.Errorf("expected overwritten Skuld to be localhost:9999, got %s", route.Skuld)
	}
}

func TestListenAndServeContextCancel(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- r.ListenAndServe(ctx, "127.0.0.1:0")
	}()

	// Give the server a moment to start, then cancel.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("expected nil error after context cancel, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListenAndServe did not return after context cancel")
	}
}

func TestHandlerWithoutSessionBackend(t *testing.T) {
	// When no session backend is set, /s/ paths should fall through to SPA.
	r, _ := NewRouter("http://localhost:8081")
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/s/some-session/skuld/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// Without session backend, /s/ falls through to the web handler (SPA fallback).
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 from SPA fallback, got %d", w.Code)
	}
}

func TestDisableWeb(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	r.DisableWeb()

	if r.webEnabled {
		t.Error("expected webEnabled to be false after DisableWeb")
	}
}

func TestHandlerWebDisabledNoSPA(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"path":%q}`, r.URL.Path) //nolint:gosec // test handler
	}))
	defer backend.Close()

	r, _ := NewRouter(backend.URL)
	r.DisableWeb()
	handler := r.Handler()

	// Root path should return 404 (no SPA handler mounted).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 when web is disabled, got %d", w.Code)
	}

	// API routes should still work.
	req2 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/sessions", nil)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Errorf("expected API route to return 200, got %d", w2.Code)
	}
}

func TestHandlerWebDisabledNoConfigJSON(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")
	r.DisableWeb()
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/config.json", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	// /config.json should not return application/json when web is disabled.
	ct := w.Header().Get("Content-Type")
	if ct == "application/json" {
		t.Error("expected /config.json to not be served when web is disabled")
	}
}

func TestHandlerWebEnabledByDefault(t *testing.T) {
	r, _ := NewRouter("http://localhost:8081")

	if !r.webEnabled {
		t.Error("expected webEnabled to be true by default")
	}

	handler := r.Handler()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 with web enabled, got %d", w.Code)
	}
}

func TestHandlerNoRewriteHostsDoesNotModifyResponse(t *testing.T) {
	internalHost := "docker-internal:8080"

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"url":"http://%s/api"}`, internalHost)
	}))
	defer backend.Close()

	r, err := NewRouter(backend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}
	// No rewrite hosts added — response should pass through unchanged.
	handler := r.Handler()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/test", nil)
	req.Host = "browser.example.com"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	if !strings.Contains(body, internalHost) {
		t.Errorf("without rewrite hosts, response should be unchanged, got %q", body)
	}
}
