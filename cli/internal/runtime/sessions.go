package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// sessionAPITimeout is the timeout for API requests when fetching session info.
const sessionAPITimeout = 5 * time.Second

// apiSessionResponse mirrors the Python API's SessionResponse fields we need.
type apiSessionResponse struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Model     string           `json:"model"`
	Status    string           `json:"status"`
	CreatedAt string           `json:"created_at"`
	Source    apiSessionSource `json:"source"`
}

// apiSessionSource represents the workspace source (git or local_mount).
type apiSessionSource struct {
	Type string `json:"type"`
	Repo string `json:"repo,omitempty"`
}

// fetchSessions queries the Volundr API for the current session list.
// Returns nil (not an error) if the API is unreachable — the caller
// should display "unavailable" rather than failing.
func fetchSessions(ctx context.Context, baseURL string) ([]SessionInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, sessionAPITimeout)
	defer cancel()

	url := baseURL + "/api/v1/volundr/sessions"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// API not reachable — not an error for status display.
		return nil, nil //nolint:nilerr // unreachable API is expected when server is stopped
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}

	var sessions []apiSessionResponse
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		return nil, nil //nolint:nilerr // malformed response treated as unavailable
	}

	result := make([]SessionInfo, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, SessionInfo{
			ID:        truncateID(s.ID),
			Name:      s.Name,
			Status:    s.Status,
			Model:     s.Model,
			Repo:      s.Source.Repo,
			CreatedAt: s.CreatedAt,
		})
	}
	return result, nil
}

// truncateID returns the first 8 characters of a UUID string.
func truncateID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// countActiveSessions counts sessions in active states (running, starting, provisioning, created).
func countActiveSessions(sessions []SessionInfo) int {
	count := 0
	for _, s := range sessions {
		switch s.Status {
		case "running", "starting", "provisioning", "created":
			count++
		}
	}
	return count
}
