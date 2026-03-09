//go:build embed_web

package web

import (
	"embed"
	"io/fs"
)

//go:embed dist/*
var embeddedDist embed.FS

func distFS() fs.FS {
	sub, err := fs.Sub(embeddedDist, "dist")
	if err != nil {
		panic("embedded dist directory missing: " + err.Error())
	}
	return sub
}
