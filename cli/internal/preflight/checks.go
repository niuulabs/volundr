// Package preflight provides reusable prerequisite validation checks
// for the Volundr CLI. Checks are split into two categories:
//
//   - Init checks: warnings displayed after the wizard completes.
//   - Up checks: hard failures that prevent the server from starting.
package preflight

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Result captures the outcome of a single preflight check.
type Result struct {
	Name    string // human-readable check name (e.g. "claude binary")
	OK      bool
	Detail  string // success detail (path, version)
	Message string // failure message with remediation
}

// CheckBinary verifies that a binary is on PATH and optionally captures its
// version output. Version args are passed to the binary to retrieve a version
// string (e.g. "--version").
func CheckBinary(name string, versionArgs ...string) Result {
	r := Result{Name: name + " binary"}

	path, err := exec.LookPath(name)
	if err != nil {
		r.Message = fmt.Sprintf("%s not found in PATH", name)
		return r
	}

	r.OK = true
	r.Detail = path

	if len(versionArgs) > 0 {
		cmd := exec.CommandContext(context.Background(), path, versionArgs...) //nolint:gosec // args are hardcoded caller literals
		out, err := cmd.Output()
		if err == nil {
			version := strings.TrimSpace(string(out))
			// Take first line only.
			if idx := strings.IndexByte(version, '\n'); idx > 0 {
				version = version[:idx]
			}
			r.Detail = fmt.Sprintf("%s (%s)", path, version)
		}
	}

	return r
}

// CheckPortAvailable verifies that a TCP port can be bound on the given host.
func CheckPortAvailable(host string, port int) Result {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	r := Result{Name: fmt.Sprintf("port %d", port)}

	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", addr)
	if err != nil {
		r.Message = fmt.Sprintf("port %d on %s is already in use", port, host)
		return r
	}
	_ = ln.Close()

	r.OK = true
	r.Detail = fmt.Sprintf("%s available", addr)
	return r
}

// CheckDirWritable verifies that a directory exists (or can be created) and is
// writable by creating and removing a temporary file.
func CheckDirWritable(dir string) Result {
	r := Result{Name: "workspace directory"}

	if err := os.MkdirAll(dir, 0o750); err != nil {
		r.Message = fmt.Sprintf("cannot create directory %s: %v", dir, err)
		return r
	}

	tmp := filepath.Join(dir, ".niuu-preflight-check")
	if err := os.WriteFile(tmp, []byte("ok"), 0o600); err != nil {
		r.Message = fmt.Sprintf("directory %s is not writable: %v", dir, err)
		return r
	}
	_ = os.Remove(tmp)

	r.OK = true
	r.Detail = dir
	return r
}

// CheckAPIKeySet returns a passing result if the key is non-empty.
func CheckAPIKeySet(key string) Result {
	r := Result{Name: "Anthropic API key"}
	if key == "" {
		r.Message = "Anthropic API key not set — sessions will fail without it"
		return r
	}
	r.OK = true
	r.Detail = "configured"
	return r
}

// FormatResults renders a slice of Results as a human-readable checklist.
//
//	✓ claude binary found at /usr/local/bin/claude (v2.1.81)
//	✗ Anthropic API key not set — sessions will fail without it
func FormatResults(results []Result) string {
	var b strings.Builder
	for _, r := range results {
		if r.OK {
			fmt.Fprintf(&b, "  ✓ %s: %s\n", r.Name, r.Detail)
			continue
		}
		fmt.Fprintf(&b, "  ✗ %s: %s\n", r.Name, r.Message)
	}
	return b.String()
}

// HasFailures returns true if any result is not OK.
func HasFailures(results []Result) bool {
	for _, r := range results {
		if !r.OK {
			return true
		}
	}
	return false
}
