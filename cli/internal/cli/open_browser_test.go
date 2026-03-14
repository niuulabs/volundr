package cli

import (
	"runtime"
	"testing"
)

func TestOpenBrowser_UnsupportedPlatform(t *testing.T) {
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" || runtime.GOOS == "windows" {
		t.Skip("skipping: openBrowser launches a real browser on supported platforms")
	}

	err := openBrowser("http://example.com")
	if err == nil {
		t.Error("expected error for unsupported platform")
	}
}
