package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

func TestTruncate(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"hello", 10, "hello"},
		{"hello world", 5, "he..."},
		{"ab", 5, "ab"},
		{"exactly5", 8, "exactly5"},
		{"toolong", 6, "too..."},
	}
	for _, tt := range tests {
		got := truncate(tt.input, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
		}
	}
}

func TestTyrGet_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	defer server.Close()

	resp, err := tyrGet(server.URL + "/test")
	if err != nil {
		t.Fatalf("tyrGet error: %v", err)
		return
	}
	if len(resp) == 0 {
		t.Error("expected non-empty response")
	}
}

func TestTyrGet_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error"))
	}))
	defer server.Close()

	_, err := tyrGet(server.URL + "/test")
	if err == nil {
		t.Fatal("expected error for 500 response")
		return
	}
}

func TestTyrGet_ConnectionError(t *testing.T) {
	_, err := tyrGet("http://127.0.0.1:1/nonexistent")
	if err == nil {
		t.Fatal("expected error for connection failure")
		return
	}
}

func TestTyrCmd_HasSubcommands(t *testing.T) {
	if !tyrCmd.HasSubCommands() {
		t.Error("tyr command should have subcommands")
	}
}

func TestTyrSagasCmd_HasSubcommands(t *testing.T) {
	if !tyrSagasCmd.HasSubCommands() {
		t.Error("tyr sagas should have subcommands")
	}
}

func TestTyrRaidsCmd_HasSubcommands(t *testing.T) {
	if !tyrRaidsCmd.HasSubCommands() {
		t.Error("tyr raids should have subcommands")
	}
}

// writeTyrConfig creates a config file with tyr enabled pointing to the given address.
func writeTyrConfig(t *testing.T, addr string) {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfgContent := "volundr:\n  mode: mini\n  tyr:\n    enabled: true\n  forge:\n    listen: \"" + addr + "\"\n    max_concurrent: 1\n    auth:\n      mode: none\n"
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
		return
	}
}

func TestTyrBaseURL_NoConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	_, err := tyrBaseURL()
	if err == nil {
		t.Fatal("expected error when no config")
		return
	}
}

func TestTyrBaseURL_TyrDisabled(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(config.EnvHome, tmpDir)

	cfgContent := "volundr:\n  mode: mini\n  tyr:\n    enabled: false\n  forge:\n    listen: \"127.0.0.1:8080\"\n    max_concurrent: 1\n    auth:\n      mode: none\n"
	cfgPath := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
		return
	}

	_, err := tyrBaseURL()
	if err == nil {
		t.Fatal("expected error when tyr disabled")
		return
	}
}

func TestTyrBaseURL_Success(t *testing.T) {
	writeTyrConfig(t, "127.0.0.1:9999")

	url, err := tyrBaseURL()
	if err != nil {
		t.Fatalf("tyrBaseURL: %v", err)
		return
	}
	if url != "http://127.0.0.1:9999" {
		t.Errorf("expected http://127.0.0.1:9999, got %q", url)
	}
}

func TestRunTyrSagasList_Success(t *testing.T) {
	sagas := []map[string]any{
		{"id": "1", "name": "saga1", "slug": "s1", "status": "active", "repos": []string{}, "feature_branch": "feat/s1", "issue_count": 3},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sagas)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrSagasList(nil, nil); err != nil {
		t.Fatalf("runTyrSagasList: %v", err)
		return
	}
}

func TestRunTyrSagasList_JSON(t *testing.T) {
	sagas := []map[string]any{
		{"id": "1", "name": "saga1", "slug": "s1", "status": "active", "repos": []string{}, "feature_branch": "feat/s1", "issue_count": 3},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sagas)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := runTyrSagasList(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runTyrSagasList JSON: %v", err)
		return
	}
}

func TestRunTyrSagasList_Empty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrSagasList(nil, nil); err != nil {
		t.Fatalf("runTyrSagasList empty: %v", err)
		return
	}
}

func TestRunTyrRaidsSummary_Success(t *testing.T) {
	counts := map[string]int{"active": 3, "completed": 5}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(counts)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrRaidsSummary(nil, nil); err != nil {
		t.Fatalf("runTyrRaidsSummary: %v", err)
		return
	}
}

func TestRunTyrRaidsSummary_JSON(t *testing.T) {
	counts := map[string]int{"active": 3}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(counts)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := runTyrRaidsSummary(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runTyrRaidsSummary JSON: %v", err)
		return
	}
}

func TestRunTyrRaidsSummary_Empty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrRaidsSummary(nil, nil); err != nil {
		t.Fatalf("runTyrRaidsSummary empty: %v", err)
		return
	}
}

func TestRunTyrRaidsActive_Success(t *testing.T) {
	sessionID := "sess-1234"
	raids := []map[string]any{
		{"tracker_id": "TRACK-1", "title": "Fix the bug", "status": "in_progress", "confidence": 0.85, "session_id": &sessionID},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(raids)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrRaidsActive(nil, nil); err != nil {
		t.Fatalf("runTyrRaidsActive: %v", err)
		return
	}
}

func TestRunTyrRaidsActive_JSON(t *testing.T) {
	raids := []map[string]any{
		{"tracker_id": "TRACK-1", "title": "Fix the bug", "status": "in_progress", "confidence": 0.85, "session_id": nil},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(raids)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err := runTyrRaidsActive(nil, nil)

	_ = w.Close()
	os.Stdout = old

	if err != nil {
		t.Fatalf("runTyrRaidsActive JSON: %v", err)
		return
	}
}

func TestRunTyrRaidsActive_Empty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrRaidsActive(nil, nil); err != nil {
		t.Fatalf("runTyrRaidsActive empty: %v", err)
		return
	}
}

func TestRunTyrRaidsActive_NoSession(t *testing.T) {
	raids := []map[string]any{
		{"tracker_id": "TRACK-1", "title": "Fix the bug", "status": "in_progress", "confidence": 0.85, "session_id": nil},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(raids)
	}))
	defer srv.Close()

	writeTyrConfig(t, srv.Listener.Addr().String())

	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	if err := runTyrRaidsActive(nil, nil); err != nil {
		t.Fatalf("runTyrRaidsActive no session: %v", err)
		return
	}
}
