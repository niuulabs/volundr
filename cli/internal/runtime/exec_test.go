package runtime

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/niuulabs/volundr/cli/internal/config"
)

// TestHelperProcess is used by mockExecCommand to simulate external commands.
// It is not a real test; it is invoked as a subprocess by the mock.
func TestHelperProcess(_ *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	// Suppress coverage/test framework output that would contaminate CombinedOutput.
	devNull, err := os.Open(os.DevNull)
	if err == nil {
		os.Stderr = devNull
	}

	args := os.Args
	// Find the "--" separator.
	idx := -1
	for i, a := range args {
		if a == "--" {
			idx = i
			break
		}
	}
	if idx < 0 || idx+1 >= len(args) {
		if devNull != nil {
			_ = devNull.Close()
		}
		os.Exit(1)
	}
	cmd := args[idx+1:]

	// Check for scripted responses.
	response := os.Getenv("MOCK_RESPONSE")
	exitCode := os.Getenv("MOCK_EXIT_CODE")

	if response != "" {
		_, _ = fmt.Fprint(os.Stdout, response)
	}

	if exitCode == "1" {
		os.Exit(1)
	}

	// Default: check MOCK_COMMANDS for command-specific responses.
	// Format: "cmd1:response1;cmd2:response2".
	mockCommands := os.Getenv("MOCK_COMMANDS")
	if mockCommands != "" {
		cmdStr := strings.Join(cmd, " ")
		for _, entry := range strings.Split(mockCommands, "|||") {
			parts := strings.SplitN(entry, ":::", 2)
			if len(parts) == 2 && strings.Contains(cmdStr, parts[0]) {
				_, _ = fmt.Fprint(os.Stdout, parts[1])
				os.Exit(0)
			}
		}
	}

	os.Exit(0)
}

// fakeExecCommandContext returns a function that creates exec.Cmd pointing
// to TestHelperProcess, with the specified environment variables.
func fakeExecCommandContext(envVars ...string) func(context.Context, string, ...string) *exec.Cmd {
	return func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cs := make([]string, 0, 3+len(args))
		cs = append(cs, "-test.run=TestHelperProcess", "--", name)
		cs = append(cs, args...)
		cmd := exec.CommandContext(ctx, os.Args[0], cs...) //nolint:gosec // test helper
		cmd.Env = append([]string{"GO_WANT_HELPER_PROCESS=1"}, envVars...)
		return cmd
	}
}

// fakeExecCommand returns a function that creates exec.Cmd pointing to TestHelperProcess.
func fakeExecCommand(envVars ...string) func(string, ...string) *exec.Cmd {
	return func(name string, args ...string) *exec.Cmd {
		cs := make([]string, 0, 3+len(args))
		cs = append(cs, "-test.run=TestHelperProcess", "--", name)
		cs = append(cs, args...)
		cmd := exec.CommandContext(context.Background(), os.Args[0], cs...) //nolint:gosec // test helper
		cmd.Env = append([]string{"GO_WANT_HELPER_PROCESS=1"}, envVars...)
		return cmd
	}
}

// fakeExecCommandContextFail returns a function that creates exec.Cmd that always fails.
func fakeExecCommandContextFail() func(context.Context, string, ...string) *exec.Cmd {
	return fakeExecCommandContext("MOCK_EXIT_CODE=1")
}

// fakeExecCommandFail returns a function that creates exec.Cmd that always fails.
func fakeExecCommandFail() func(string, ...string) *exec.Cmd {
	return fakeExecCommand("MOCK_EXIT_CODE=1")
}

// withMockExec replaces execCommandContext and execCommand for the duration of the test.
func withMockExec(t *testing.T, envVars ...string) {
	t.Helper()
	origCtx := execCommandContext
	origCmd := execCommand
	execCommandContext = fakeExecCommandContext(envVars...)
	execCommand = fakeExecCommand(envVars...)
	t.Cleanup(func() {
		execCommandContext = origCtx
		execCommand = origCmd
	})
}

// withMockExecFail replaces execCommandContext and execCommand with failing versions.
func withMockExecFail(t *testing.T) {
	t.Helper()
	origCtx := execCommandContext
	origCmd := execCommand
	execCommandContext = fakeExecCommandContextFail()
	execCommand = fakeExecCommandFail()
	t.Cleanup(func() {
		execCommandContext = origCtx
		execCommand = origCmd
	})
}

// fakePostgres is a mock implementation of postgresProvider for testing.
type fakePostgres struct {
	startErr      error
	stopErr       error
	migrationsErr error
	migrationsN   int
}

func (f *fakePostgres) Start(_ context.Context) error { return f.startErr }
func (f *fakePostgres) Stop() error                   { return f.stopErr }
func (f *fakePostgres) RunMigrations(_ context.Context, _ string) (int, error) {
	return f.migrationsN, f.migrationsErr
}

// withMockPostgres replaces newPostgres with a function returning a fakePostgres.
func withMockPostgres(t *testing.T, fp *fakePostgres) {
	t.Helper()
	orig := newPostgres
	newPostgres = func(_ *config.Config) postgresProvider { return fp }
	t.Cleanup(func() { newPostgres = orig })
}

// withMockStdin replaces stdinBufReader with a reader backed by the given string.
func withMockStdin(t *testing.T, input string) {
	t.Helper()
	orig := stdinBufReader
	stdinBufReader = bufio.NewReader(strings.NewReader(input))
	t.Cleanup(func() {
		stdinBufReader = orig
	})
}
