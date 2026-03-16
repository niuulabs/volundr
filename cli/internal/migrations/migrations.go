// Package migrations provides access to database migration SQL files.
//
// Migrations are embedded at build time when using the embed_migrations
// build tag (included automatically with `make build`). Without the tag,
// FS() returns nil and the runtime falls back to finding migrations on
// the filesystem.
package migrations

import "io/fs"

// FS returns the embedded migrations filesystem, or nil if migrations
// are not embedded in this build.
func FS() fs.FS {
	return migrationsFS()
}
