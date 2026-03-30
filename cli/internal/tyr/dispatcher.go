package tyr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// DispatcherConfig holds settings for the raid dispatcher.
type DispatcherConfig struct {
	// ForgeBaseURL is the base URL for the Forge API (e.g., "http://127.0.0.1:8081").
	ForgeBaseURL string
	// HTTPTimeout is the timeout for HTTP requests to Forge.
	HTTPTimeout time.Duration
}

// DefaultDispatcherTimeout is the default HTTP timeout for dispatch requests.
const DefaultDispatcherTimeout = 30 * time.Second

// Dispatcher calls Forge to create coding sessions for raids.
type Dispatcher struct {
	cfg    DispatcherConfig
	client *http.Client
	store  *Store
}

// NewDispatcher creates a dispatcher with the given config and store.
func NewDispatcher(cfg DispatcherConfig, store *Store) *Dispatcher {
	timeout := cfg.HTTPTimeout
	if timeout == 0 {
		timeout = DefaultDispatcherTimeout
	}
	return &Dispatcher{
		cfg:    cfg,
		client: &http.Client{Timeout: timeout},
		store:  store,
	}
}

// sessionCreateRequest matches the Forge API session creation payload.
type sessionCreateRequest struct {
	Name   string `json:"name"`
	Repo   string `json:"repo,omitempty"`
	Branch string `json:"branch,omitempty"`
}

// sessionCreateResponse captures the relevant fields from Forge's response.
type sessionCreateResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// DispatchRaid creates a Forge session for the given raid and updates its state.
func (d *Dispatcher) DispatchRaid(ctx context.Context, raidID string) (*Raid, error) {
	raid, err := d.store.GetRaid(ctx, raidID)
	if err != nil {
		return nil, err
	}
	if raid == nil {
		return nil, fmt.Errorf("raid %s not found", raidID)
	}

	if !ValidTransition(raid.Status, RaidStatusDispatched) {
		return nil, fmt.Errorf("cannot dispatch raid in status %s", raid.Status)
	}

	// Look up the saga to determine the repo.
	phase, err := d.store.GetPhase(ctx, raid.PhaseID)
	if err != nil {
		return nil, fmt.Errorf("get phase for raid: %w", err)
	}
	if phase == nil {
		return nil, fmt.Errorf("phase %s not found", raid.PhaseID)
	}

	saga, err := d.store.GetSaga(ctx, phase.SagaID)
	if err != nil {
		return nil, fmt.Errorf("get saga for phase: %w", err)
	}
	if saga == nil {
		return nil, fmt.Errorf("saga %s not found", phase.SagaID)
	}

	repo := ""
	if len(saga.Repos) > 0 {
		repo = saga.Repos[0]
	}

	reqBody := sessionCreateRequest{
		Name:   fmt.Sprintf("raid-%s", raid.ID),
		Repo:   repo,
		Branch: saga.FeatureBranch(),
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal session request: %w", err)
	}

	url := fmt.Sprintf("%s/api/v1/volundr/sessions", d.cfg.ForgeBaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create dispatch request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dispatch to forge: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("forge returned %d: %s", resp.StatusCode, string(respBody))
	}

	var sessionResp sessionCreateResponse
	if err := json.NewDecoder(resp.Body).Decode(&sessionResp); err != nil {
		return nil, fmt.Errorf("decode forge response: %w", err)
	}

	// Update raid to dispatched state.
	raid.Status = RaidStatusDispatched
	raid.SessionID = &sessionResp.ID
	branch := saga.FeatureBranch()
	raid.Branch = &branch
	if err := d.store.UpdateRaid(ctx, raid); err != nil {
		return nil, fmt.Errorf("update raid after dispatch: %w", err)
	}

	return raid, nil
}
