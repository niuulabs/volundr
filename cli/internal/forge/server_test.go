package forge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/web"
)

func TestNewServer_ValidConfig(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	if srv == nil {
		t.Fatal("expected non-nil server")
	}
	if srv.store == nil {
		t.Error("expected non-nil store")
	}
	if srv.runner == nil {
		t.Error("expected non-nil runner")
	}
	if srv.bus == nil {
		t.Error("expected non-nil event bus")
	}
}

func TestNewServer_InvalidConfig(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Listen.Port = -1

	_, err := NewServer(cfg)
	if err == nil {
		t.Error("expected error for invalid config")
	}
}

func TestNewServer_InvalidAuthMode(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Auth.Mode = "invalid"

	_, err := NewServer(cfg)
	if err == nil {
		t.Error("expected error for invalid auth mode")
	}
}

func TestServer_GracefulShutdown(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Listen.Host = "127.0.0.1"

	// Find an available port for the test.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	cfg.Listen.Port = port

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- srv.Run(ctx)
	}()

	// Give server time to start.
	time.Sleep(100 * time.Millisecond)

	// Cancel the context to trigger shutdown.
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("server returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not shut down within timeout")
	}
}

func TestServer_MaxConcurrentFromConfig(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Forge.MaxConcurrent = 8

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	if srv.cfg.Forge.MaxConcurrent != 8 {
		t.Errorf("expected max_concurrent 8, got %d", srv.cfg.Forge.MaxConcurrent)
	}
}

func TestServer_ConfigTimeoutDefaults(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()

	if cfg.Listen.ReadHeaderTimeout != 10*time.Second {
		t.Errorf("expected ReadHeaderTimeout 10s, got %v", cfg.Listen.ReadHeaderTimeout)
	}
	if cfg.Listen.ShutdownTimeout != 10*time.Second {
		t.Errorf("expected ShutdownTimeout 10s, got %v", cfg.Listen.ShutdownTimeout)
	}
	if cfg.Forge.StopTimeout != 10*time.Second {
		t.Errorf("expected StopTimeout 10s, got %v", cfg.Forge.StopTimeout)
	}
}

func TestDefaultForgeConfig_WebEnabledByDefault(t *testing.T) {
	cfg := DefaultForgeConfig()
	if !cfg.Web {
		t.Error("expected Web to be true by default")
	}
}

// startTestServer creates and starts a forge server on a random port,
// returning the base URL and a cancel function.
func startTestServer(t *testing.T, cfg *Config) (string, context.CancelFunc) {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	cfg.Listen.Host = "127.0.0.1"
	cfg.Listen.Port = port

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		_ = srv.Run(ctx)
	}()

	// Wait for server to be ready.
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(baseURL + "/health")
		if err == nil {
			_ = resp.Body.Close()
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	return baseURL, cancel
}

func TestServer_WebEnabled_ServesConfigJSON(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Web = true

	baseURL, cancel := startTestServer(t, cfg)
	defer cancel()

	resp, err := http.Get(baseURL + "/config.json")
	if err != nil {
		t.Fatalf("GET /config.json: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var rtCfg web.RuntimeConfig
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &rtCfg); err != nil {
		t.Fatalf("decode config.json: %v", err)
	}

	expectedURL := fmt.Sprintf("http://%s:%d", cfg.Listen.Host, cfg.Listen.Port)
	if rtCfg.APIBaseURL != expectedURL {
		t.Errorf("expected apiBaseUrl %q, got %q", expectedURL, rtCfg.APIBaseURL)
	}
}

func TestServer_WebEnabled_SPAFallback(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Web = true

	baseURL, cancel := startTestServer(t, cfg)
	defer cancel()

	// SPA fallback: unknown path should return 200 (index.html), not 404.
	resp, err := http.Get(baseURL + "/sessions/some-id")
	if err != nil {
		t.Fatalf("GET /sessions/some-id: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected SPA fallback 200, got %d", resp.StatusCode)
	}
}

func TestServer_WebEnabled_APIRoutesPrecedence(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Web = true

	baseURL, cancel := startTestServer(t, cfg)
	defer cancel()

	// API routes must still work when web is enabled.
	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for /health, got %d", resp.StatusCode)
	}

	resp2, err := http.Get(baseURL + "/api/v1/volundr/sessions")
	if err != nil {
		t.Fatalf("GET /api/v1/volundr/sessions: %v", err)
	}
	defer func() { _ = resp2.Body.Close() }()

	if resp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for /api/v1/volundr/sessions, got %d", resp2.StatusCode)
	}
}

func TestServer_WebDisabled_NoSPA(t *testing.T) {
	cfg := DefaultForgeConfig()
	cfg.Forge.WorkspacesDir = t.TempDir()
	cfg.Web = false

	baseURL, cancel := startTestServer(t, cfg)
	defer cancel()

	// With web disabled, root path should return 404.
	resp, err := http.Get(baseURL + "/config.json")
	if err != nil {
		t.Fatalf("GET /config.json: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 for /config.json when web disabled, got %d", resp.StatusCode)
	}

	// API routes must still work.
	resp2, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer func() { _ = resp2.Body.Close() }()

	if resp2.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for /health when web disabled, got %d", resp2.StatusCode)
	}
}
