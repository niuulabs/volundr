// Package preflight provides reusable prerequisite validation checks
// for the Volundr CLI init and up commands.
package preflight

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Result represents the outcome of a single preflight check.
type Result struct {
	Name    string // human-readable check name
	OK      bool
	Message string // success or failure detail
}

// CheckBinary verifies that a binary exists on PATH and optionally retrieves its version.
// versionArgs are passed to the binary to get a version string (e.g. "--version").
// Returns a Result with the binary path and version if found.
func CheckBinary(name string, versionArgs ...string) Result {
	path, err := exec.LookPath(name)
	if err != nil {
		return Result{
			Name:    name + " binary",
			OK:      false,
			Message: fmt.Sprintf("%s not found in PATH", name),
		}
	}

	version := ""
	if len(versionArgs) > 0 {
		cmd := exec.Command(path, versionArgs...) //nolint:gosec // args are caller-provided version flags
		out, err := cmd.Output()
		if err == nil {
			version = strings.TrimSpace(string(out))
			// Take only the first line if multi-line.
			if idx := strings.IndexByte(version, '\n'); idx >= 0 {
				version = version[:idx]
			}
		}
	}

	msg := fmt.Sprintf("found at %s", path)
	if version != "" {
		msg = fmt.Sprintf("found at %s (%s)", path, version)
	}

	return Result{
		Name:    name + " binary",
		OK:      true,
		Message: msg,
	}
}

// CheckAPIKey verifies that an Anthropic API key is configured.
// It checks the provided config value and whether credentials.enc exists.
func CheckAPIKey(configKey string, credentialsPath string) Result {
	name := "Anthropic API key"

	if configKey != "" {
		return Result{Name: name, OK: true, Message: "set in config"}
	}

	if credentialsPath != "" {
		if _, err := os.Stat(credentialsPath); err == nil {
			return Result{Name: name, OK: true, Message: "found in credentials.enc"}
		}
	}

	return Result{
		Name:    name,
		OK:      false,
		Message: "not set — sessions will fail without it",
	}
}

// CheckPortAvailable verifies that a TCP port is available for binding.
func CheckPortAvailable(host string, port int) Result {
	name := fmt.Sprintf("port %d", port)
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return Result{
			Name:    name,
			OK:      false,
			Message: fmt.Sprintf("port %d on %s is already in use", port, host),
		}
	}
	_ = ln.Close()

	return Result{
		Name:    name,
		OK:      true,
		Message: fmt.Sprintf("port %d is available", port),
	}
}

// CheckDirWritable verifies that a directory is writable by creating a temporary file.
// If the directory does not exist, it attempts to create it.
func CheckDirWritable(dir string) Result {
	name := "workspace directory"

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{
			Name:    name,
			OK:      false,
			Message: fmt.Sprintf("cannot create directory %s: %v", dir, err),
		}
	}

	tmpFile := filepath.Join(dir, ".volundr-preflight-check")
	if err := os.WriteFile(tmpFile, []byte("ok"), 0o600); err != nil {
		return Result{
			Name:    name,
			OK:      false,
			Message: fmt.Sprintf("directory %s is not writable: %v", dir, err),
		}
	}
	_ = os.Remove(tmpFile)

	return Result{
		Name:    name,
		OK:      true,
		Message: "writable",
	}
}

// FormatResult formats a Result as a human-readable line with a check/cross mark.
func FormatResult(r Result) string {
	mark := "✓"
	if !r.OK {
		mark = "✗"
	}
	return fmt.Sprintf("  %s %s — %s", mark, r.Name, r.Message)
}

// BinaryRemediation returns an actionable error message for a missing binary.
func BinaryRemediation(name string) string {
	switch name {
	case "claude":
		return `Error: claude binary not found in PATH

The Claude Code CLI is required to run coding sessions.
Install it with: npm install -g @anthropic-ai/claude-code`
	case "git":
		return `Error: git binary not found in PATH

Git is required for repository-based sessions.
Install it with your system package manager:
  macOS:  brew install git
  Ubuntu: sudo apt install git
  Fedora: sudo dnf install git`
	default:
		return fmt.Sprintf("Error: %s not found in PATH", name)
	}
}

// APIKeyRemediation returns an actionable error message for a missing API key.
func APIKeyRemediation() string {
	return `Warning: Anthropic API key not configured

Sessions will fail without an API key.
Set it by running 'volundr init' or adding to ~/.volundr/config.yaml:
  anthropic:
    api_key: sk-ant-...

Or set the ANTHROPIC_API_KEY environment variable.`
}

// PortRemediation returns an actionable error message for an unavailable port.
func PortRemediation(host string, port int) string {
	return fmt.Sprintf(`Error: port %d on %s is already in use

Another process is using this port. Either:
  1. Stop the process using port %d
  2. Change the port in ~/.volundr/config.yaml:
       listen:
         port: <new-port>`, port, host, port)
}
