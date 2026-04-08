//go:build !embed_web

package web

import (
	"io/fs"
	"testing/fstest"
)

// distFS returns a minimal in-memory filesystem with a placeholder
// index.html when the real frontend assets are not embedded.
func distFS() fs.FS {
	return fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(`<!DOCTYPE html>
<html>
<head><title>Volundr</title></head>
<body>
<h1>Volundr</h1>
<p>Web UI not embedded. Build with <code>make build</code> to include the frontend,
or run <code>cd web &amp;&amp; npm run build</code> first.</p>
<p>The API is available at <a href="/api/v1/">/api/v1/</a>.</p>
</body>
</html>`),
		},
	}
}
