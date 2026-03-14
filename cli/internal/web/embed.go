// Package web serves the embedded Volundr frontend.
//
// The web/dist directory is embedded at build time via go:embed.
// A build tag (embed_web) controls whether the real assets or a
// placeholder page is served, so `go build` works even without
// running the frontend build first.
package web

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
)

// RuntimeConfig is served as /config.json so the SPA can discover
// the API base URL and optional OIDC settings at startup.
type RuntimeConfig struct {
	APIBaseURL string      `json:"apiBaseUrl"`
	OIDC       *OIDCConfig `json:"oidc,omitempty"`
}

// OIDCConfig holds optional OIDC provider settings.
type OIDCConfig struct {
	Authority             string `json:"authority"`
	ClientID              string `json:"clientId"`
	RedirectURI           string `json:"redirectUri,omitempty"`
	PostLogoutRedirectURI string `json:"postLogoutRedirectUri,omitempty"`
	Scope                 string `json:"scope,omitempty"`
}

// Handler returns an http.Handler that serves the embedded web UI
// and a dynamic /config.json endpoint.
//
// cfg may be nil, in which case /config.json returns { "apiBaseUrl": "" }.
func Handler(cfg *RuntimeConfig) http.Handler {
	if cfg == nil {
		cfg = &RuntimeConfig{APIBaseURL: ""}
	}

	configJSON, _ := json.Marshal(cfg)

	assets := distFS()

	mux := http.NewServeMux()

	// Serve /config.json dynamically so the SPA picks up the
	// correct API base URL without a rebuild.
	mux.HandleFunc("/config.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(configJSON)
	})

	// Serve everything else from the embedded filesystem, with SPA
	// fallback: unknown paths serve index.html so client-side
	// routing works.
	mux.Handle("/", spaHandler(assets))

	return mux
}

// spaHandler serves files from the given filesystem. If the requested
// path doesn't exist (and isn't a static asset), it falls back to
// index.html for client-side routing.
func spaHandler(assets fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(assets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		// Try to open the file. If it exists, serve it.
		f, err := assets.Open(path)
		if err == nil {
			_ = f.Close()

			// Static assets get long cache; HTML gets no-cache.
			if strings.HasPrefix(path, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}

			fileServer.ServeHTTP(w, r)
			return
		}

		// File not found — serve index.html for SPA routing.
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
