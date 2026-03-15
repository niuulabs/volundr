//go:build !embed_migrations

package migrations

import "io/fs"

func migrationsFS() fs.FS {
	return nil
}
