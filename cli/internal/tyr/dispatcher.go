package tyr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// dispatchHTTPTimeout is the timeout for dispatch HTTP requests to Forge.
const dispatchHTTPTimeout = 30 * time.Second

// Dispatcher calls Forge's REST API to spawn coding sessions for raids.
type Dispatcher struct {
	forgeURL string
	client   *http.Client
}

// NewDispatcher creates a new Dispatcher pointing at the given Forge base URL.
func NewDispatcher(forgeURL string) *Dispatcher {
	return &Dispatcher{
		forgeURL: strings.TrimRight(forgeURL, "/"),
		client:   &http.Client{Timeout: dispatchHTTPTimeout},
	}
}

// forgeCreateSessionRequest matches Forge's CreateSessionRequest.
type forgeCreateSessionRequest struct {
	Name          string              `json:"name"`
	Model         string              `json:"model,omitempty"`
	Source        *forgeSessionSource `json:"source,omitempty"`
	SystemPrompt  string              `json:"system_prompt,omitempty"`
	InitialPrompt string              `json:"initial_prompt,omitempty"`
	IssueID       string              `json:"issue_id,omitempty"`
	IssueURL      string              `json:"issue_url,omitempty"`
}

type forgeSessionSource struct {
	Type       string `json:"type"`
	Repo       string `json:"repo"`
	Branch     string `json:"branch"`
	BaseBranch string `json:"base_branch,omitempty"`
}

// ForgeSessionResponse is the subset of Forge's SessionResponse we need.
type ForgeSessionResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SpawnSession calls Forge's POST /api/v1/volundr/sessions to create a session for a raid.
func (d *Dispatcher) SpawnSession(ctx context.Context, raid *Raid, saga *Saga, model string) (*ForgeSessionResponse, error) {
	raidBranch := strings.ToLower(raid.TrackerID)
	if raidBranch == "" {
		raidBranch = raid.ID[:8]
	}

	featureBranch := saga.FeatureBranch
	if featureBranch == "" {
		featureBranch = slugToFeatureBranch(saga.Slug)
	}

	repo := ""
	if len(saga.Repos) > 0 {
		repo = saga.Repos[0]
	}

	prompt := buildDispatchPrompt(raid, repo, featureBranch, raidBranch)

	req := forgeCreateSessionRequest{
		Name:  raidBranch,
		Model: model,
		Source: &forgeSessionSource{
			Type:       "git",
			Repo:       repo,
			Branch:     featureBranch,
			BaseBranch: saga.BaseBranch,
		},
		InitialPrompt: prompt,
		IssueID:       raid.TrackerID,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := d.forgeURL + "/api/v1/volundr/sessions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call forge: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("forge returned %d: %s", resp.StatusCode, string(respBody))
	}

	var session ForgeSessionResponse
	if err := json.Unmarshal(respBody, &session); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &session, nil
}

// buildDispatchPrompt creates the initial prompt for a dispatch session.
func buildDispatchPrompt(raid *Raid, repo, featureBranch, raidBranch string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Task: %s — %s\n\n", raid.TrackerID, raid.Name)

	if raid.Description != "" {
		fmt.Fprintf(&b, "%s\n\n", raid.Description)
	}

	if len(raid.AcceptanceCriteria) > 0 {
		b.WriteString("## Acceptance Criteria\n\n")
		for _, ac := range raid.AcceptanceCriteria {
			fmt.Fprintf(&b, "- [ ] %s\n", ac)
		}
		b.WriteString("\n")
	}

	if repo != "" {
		fmt.Fprintf(&b, "Repository: %s\n", repo)
	}
	fmt.Fprintf(&b, "Feature branch: %s\n", featureBranch)
	fmt.Fprintf(&b, "Create a working branch: `%s`\n\n", raidBranch)
	b.WriteString("Implement the task, write tests, create a PR against")
	fmt.Fprintf(&b, " `%s`, and ensure CI passes.\n", featureBranch)

	return b.String()
}
