package tui

import (
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestNewClientPool_Empty(t *testing.T) {
	cfg := remote.DefaultConfig()
	pool := NewClientPool(cfg)

	if len(pool.Entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(pool.Entries))
	}

	if len(pool.OrderedKeys()) != 0 {
		t.Errorf("expected 0 ordered keys, got %d", len(pool.OrderedKeys()))
	}
}

func TestNewClientPool_SingleContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "production",
		Server: "https://prod.example.com",
		Token:  "tok-prod",
	}

	pool := NewClientPool(cfg)

	if len(pool.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(pool.Entries))
		return
	}

	entry := pool.GetEntry("prod")
	if entry == nil {
		t.Fatal("expected prod entry to exist")
		return
	}
	if entry.Key != "prod" {
		t.Errorf("expected key %q, got %q", "prod", entry.Key)
	}
	if entry.Name != "production" {
		t.Errorf("expected name %q, got %q", "production", entry.Name)
	}
	if entry.Server != "https://prod.example.com" {
		t.Errorf("expected server %q, got %q", "https://prod.example.com", entry.Server)
	}
	if entry.Status != ClusterConnected {
		t.Errorf("expected status Connected, got %v", entry.Status)
	}
	if entry.Client == nil {
		t.Error("expected non-nil client")
	}
}

func TestNewClientPool_MultipleContexts(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{
		Name:   "production",
		Server: "https://prod.example.com",
		Token:  "tok-prod",
	}
	cfg.Contexts["staging"] = &remote.Context{
		Name:   "staging",
		Server: "https://staging.example.com",
		Token:  "", // no auth
	}
	cfg.Contexts["dev"] = &remote.Context{
		Name:   "dev",
		Server: "https://dev.example.com",
		Token:  "tok-dev",
	}

	pool := NewClientPool(cfg)

	if len(pool.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(pool.Entries))
		return
	}

	// Check ordered keys are sorted.
	keys := pool.OrderedKeys()
	if len(keys) != 3 {
		t.Fatalf("expected 3 keys, got %d", len(keys))
		return
	}
	if keys[0] != "dev" || keys[1] != "prod" || keys[2] != "staging" {
		t.Errorf("expected keys [dev, prod, staging], got %v", keys)
	}

	prod := pool.GetEntry("prod")
	if prod.Status != ClusterConnected {
		t.Errorf("prod: expected Connected, got %v", prod.Status)
	}

	staging := pool.GetEntry("staging")
	if staging.Status != ClusterConnected {
		t.Errorf("staging: expected NoAuth, got %v", staging.Status)
	}

	dev := pool.GetEntry("dev")
	if dev.Status != ClusterConnected {
		t.Errorf("dev: expected Connected, got %v", dev.Status)
	}
}

func TestNewClientPool_NoAuthContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["noauth"] = &remote.Context{
		Name:   "noauth",
		Server: "https://noauth.example.com",
	}

	pool := NewClientPool(cfg)

	entry := pool.GetEntry("noauth")
	if entry == nil {
		t.Fatal("expected entry to exist")
		return
	}
	if entry.Status != ClusterConnected {
		t.Errorf("expected NoAuth, got %v", entry.Status)
	}
}

func TestNewClientPool_SkipsEmptyServer(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["empty"] = &remote.Context{
		Name:   "empty",
		Server: "",
		Token:  "tok",
	}

	pool := NewClientPool(cfg)

	if len(pool.Entries) != 0 {
		t.Errorf("expected 0 entries for empty server, got %d", len(pool.Entries))
	}
}

func TestClientPool_ConnectedClients(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{Name: "a", Server: "https://a.com", Token: "tok-a"}
	cfg.Contexts["b"] = &remote.Context{Name: "b", Server: "https://b.com"}
	cfg.Contexts["c"] = &remote.Context{Name: "c", Server: "https://c.com", Token: "tok-c"}

	pool := NewClientPool(cfg)
	connected := pool.ConnectedClients()

	if len(connected) != 3 {
		t.Fatalf("expected 3 connected, got %d", len(connected))
		return
	}

	// Should be in sorted order.
	if connected[0].Key != "a" {
		t.Errorf("expected first connected key %q, got %q", "a", connected[0].Key)
	}
	if connected[1].Key != "b" {
		t.Errorf("expected second connected key %q, got %q", "b", connected[1].Key)
	}
	if connected[2].Key != "c" {
		t.Errorf("expected third connected key %q, got %q", "c", connected[2].Key)
	}
}

func TestClientPool_GetEntry(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["x"] = &remote.Context{Name: "x", Server: "https://x.com", Token: "tok"}

	pool := NewClientPool(cfg)

	entry := pool.GetEntry("x")
	if entry == nil {
		t.Fatal("expected entry for key x")
		return
	}
	if entry.Key != "x" {
		t.Errorf("expected key %q, got %q", "x", entry.Key)
	}

	if pool.GetEntry("nonexistent") != nil {
		t.Error("expected nil for nonexistent key")
	}
}

func TestClientPool_Summary_Empty(t *testing.T) {
	cfg := remote.DefaultConfig()
	pool := NewClientPool(cfg)

	summary := pool.Summary()
	if summary != "no clusters" {
		t.Errorf("expected %q, got %q", "no clusters", summary)
	}
}

func TestClientPool_Summary_Single(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["prod"] = &remote.Context{Name: "prod", Server: "https://prod.com", Token: "tok"}

	pool := NewClientPool(cfg)
	summary := pool.Summary()

	if summary != "1 cluster (connected)" {
		t.Errorf("expected %q, got %q", "1 cluster (connected)", summary)
	}
}

func TestClientPool_Summary_SingleNoToken(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["noauth"] = &remote.Context{Name: "noauth", Server: "https://noauth.com"}

	pool := NewClientPool(cfg)
	summary := pool.Summary()

	// All contexts with a server are treated as connected.
	if summary != "1 cluster (connected)" {
		t.Errorf("expected %q, got %q", "1 cluster (connected)", summary)
	}
}

func TestClientPool_Summary_Multiple(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{Name: "a", Server: "https://a.com", Token: "tok"}
	cfg.Contexts["b"] = &remote.Context{Name: "b", Server: "https://b.com"}
	cfg.Contexts["c"] = &remote.Context{Name: "c", Server: "https://c.com", Token: "tok"}

	pool := NewClientPool(cfg)
	summary := pool.Summary()

	if !strings.Contains(summary, "3 clusters") {
		t.Errorf("expected summary to contain '3 clusters', got %q", summary)
	}
	if !strings.Contains(summary, "3 connected") {
		t.Errorf("expected summary to contain '3 connected', got %q", summary)
	}
}

func TestNewClientPoolFromFlags(t *testing.T) {
	pool := NewClientPoolFromFlags("https://cli.example.com", "tok-cli")

	if len(pool.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(pool.Entries))
		return
	}

	entry := pool.GetEntry("cli-override")
	if entry == nil {
		t.Fatal("expected cli-override entry")
		return
	}
	if entry.Server != "https://cli.example.com" {
		t.Errorf("expected server %q, got %q", "https://cli.example.com", entry.Server)
	}
	if entry.Status != ClusterConnected {
		t.Errorf("expected Connected, got %v", entry.Status)
	}
	if entry.Name != "CLI Override" {
		t.Errorf("expected name %q, got %q", "CLI Override", entry.Name)
	}
}

func TestNewClientPoolFromFlags_NoToken(t *testing.T) {
	pool := NewClientPoolFromFlags("https://cli.example.com", "")

	entry := pool.GetEntry("cli-override")
	if entry == nil {
		t.Fatal("expected cli-override entry")
		return
	}
	if entry.Status != ClusterConnected {
		t.Errorf("expected NoAuth, got %v", entry.Status)
	}
}

func TestClusterStatus_String(t *testing.T) {
	tests := []struct {
		status ClusterStatus
		want   string
	}{
		{ClusterConnected, "connected"},
		{ClusterUnreachable, "unreachable"},
		{ClusterAuthExpired, "auth expired"},
		{ClusterNoAuth, "no auth"},
		{ClusterStatus(99), "unknown"},
	}

	for _, tt := range tests {
		got := tt.status.String()
		if got != tt.want {
			t.Errorf("ClusterStatus(%d).String() = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestClientPool_ColorForContext(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["a"] = &remote.Context{Name: "a", Server: "https://a.com", Token: "tok"}
	cfg.Contexts["b"] = &remote.Context{Name: "b", Server: "https://b.com", Token: "tok"}

	pool := NewClientPool(cfg)

	colorA := pool.ColorForContext("a")
	colorB := pool.ColorForContext("b")

	if colorA == nil {
		t.Error("expected non-nil color for context a")
	}
	if colorB == nil {
		t.Error("expected non-nil color for context b")
	}

	// Different contexts should get different colors (for first few).
	if colorA == colorB {
		t.Error("expected different colors for different contexts")
	}

	// Non-existent context should get muted color.
	colorMissing := pool.ColorForContext("nonexistent")
	if colorMissing == nil {
		t.Error("expected non-nil color for nonexistent context")
	}
}

func TestClientPool_OrderedKeys(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["z"] = &remote.Context{Name: "z", Server: "https://z.com", Token: "tok"}
	cfg.Contexts["a"] = &remote.Context{Name: "a", Server: "https://a.com", Token: "tok"}
	cfg.Contexts["m"] = &remote.Context{Name: "m", Server: "https://m.com", Token: "tok"}

	pool := NewClientPool(cfg)
	keys := pool.OrderedKeys()

	if len(keys) != 3 {
		t.Fatalf("expected 3 keys, got %d", len(keys))
		return
	}
	if keys[0] != "a" || keys[1] != "m" || keys[2] != "z" {
		t.Errorf("expected [a, m, z], got %v", keys)
	}
}
