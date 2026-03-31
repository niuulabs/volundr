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
		return
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
		return
	}

	installs := DetectXcodeInstallations([]string{dir})
	// Even if version reading fails, scanning should find the .app directory.
	// The exact behavior depends on whether PlistBuddy exists.
	t.Logf("found %d installations in fake dir", len(installs))
}

func TestDetectXcodeInstallations_NonAppXcodeDir(t *testing.T) {
	// Create a dir named Xcode but without .app suffix.
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "XcodeStuff"), 0o750); err != nil {
		t.Fatal(err)
		return
	}
	installs := DetectXcodeInstallations([]string{dir})
	if len(installs) != 0 {
		t.Errorf("expected 0 installations for non-.app dir, got %d", len(installs))
	}
}

func TestDetectXcodeInstallations_XcodeAppNoVersionPlist(t *testing.T) {
	// Xcode.app exists but no version.plist — version will be empty, should skip.
	dir := t.TempDir()
	xcodeApp := filepath.Join(dir, "Xcode.app")
	if err := os.MkdirAll(filepath.Join(xcodeApp, "Contents"), 0o750); err != nil {
		t.Fatal(err)
		return
	}
	installs := DetectXcodeInstallations([]string{dir})
	// Without version.plist, xcodeVersion returns "" and entry is skipped.
	if len(installs) != 0 {
		t.Errorf("expected 0 installations without version.plist, got %d", len(installs))
	}
}

func TestSelectXcode_InvalidPath(t *testing.T) {
	err := SelectXcode("/nonexistent/path/Xcode.app")
	if err == nil {
		t.Error("expected error for invalid Xcode path")
	}
}

func TestActiveXcodePath_NoXcodeSelect(t *testing.T) {
	// activeXcodePath should return "" when xcode-select is not found.
	path := activeXcodePath()
	if runtime.GOOS != "darwin" && path != "" {
		t.Errorf("expected empty path on non-macOS, got %q", path)
	}
}

func TestXcodeVersion_NoFile(t *testing.T) {
	version, build := xcodeVersion("/nonexistent/Xcode.app")
	if version != "" || build != "" {
		t.Errorf("expected empty version/build, got %q/%q", version, build)
	}
}

func TestPlistValue_InvalidPath(t *testing.T) {
	val := plistValue("/nonexistent/file.plist", "SomeKey")
	if val != "" {
		t.Errorf("expected empty value, got %q", val)
	}
}

func TestIsMacOS(t *testing.T) {
	got := IsMacOS()
	expected := runtime.GOOS == "darwin"
	if got != expected {
		t.Errorf("IsMacOS() = %v, expected %v", got, expected)
	}
}
