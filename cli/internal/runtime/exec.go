package runtime

import (
	"bufio"
	"context"
	"io/fs"
	"os"
	"os/exec"

	"github.com/niuulabs/volundr/cli/internal/config"
	"github.com/niuulabs/volundr/cli/internal/postgres"
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

// postgresProvider is an interface that abstracts the embedded postgres lifecycle.
type postgresProvider interface {
	Start(ctx context.Context) error
	Stop() error
	RunMigrations(ctx context.Context, dir string) (int, error)
	RunMigrationsFS(ctx context.Context, migrationFS fs.FS) (int, error)
}

// newPostgres is a hookable function for creating a postgres provider.
// Tests override this to avoid downloading/starting real postgres.
var newPostgres = func(cfg *config.Config) postgresProvider { //nolint:gochecknoglobals // test hook
	return postgres.New(cfg)
}
