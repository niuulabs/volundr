package forge

import (
	"context"
	"net"
	"testing"
	"time"
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
	// Use port 0 to get an ephemeral port.
	cfg.Listen.Port = 0
	cfg.Listen.Host = "127.0.0.1"

	srv, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}

	// Find an available port for the test.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	cfg.Listen.Port = port

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
