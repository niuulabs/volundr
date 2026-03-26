package forge

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDetectXcodeInstallations_EmptySearchPaths(t *testing.T) {
	installs := DetectXcodeInstallations(nil)
	// With nil search paths, should return empty (or whatever default finds).
	// On non-macOS, always empty.
	if runtime.GOOS != "darwin" {
		if len(installs) != 0 {
			t.Errorf("expected 0 installations on non-macOS, got %d", len(installs))
		}
	}
}

func TestDetectXcodeInstallations_NonExistentPath(t *testing.T) {
	installs := DetectXcodeInstallations([]string{"/nonexistent/path/that/does/not/exist"})
	if len(installs) != 0 {
		t.Errorf("expected 0 installations for nonexistent path, got %d", len(installs))
	}
}

func TestDetectXcodeInstallations_EmptyDirectory(t *testing.T) {
	dir := t.TempDir()
	installs := DetectXcodeInstallations([]string{dir})
	if len(installs) != 0 {
		t.Errorf("expected 0 installations in empty dir, got %d", len(installs))
	}
}

func TestDetectXcodeInstallations_NoXcodeAppPattern(t *testing.T) {
	// Create a directory that doesn't match *.app pattern.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "NotXcode"), 0o755); err != nil {
		t.Fatal(err)
	}
	installs := DetectXcodeInstallations([]string{dir})
	if len(installs) != 0 {
		t.Errorf("expected 0 installations, got %d", len(installs))
	}
}

func TestDetectXcodeInstallations_FakeXcodeApp(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("xcode detection requires macOS")
	}

	// Create a fake Xcode.app structure. The detection logic reads
	// version.plist via PlistBuddy which won't find our fake, so this
	// tests the scanning logic returns an entry (possibly with empty version).
	dir := t.TempDir()
	xcodeApp := filepath.Join(dir, "Xcode.app")
	if err := os.MkdirAll(filepath.Join(xcodeApp, "Contents", "Developer"), 0o755); err != nil {
		t.Fatal(err)
	}

	installs := DetectXcodeInstallations([]string{dir})
	// Even if version reading fails, scanning should find the .app directory.
	// The exact behavior depends on whether PlistBuddy exists.
	t.Logf("found %d installations in fake dir", len(installs))
}

func TestIsMacOS(t *testing.T) {
	got := IsMacOS()
	expected := runtime.GOOS == "darwin"
	if got != expected {
		t.Errorf("IsMacOS() = %v, expected %v", got, expected)
	}
}
