package tyr

// EventSource allows subscribing to session activity events from Forge.
// Implemented by an adapter in forge/server.go to avoid import cycles.
type EventSource interface {
	Subscribe() (id string, ch <-chan SessionEvent)
	Unsubscribe(id string)
}

// SessionEvent mirrors forge.ActivityEvent without importing forge.
type SessionEvent struct {
	SessionID     string
	State         string // active, idle, tool_executing, starting
	SessionStatus string // running, stopped, failed
	OwnerID       string
	Metadata      map[string]any
}

// PRChecker checks PR status for a session's workspace.
type PRChecker interface {
	GetPRStatus(sessionID string) (PRCheckResult, error)
}

// PRCheckResult holds PR check results.
type PRCheckResult struct {
	URL       string
	PRID      string
	State     string // open, closed, merged
	Mergeable bool
	CIPassed  bool
}

// SessionSpawner spawns sessions on Forge. Used by the review engine
// to spawn reviewer sessions.
type SessionSpawner interface {
	SpawnReviewerSession(raid *Raid, saga *Saga, model, systemPrompt, initialPrompt string) (sessionID string, err error)
	SendMessage(sessionID, content string) error
	GetLastAssistantMessage(sessionID string) (string, error)
	StopSession(sessionID string) error
}
