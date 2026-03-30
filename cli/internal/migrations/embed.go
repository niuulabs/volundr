//go:build embed_migrations

package migrations

import (
	"embed"
	"io/fs"
)

//go:embed sql/*.up.sql
var embeddedMigrations embed.FS

//go:embed tyr_sql/*.up.sql
var embeddedTyrMigrations embed.FS

func migrationsFS() fs.FS {
	sub, err := fs.Sub(embeddedMigrations, "sql")
	if err != nil {
		panic("embedded migrations directory missing: " + err.Error())
	}
	return sub
}

func tyrMigrationsFS() fs.FS {
	sub, err := fs.Sub(embeddedTyrMigrations, "tyr_sql")
	if err != nil {
		panic("embedded tyr migrations directory missing: " + err.Error())
	}
	return sub
}
