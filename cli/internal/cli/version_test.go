package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"runtime"
	"testing"
)

func TestVersionCmd_JSON(t *testing.T) {
	oldJSON := jsonOutput
	jsonOutput = true
	defer func() { jsonOutput = oldJSON }()

	// Capture stdout
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	if err := versionCmd.RunE(versionCmd, nil); err != nil {
		os.Stdout = old
		t.Fatalf("version --json: %v", err)
		return
	}

	_ = w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)

	var result map[string]string
	if err := json.Unmarshal(buf.Bytes(), &result); err != nil {
		t.Fatalf("unmarshal JSON output: %v\noutput: %s", err, buf.String())
		return
	}

	if result["version"] != version {
		t.Errorf("expected version %q, got %q", version, result["version"])
	}
	if result["commit"] != commit {
		t.Errorf("expected commit %q, got %q", commit, result["commit"])
	}
	if result["go"] != runtime.Version() {
		t.Errorf("expected go %q, got %q", runtime.Version(), result["go"])
	}
	if result["os"] != runtime.GOOS {
		t.Errorf("expected os %q, got %q", runtime.GOOS, result["os"])
	}
	if result["arch"] != runtime.GOARCH {
		t.Errorf("expected arch %q, got %q", runtime.GOARCH, result["arch"])
	}
}

func TestVersionCmd_Text(t *testing.T) {
	oldJSON := jsonOutput
	jsonOutput = false
	defer func() { jsonOutput = oldJSON }()

	// Just verify it doesn't error
	if err := versionCmd.RunE(versionCmd, nil); err != nil {
		t.Fatalf("version (text): %v", err)
		return
	}
}
