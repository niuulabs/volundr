// Package proxy implements a reverse proxy for routing requests to
// the Python API and session processes.
package proxy

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/niuulabs/volundr/cli/internal/web"
)

// SessionRoute holds routing information for a single session.
type SessionRoute struct {
	SessionID string
	Skuld     string // e.g., "localhost:8081"
	Code      string // e.g., "localhost:8082"
	Terminal  string // e.g., "localhost:8083"
}

// backendRoute maps a URL path prefix to a backend URL.
type backendRoute struct {
	pathPrefix string
	backend    *url.URL
}

// Router manages reverse proxy routing.
type Router struct {
	apiURL         *url.URL
	sessionBackend *url.URL
	webConfig      *web.RuntimeConfig
	sessions       map[string]*SessionRoute
	mu             sync.RWMutex
	// rewriteHosts lists Docker-internal hostnames that should be replaced
	// with the browser-facing host (derived from the request's Host header).
	rewriteHosts []string
	// extraBackends holds additional path-prefix -> backend routes.
	extraBackends []backendRoute
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

// SetSessionBackend sets the URL for proxying session paths (/s/).
// In k3s mode this points at the k3d ingress (e.g., http://127.0.0.1:80).
func (r *Router) SetSessionBackend(backendURL string) error {
	u, err := url.Parse(backendURL)
	if err != nil {
		return fmt.Errorf("parse session backend URL %q: %w", backendURL, err)
	}
	r.sessionBackend = u
	return nil
}

// AddRewriteHost registers a Docker-internal hostname that should be
// dynamically replaced with the browser-facing host from the request.
func (r *Router) AddRewriteHost(internalHost string) {
	r.rewriteHosts = append(r.rewriteHosts, internalHost)
}

// AddBackend registers an additional path prefix to proxy to a backend URL.
// Requests matching the prefix are forwarded to the given backend.
func (r *Router) AddBackend(pathPrefix, backendURL string) error {
	u, err := url.Parse(backendURL)
	if err != nil {
		return fmt.Errorf("parse backend URL %q: %w", backendURL, err)
	}
	r.extraBackends = append(r.extraBackends, backendRoute{
		pathPrefix: pathPrefix,
		backend:    u,
	})
	return nil
}

// rewriteBody replaces internal hostnames with the external host.
func (r *Router) rewriteBody(body []byte, externalHost string) []byte {
	if len(r.rewriteHosts) == 0 {
		return body
	}
	result := string(body)
	for _, internal := range r.rewriteHosts {
		result = strings.ReplaceAll(result, internal, externalHost)
	}
	return []byte(result)
}

// Handler returns an http.Handler that routes requests.
func (r *Router) Handler() http.Handler {
	apiProxy := httputil.NewSingleHostReverseProxy(r.apiURL)

	// Rewrite Docker-internal hostnames in API responses using the
	// browser's Host header so URLs resolve regardless of access method.
	if len(r.rewriteHosts) > 0 {
		apiProxy.ModifyResponse = func(resp *http.Response) error {
			contentType := resp.Header.Get("Content-Type")
			if !strings.Contains(contentType, "json") && !strings.Contains(contentType, "text") {
				return nil
			}

			externalHost := ""
			if resp.Request != nil {
				externalHost = resp.Request.Host
			}
			if externalHost == "" {
				return nil
			}

			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return err
			}
			_ = resp.Body.Close()

			body = r.rewriteBody(body, externalHost)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			resp.ContentLength = int64(len(body))
			resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
			return nil
		}
	}

	mux := http.NewServeMux()

	// Session paths -> k3d ingress (Traefik).
	if r.sessionBackend != nil {
		sessionProxy := httputil.NewSingleHostReverseProxy(r.sessionBackend)
		mux.Handle("/s/", sessionProxy)
	}

	// Extra backends (e.g., Tyr) — registered before /api/ so more
	// specific prefixes like /api/v1/tyr/ take priority.
	for _, eb := range r.extraBackends {
		proxy := httputil.NewSingleHostReverseProxy(eb.backend)
		mux.Handle(eb.pathPrefix, proxy)
	}

	// API routes -> Python API.
	mux.Handle("/api/", apiProxy)
	mux.Handle("/health", apiProxy)

	// Embedded web UI with /config.json and SPA fallback.
	webHandler := web.Handler(r.webConfig)
	mux.Handle("/", webHandler)

	return web.WithCrossOriginIsolation(mux)
}

// ListenAndServe starts the proxy server.
func (r *Router) ListenAndServe(ctx context.Context, addr string) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           r.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
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
