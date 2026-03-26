package forge

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// XcodeInstallation represents a discovered Xcode installation.
type XcodeInstallation struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	Build   string `json:"build"`
	Active  bool   `json:"active"`
}

// DetectXcodeInstallations scans the configured search paths for Xcode.app
// bundles and returns their versions.
func DetectXcodeInstallations(searchPaths []string) []XcodeInstallation {
	if len(searchPaths) == 0 {
		searchPaths = []string{"/Applications"}
	}

	var installs []XcodeInstallation
	activePath := activeXcodePath()

	for _, dir := range searchPaths {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "Xcode") {
				continue
			}
			if !strings.HasSuffix(entry.Name(), ".app") {
				continue
			}

			appPath := filepath.Join(dir, entry.Name())
			version, build := xcodeVersion(appPath)
			if version == "" {
				continue
			}

			installs = append(installs, XcodeInstallation{
				Path:    appPath,
				Version: version,
				Build:   build,
				Active:  appPath == activePath,
			})
		}
	}

	return installs
}

// SelectXcode switches the active Xcode developer directory using xcode-select.
// Requires appropriate permissions (may need sudo on macOS).
func SelectXcode(appPath string) error {
	devDir := filepath.Join(appPath, "Contents", "Developer")
	if _, err := os.Stat(devDir); err != nil {
		return fmt.Errorf("xcode developer dir not found at %s: %w", devDir, err)
	}

	cmd := exec.Command("sudo", "xcode-select", "-s", devDir) //nolint:gosec // appPath validated above
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("xcode-select failed: %s: %w", strings.TrimSpace(string(output)), err)
	}
	return nil
}

// activeXcodePath returns the current xcode-select path's parent .app bundle.
func activeXcodePath() string {
	cmd := exec.Command("xcode-select", "-p")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	// Output is like "/Applications/Xcode.app/Contents/Developer\n"
	devDir := strings.TrimSpace(string(output))
	// Walk up to find the .app bundle.
	for dir := devDir; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		if strings.HasSuffix(dir, ".app") {
			return dir
		}
	}
	return ""
}

// xcodeVersion reads the version from an Xcode.app bundle's version plist.
func xcodeVersion(appPath string) (version, build string) {
	plistPath := filepath.Join(appPath, "Contents", "version.plist")
	if _, err := os.Stat(plistPath); err != nil {
		return "", ""
	}

	// Use PlistBuddy to read version info (macOS-specific but reliable).
	version = plistValue(plistPath, "CFBundleShortVersionString")
	build = plistValue(plistPath, "ProductBuildVersion")
	return version, build
}

func plistValue(plistPath, key string) string {
	cmd := exec.Command("/usr/libexec/PlistBuddy", "-c", fmt.Sprintf("Print :%s", key), plistPath) //nolint:gosec // key is a fixed string constant
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}
