package tui

import (
	"fmt"
	"image/color"
	"sort"

	"github.com/niuulabs/volundr/cli/internal/api"
	"github.com/niuulabs/volundr/cli/internal/remote"
)

// ClusterStatus represents the connection state of a cluster.
type ClusterStatus int

const (
	// ClusterConnected indicates the cluster has valid credentials.
	ClusterConnected ClusterStatus = iota
	// ClusterUnreachable indicates the cluster could not be reached.
	ClusterUnreachable
	// ClusterAuthExpired indicates the auth token has expired.
	ClusterAuthExpired
	// ClusterNoAuth indicates no auth token is configured.
	ClusterNoAuth
)

// String returns a human-readable representation of the cluster status.
func (s ClusterStatus) String() string {
	switch s {
	case ClusterConnected:
		return "connected"
	case ClusterUnreachable:
		return "unreachable"
	case ClusterAuthExpired:
		return "auth expired"
	case ClusterNoAuth:
		return "no auth"
	}
	return "unknown"
}

// ClusterEntry holds the client and metadata for one context.
type ClusterEntry struct {
	Key    string
	Name   string
	Server string
	Client *api.Client
	Status ClusterStatus
}

// ClientPool manages API clients for all configured contexts.
type ClientPool struct {
	Entries map[string]*ClusterEntry
	// orderedKeys preserves a stable iteration order.
	orderedKeys []string
}

// NewClientPool creates a pool from the config, creating one client per context.
// It does not perform network pings; status is determined from credential state.
func NewClientPool(cfg *remote.Config) *ClientPool {
	pool := &ClientPool{
		Entries: make(map[string]*ClusterEntry, len(cfg.Contexts)),
	}

	keys := make([]string, 0, len(cfg.Contexts))
	for k := range cfg.Contexts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pool.orderedKeys = keys

	for _, key := range keys {
		ctx := cfg.Contexts[key]
		if ctx.Server == "" {
			continue
		}

		status := ClusterNoAuth
		if ctx.Token != "" {
			status = ClusterConnected
		}

		entry := &ClusterEntry{
			Key:    key,
			Name:   ctx.Name,
			Server: ctx.Server,
			Client: api.NewClientWithContext(ctx.Server, ctx.Token, ctx, cfg),
			Status: status,
		}

		pool.Entries[key] = entry
	}

	return pool
}

// NewClientPoolFromFlags creates a pool with a single "cli-override" entry
// from explicit --server and --token flags.
func NewClientPoolFromFlags(server, token string) *ClientPool {
	pool := &ClientPool{
		Entries:     make(map[string]*ClusterEntry, 1),
		orderedKeys: []string{"cli-override"},
	}

	status := ClusterNoAuth
	if token != "" {
		status = ClusterConnected
	}

	pool.Entries["cli-override"] = &ClusterEntry{
		Key:    "cli-override",
		Name:   "CLI Override",
		Server: server,
		Client: api.NewClient(server, token),
		Status: status,
	}

	return pool
}

// OrderedKeys returns the context keys in stable sorted order.
func (p *ClientPool) OrderedKeys() []string {
	return p.orderedKeys
}

// ConnectedClients returns only the entries that are connected.
func (p *ClientPool) ConnectedClients() []*ClusterEntry {
	var result []*ClusterEntry
	for _, key := range p.orderedKeys {
		entry := p.Entries[key]
		if entry.Status == ClusterConnected {
			result = append(result, entry)
		}
	}
	return result
}

// GetEntry returns the entry for a given context key, or nil if not found.
func (p *ClientPool) GetEntry(key string) *ClusterEntry {
	return p.Entries[key]
}

// Summary returns a human-readable summary like "2 clusters (1 connected, 1 no auth)".
func (p *ClientPool) Summary() string {
	total := len(p.Entries)
	if total == 0 {
		return "no clusters"
	}

	counts := make(map[ClusterStatus]int)
	for _, entry := range p.Entries {
		counts[entry.Status]++
	}

	connected := counts[ClusterConnected]

	if total == 1 {
		for _, entry := range p.Entries {
			return fmt.Sprintf("1 cluster (%s)", entry.Status.String())
		}
	}

	parts := fmt.Sprintf("%d connected", connected)
	if n := counts[ClusterNoAuth]; n > 0 {
		parts += fmt.Sprintf(", %d no auth", n)
	}
	if n := counts[ClusterUnreachable]; n > 0 {
		parts += fmt.Sprintf(", %d unreachable", n)
	}
	if n := counts[ClusterAuthExpired]; n > 0 {
		parts += fmt.Sprintf(", %d auth expired", n)
	}

	return fmt.Sprintf("%d clusters (%s)", total, parts)
}

// ContextAccentColors maps context keys to rotating accent colors for badges.
var ContextAccentColors = []color.Color{
	DefaultTheme.AccentCyan,
	DefaultTheme.AccentAmber,
	DefaultTheme.AccentPurple,
	DefaultTheme.AccentEmerald,
	DefaultTheme.AccentIndigo,
	DefaultTheme.AccentOrange,
	DefaultTheme.AccentRed,
}

// ColorForContext returns a deterministic accent color for the given context key
// based on its position in the pool's ordered keys.
func (p *ClientPool) ColorForContext(key string) color.Color {
	for i, k := range p.orderedKeys {
		if k == key {
			return ContextAccentColors[i%len(ContextAccentColors)]
		}
	}
	return DefaultTheme.TextMuted
}
