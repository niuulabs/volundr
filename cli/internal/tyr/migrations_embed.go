package tyr

import (
	"embed"
	"io/fs"
)

//go:embed migrations/*.up.sql
var embeddedTyrMigrations embed.FS

// MigrationsFS returns the embedded tyr migration files.
func MigrationsFS() fs.FS {
	sub, err := fs.Sub(embeddedTyrMigrations, "migrations")
	if err != nil {
		panic("embedded tyr migrations directory missing: " + err.Error())
	}
	return sub
}
