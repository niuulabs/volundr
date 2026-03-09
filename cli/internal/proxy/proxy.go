// Package proxy implements a reverse proxy for routing requests to
// the Python API and session processes.
package proxy

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync"

	"github.com/niuulabs/volundr/cli/internal/web"
)

// SessionRoute holds routing information for a single session.
type SessionRoute struct {
	SessionID string
	Skuld     string // e.g., "localhost:8081"
	Code      string // e.g., "localhost:8082"
	Terminal  string // e.g., "localhost:8083"
}

// Router manages reverse proxy routing.
type Router struct {
	apiURL    *url.URL
	webConfig *web.RuntimeConfig
	sessions  map[string]*SessionRoute
	mu        sync.RWMutex
}

// NewRouter creates a new Router with the given API backend URL.
func NewRouter(apiURL string) (*Router, error) {
	u, err := url.Parse(apiURL)
	if err != nil {
		return nil, fmt.Errorf("parse API URL %q: %w", apiURL, err)
	}

	return &Router{
		apiURL:   u,
		sessions: make(map[string]*SessionRoute),
	}, nil
}

// SetWebConfig sets the runtime config served to the frontend via /config.json.
func (r *Router) SetWebConfig(cfg *web.RuntimeConfig) {
	r.webConfig = cfg
}

// AddSession registers a session route.
func (r *Router) AddSession(route *SessionRoute) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[route.SessionID] = route
}

// RemoveSession removes a session route.
func (r *Router) RemoveSession(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.sessions, sessionID)
}

// Handler returns an http.Handler that routes requests.
func (r *Router) Handler() http.Handler {
	apiProxy := httputil.NewSingleHostReverseProxy(r.apiURL)

	mux := http.NewServeMux()

	// API routes -> Python API.
	mux.Handle("/api/", apiProxy)
	mux.Handle("/health", apiProxy)

	// Embedded web UI with /config.json and SPA fallback.
	webHandler := web.Handler(r.webConfig)
	mux.Handle("/", webHandler)

	return mux
}

// ListenAndServe starts the proxy server.
func (r *Router) ListenAndServe(ctx context.Context, addr string) error {
	srv := &http.Server{
		Addr:    addr,
		Handler: r.Handler(),
	}

	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("proxy server: %w", err)
	}
	return nil
}
