package runtime

import (
	"bufio"
	"os"
	"os/exec"
)

// execCommandContext is a hookable function for creating commands with context.
// Tests override this to intercept shell-outs.
var execCommandContext = exec.CommandContext //nolint:gochecknoglobals // test hook

// execCommand is a hookable function for creating commands without context.
// Tests override this to intercept shell-outs.
var execCommand = exec.Command //nolint:gochecknoglobals // test hook

// stdinBufReader is a hookable buffered reader for stdin.
// Tests replace this with a bufio.Reader backed by strings.Reader.
var stdinBufReader = bufio.NewReader(os.Stdin) //nolint:gochecknoglobals // test hook
