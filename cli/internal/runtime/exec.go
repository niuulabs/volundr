package runtime

import (
	"os/exec"
)

// execCommandContext is a hookable function for creating commands with context.
// Tests override this to intercept shell-outs.
var execCommandContext = exec.CommandContext //nolint:gochecknoglobals // test hook

// execCommand is a hookable function for creating commands without context.
// Tests override this to intercept shell-outs.
var execCommand = exec.Command //nolint:gochecknoglobals // test hook
