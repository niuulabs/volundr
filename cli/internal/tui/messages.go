package tui

import "github.com/niuulabs/volundr/cli/internal/api"

// ClusterSession is a session tagged with its cluster context.
type ClusterSession struct {
	api.Session
	ContextKey  string
	ContextName string
}

// AllSessionsLoadedMsg carries sessions from all clusters after a concurrent fetch.
type AllSessionsLoadedMsg struct {
	Sessions []ClusterSession
	Errors   map[string]error // keyed by context key
}

// ClusterStatusMsg updates the status of a specific cluster.
type ClusterStatusMsg struct {
	ContextKey string
	Status     ClusterStatus
	Error      error
}
