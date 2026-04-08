package cli

import (
	"testing"
	"time"

	"github.com/niuulabs/volundr/cli/internal/remote"
)

func TestFormatDuration_TableDriven(t *testing.T) {
	tests := []struct {
		name     string
		duration time.Duration
		expected string
	}{
		{"negative", -5 * time.Minute, "expired"},
		{"zero", 0, "less than a minute"},
		{"10 seconds", 10 * time.Second, "less than a minute"},
		{"29 seconds", 29 * time.Second, "less than a minute"},
		{"5 minutes", 5 * time.Minute, "in 5 minutes"},
		{"59 minutes", 59 * time.Minute, "in 59 minutes"},
		{"exactly 1 hour", 60 * time.Minute, "in 1 hours"},
		{"exactly 2 hours", 2 * time.Hour, "in 2 hours"},
		{"1h 30m", 1*time.Hour + 30*time.Minute, "in 1h 30m"},
		{"3h 15m", 3*time.Hour + 15*time.Minute, "in 3h 15m"},
		{"24 hours", 24 * time.Hour, "in 24 hours"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatDuration(tt.duration)
			if got != tt.expected {
				t.Errorf("formatDuration(%v) = %q, want %q", tt.duration, got, tt.expected)
			}
		})
	}
}

func TestWhoamiCmd_NotLoggedIn(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: "https://example.com",
		Token:  "",
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := whoamiCmd.RunE(whoamiCmd, nil)
	if err == nil {
		t.Fatal("expected error when not logged in")
		return
	}
}

func TestWhoamiCmd_NoIssuer(t *testing.T) {
	cfg := remote.DefaultConfig()
	cfg.Contexts["default"] = &remote.Context{
		Name:   "default",
		Server: "https://example.com",
		Token:  "test-token",
		Issuer: "",
	}
	setupTestConfig(t, cfg)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := whoamiCmd.RunE(whoamiCmd, nil)
	if err == nil {
		t.Fatal("expected error when no issuer configured")
		return
	}
}

func TestWhoamiCmd_NoContext(t *testing.T) {
	setupTestConfig(t, nil)

	oldCtx := cfgContext
	cfgContext = ""
	defer func() { cfgContext = oldCtx }()

	err := whoamiCmd.RunE(whoamiCmd, nil)
	if err == nil {
		t.Fatal("expected error when no contexts configured")
		return
	}
}
