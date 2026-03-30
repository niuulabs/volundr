package tyr

import "embed"

// sqlFS embeds all Tyr migration SQL files. These are the same migrations
// used by full Tyr, ensuring schema compatibility for the k3s migration path.
//
//go:embed sql/*.up.sql
var sqlFS embed.FS
