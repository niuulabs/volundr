package web

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandlerConfigJSON(t *testing.T) {
	tests := []struct {
		name       string
		cfg        *RuntimeConfig
		wantAPIURL string
		wantOIDC   bool
	}{
		{
			name:       "nil config returns empty apiBaseUrl",
			cfg:        nil,
			wantAPIURL: "",
			wantOIDC:   false,
		},
		{
			name:       "config with apiBaseUrl only",
			cfg:        &RuntimeConfig{APIBaseURL: "http://localhost:8081"},
			wantAPIURL: "http://localhost:8081",
			wantOIDC:   false,
		},
		{
			name: "config with OIDC",
			cfg: &RuntimeConfig{
				APIBaseURL: "http://api.example.com",
				OIDC: &OIDCConfig{
					Authority: "https://auth.example.com",
					ClientID:  "test-client",
					Scope:     "openid profile",
				},
			},
			wantAPIURL: "http://api.example.com",
			wantOIDC:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler := Handler(tc.cfg)

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/config.json", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d", w.Code)
			}

			ct := w.Header().Get("Content-Type")
			if ct != "application/json" {
				t.Errorf("expected Content-Type application/json, got %q", ct)
			}

			cc := w.Header().Get("Cache-Control")
			if cc != "no-cache" {
				t.Errorf("expected Cache-Control no-cache, got %q", cc)
			}

			var result RuntimeConfig
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatalf("failed to unmarshal config.json: %v", err)
			}

			if result.APIBaseURL != tc.wantAPIURL {
				t.Errorf("expected apiBaseUrl %q, got %q", tc.wantAPIURL, result.APIBaseURL)
			}

			if tc.wantOIDC && result.OIDC == nil {
				t.Error("expected OIDC config to be present")
			}
			if !tc.wantOIDC && result.OIDC != nil {
				t.Error("expected OIDC config to be nil")
			}
		})
	}
}

func TestHandlerConfigJSONOIDCFields(t *testing.T) {
	cfg := &RuntimeConfig{
		APIBaseURL: "http://api.example.com",
		OIDC: &OIDCConfig{
			Authority:             "https://auth.example.com",
			ClientID:              "my-client",
			RedirectURI:           "http://localhost:3000/callback",
			PostLogoutRedirectURI: "http://localhost:3000",
			Scope:                 "openid profile email",
		},
	}

	handler := Handler(cfg)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/config.json", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var result RuntimeConfig
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if result.OIDC.Authority != "https://auth.example.com" {
		t.Errorf("expected authority %q, got %q", "https://auth.example.com", result.OIDC.Authority)
	}
	if result.OIDC.ClientID != "my-client" {
		t.Errorf("expected clientId %q, got %q", "my-client", result.OIDC.ClientID)
	}
	if result.OIDC.RedirectURI != "http://localhost:3000/callback" {
		t.Errorf("expected redirectUri %q, got %q", "http://localhost:3000/callback", result.OIDC.RedirectURI)
	}
	if result.OIDC.PostLogoutRedirectURI != "http://localhost:3000" {
		t.Errorf("expected postLogoutRedirectUri %q, got %q", "http://localhost:3000", result.OIDC.PostLogoutRedirectURI)
	}
	if result.OIDC.Scope != "openid profile email" {
		t.Errorf("expected scope %q, got %q", "openid profile email", result.OIDC.Scope)
	}
}

func TestHandlerRootServesIndexHTML(t *testing.T) {
	handler := Handler(nil)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		t.Errorf("expected Content-Type containing text/html, got %q", ct)
	}

	body := w.Body.String()
	if !strings.Contains(body, "Volundr") {
		t.Errorf("expected body to contain 'Volundr', got %q", body)
	}
}

func TestHandlerSPAFallback(t *testing.T) {
	tests := []struct {
		name string
		path string
	}{
		{"deep route", "/sessions/abc-123"},
		{"nested route", "/settings/profile/edit"},
		{"unknown file", "/nonexistent-page"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler := Handler(nil)

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("expected status 200 for SPA fallback, got %d", w.Code)
			}

			body := w.Body.String()
			if !strings.Contains(body, "Volundr") {
				t.Errorf("expected SPA fallback to serve index.html containing 'Volundr', got %q", body)
			}
		})
	}
}

func TestSPAHandlerStaticAssetCaching(t *testing.T) {
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(`<html><body>test</body></html>`),
		},
		"assets/main.js": &fstest.MapFile{
			Data: []byte(`console.log("hello")`),
		},
		"favicon.svg": &fstest.MapFile{
			Data: []byte(`<svg></svg>`),
		},
	}

	handler := spaHandler(assets)

	tests := []struct {
		name       string
		path       string
		wantCache  string
		wantInBody string
	}{
		{
			name:       "assets/ path gets immutable cache",
			path:       "/assets/main.js",
			wantCache:  "public, max-age=31536000, immutable",
			wantInBody: "hello",
		},
		{
			name:       "non-asset file has no immutable cache",
			path:       "/favicon.svg",
			wantCache:  "",
			wantInBody: "<svg>",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d", w.Code)
			}

			cc := w.Header().Get("Cache-Control")
			if cc != tc.wantCache {
				t.Errorf("expected Cache-Control %q, got %q", tc.wantCache, cc)
			}

			if !strings.Contains(w.Body.String(), tc.wantInBody) {
				t.Errorf("expected body to contain %q", tc.wantInBody)
			}
		})
	}
}

func TestSPAHandlerFallbackToIndex(t *testing.T) {
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(`<html><body>SPA root</body></html>`),
		},
	}

	handler := spaHandler(assets)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/does/not/exist", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 from SPA fallback, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "SPA root") {
		t.Errorf("expected SPA fallback to serve index.html")
	}
}

func TestDistFSReturnsValidFS(t *testing.T) {
	assets := distFS()
	if assets == nil {
		t.Fatal("distFS() returned nil")
	}

	// index.html must exist in the returned filesystem.
	f, err := assets.Open("index.html")
	if err != nil {
		t.Fatalf("expected index.html to exist in distFS: %v", err)
	}
	_ = f.Close()
}

func TestDistFSIndexHTMLContent(t *testing.T) {
	assets := distFS()

	data, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatalf("failed to read index.html: %v", err)
	}

	if len(data) == 0 {
		t.Error("index.html should not be empty")
	}

	if !strings.Contains(string(data), "Volundr") {
		t.Error("index.html should contain 'Volundr'")
	}
}

func TestHandlerServesExistingStaticFile(t *testing.T) {
	// Go's http.FileServer redirects /index.html to /, so requesting
	// /index.html should return a 301 redirect to /.
	handler := Handler(nil)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/index.html", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMovedPermanently {
		t.Fatalf("expected status 301 (redirect to /), got %d", w.Code)
	}

	loc := w.Header().Get("Location")
	if loc != "./" {
		t.Errorf("expected redirect Location %q, got %q", "./", loc)
	}
}

func TestRuntimeConfigJSONSerialization(t *testing.T) {
	tests := []struct {
		name     string
		cfg      RuntimeConfig
		wantKeys []string
		noKeys   []string
	}{
		{
			name:     "minimal config",
			cfg:      RuntimeConfig{APIBaseURL: "http://localhost"},
			wantKeys: []string{"apiBaseUrl"},
			noKeys:   []string{"oidc"},
		},
		{
			name: "full config with OIDC",
			cfg: RuntimeConfig{
				APIBaseURL: "http://api.example.com",
				OIDC: &OIDCConfig{
					Authority: "https://auth.example.com",
					ClientID:  "client-id",
				},
			},
			wantKeys: []string{"apiBaseUrl", "oidc", "authority", "clientId"},
			noKeys:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.cfg)
			if err != nil {
				t.Fatalf("json.Marshal() error: %v", err)
			}

			s := string(data)
			for _, key := range tc.wantKeys {
				if !strings.Contains(s, key) {
					t.Errorf("expected JSON to contain key %q, got %s", key, s)
				}
			}
			for _, key := range tc.noKeys {
				if strings.Contains(s, key) {
					t.Errorf("expected JSON to NOT contain key %q, got %s", key, s)
				}
			}
		})
	}
}

func TestWithCrossOriginIsolationHeaders(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithCrossOriginIsolation(inner)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	want := map[string]string{
		"Cross-Origin-Embedder-Policy": "credentialless",
		"Cross-Origin-Opener-Policy":   "same-origin",
		"Cross-Origin-Resource-Policy": "cross-origin",
	}
	for header, expected := range want {
		got := w.Header().Get(header)
		if got != expected {
			t.Errorf("expected %s %q, got %q", header, expected, got)
		}
	}
}

func TestOIDCConfigOmitEmpty(t *testing.T) {
	cfg := OIDCConfig{
		Authority: "https://auth.example.com",
		ClientID:  "client-id",
		// RedirectURI, PostLogoutRedirectURI, Scope are empty
	}

	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("json.Marshal() error: %v", err)
	}

	s := string(data)
	if strings.Contains(s, "redirectUri") {
		t.Error("expected empty redirectUri to be omitted")
	}
	if strings.Contains(s, "postLogoutRedirectUri") {
		t.Error("expected empty postLogoutRedirectUri to be omitted")
	}
	if strings.Contains(s, "scope") {
		t.Error("expected empty scope to be omitted")
	}
}
