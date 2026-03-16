//go:build embed_migrations

package migrations

import (
	"embed"
	"io/fs"
)

//go:embed sql/*.up.sql
var embeddedMigrations embed.FS

func migrationsFS() fs.FS {
	sub, err := fs.Sub(embeddedMigrations, "sql")
	if err != nil {
		panic("embedded migrations directory missing: " + err.Error())
	}
	return sub
}
