package forge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Handler holds the HTTP handlers for the Volundr-compatible REST API.
type Handler struct {
	runner *Runner
	store  *Store
	bus    *EventBus
	cfg    *Config
}

// NewHandler creates a new API handler.
func NewHandler(runner *Runner, store *Store, bus *EventBus, cfg *Config) *Handler {
	return &Handler{
		runner: runner,
		store:  store,
		bus:    bus,
		cfg:    cfg,
	}
}

// RegisterRoutes registers all API routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/volundr/sessions", h.createSession)
	mux.HandleFunc("GET /api/v1/volundr/sessions", h.listSessions)
	mux.HandleFunc("GET /api/v1/volundr/sessions/stream", h.streamActivity)
	mux.HandleFunc("GET /api/v1/volundr/sessions/{id}", h.getSession)
	mux.HandleFunc("POST /api/v1/volundr/sessions/{id}/start", h.startSession)
	mux.HandleFunc("POST /api/v1/volundr/sessions/{id}/stop", h.stopSession)
	mux.HandleFunc("DELETE /api/v1/volundr/sessions/{id}", h.deleteSession)
	mux.HandleFunc("POST /api/v1/volundr/sessions/{id}/messages", h.sendMessage)
	mux.HandleFunc("GET /api/v1/volundr/sessions/{id}/pr", h.getPRStatus)
	mux.HandleFunc("GET /api/v1/volundr/sessions/{id}/chronicle", h.getChronicle)
	mux.HandleFunc("GET /api/v1/volundr/stats", h.getStats)
	mux.HandleFunc("GET /api/v1/volundr/me", h.getMe)
	mux.HandleFunc("GET /health", h.health)
}

func (h *Handler) createSession(w http.ResponseWriter, r *http.Request) {
	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	ownerID := r.Header.Get("X-Auth-User-Id")
	if ownerID == "" {
		ownerID = "local"
	}

	sess, err := h.runner.CreateAndStart(r.Context(), req, ownerID)
	if err != nil {
		writeError(w, http.StatusConflict, "%v", err)
		return
	}

	writeJSON(w, http.StatusCreated, sess.ToResponse())
}

func (h *Handler) listSessions(w http.ResponseWriter, _ *http.Request) {
	sessions := h.store.List()
	responses := make([]SessionResponse, len(sessions))
	for i, sess := range sessions {
		responses[i] = sess.ToResponse()
	}
	writeJSON(w, http.StatusOK, responses)
}

func (h *Handler) getSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess := h.store.Get(id)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session %s not found", id)
		return
	}
	writeJSON(w, http.StatusOK, sess.ToResponse())
}

func (h *Handler) startSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess := h.store.Get(id)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session %s not found", id)
		return
	}

	if sess.Status == StatusRunning {
		writeJSON(w, http.StatusOK, sess.ToResponse())
		return
	}

	ownerID := r.Header.Get("X-Auth-User-Id")
	if ownerID == "" {
		ownerID = sess.OwnerID
	}

	req := CreateSessionRequest{
		Name:          sess.Name,
		Model:         sess.Model,
		Source:        sess.Source,
		SystemPrompt:  sess.SystemPrompt,
		InitialPrompt: sess.InitialPrompt,
		IssueID:       sess.IssueID,
		IssueURL:      sess.IssueURL,
	}

	newSess, err := h.runner.CreateAndStart(r.Context(), req, ownerID)
	if err != nil {
		writeError(w, http.StatusConflict, "%v", err)
		return
	}

	writeJSON(w, http.StatusOK, newSess.ToResponse())
}

func (h *Handler) stopSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.runner.Stop(id); err != nil {
		writeError(w, http.StatusNotFound, "%v", err)
		return
	}

	sess := h.store.Get(id)
	if sess == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, sess.ToResponse())
}

func (h *Handler) deleteSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.runner.Delete(id); err != nil {
		writeError(w, http.StatusNotFound, "%v", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) sendMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}

	if err := h.runner.SendMessage(id, req.Content); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "not found") {
			status = http.StatusNotFound
		} else if strings.Contains(err.Error(), "not running") {
			status = http.StatusConflict
		}
		writeError(w, status, "%v", err)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func (h *Handler) getPRStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess := h.store.Get(id)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session %s not found", id)
		return
	}

	// Detect PR by running `gh pr view` in the workspace.
	pr := h.detectPR(sess)
	writeJSON(w, http.StatusOK, pr)
}

func (h *Handler) getChronicle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sess := h.store.Get(id)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session %s not found", id)
		return
	}

	// Read the Claude log for a summary.
	summary := h.readChronicle(sess)
	writeJSON(w, http.StatusOK, ChronicleResponse{Summary: summary})
}

func (h *Handler) streamActivity(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	subID, ch := h.bus.Subscribe()
	defer h.bus.Unsubscribe(subID)

	// Send current state as initial snapshot.
	for _, sess := range h.store.List() {
		state := "idle"
		if sess.Status == StatusRunning {
			state = "active"
		}
		data, _ := json.Marshal(ActivityEvent{
			SessionID:     sess.ID,
			State:         state,
			OwnerID:       sess.OwnerID,
			SessionStatus: string(sess.Status),
		})
		fmt.Fprintf(w, "event: session_activity\ndata: %s\n\n", data)
	}
	flusher.Flush()

	// Stream events.
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "event: session_activity\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (h *Handler) getStats(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, StatsResponse{
		ActiveSessions: h.store.Count(StatusRunning),
		TotalSessions:  h.store.Count(""),
	})
}

func (h *Handler) getMe(w http.ResponseWriter, r *http.Request) {
	ownerID := r.Header.Get("X-Auth-User-Id")
	if ownerID == "" {
		ownerID = "local"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":      ownerID,
		"email":        ownerID + "@forge.local",
		"display_name": ownerID,
		"roles":        []string{"admin"},
		"status":       "active",
	})
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// detectPR runs `gh pr view --json` in the session workspace.
func (h *Handler) detectPR(sess *Session) PRStatusResponse {
	if sess.WorkspaceDir == "" {
		return PRStatusResponse{State: "none"}
	}

	cmd := exec.Command("gh", "pr", "view", "--json", "number,url,state,mergeable,statusCheckRollup") //nolint:gosec // fixed args
	cmd.Dir = sess.WorkspaceDir
	output, err := cmd.Output()
	if err != nil {
		return PRStatusResponse{State: "none"}
	}

	var pr struct {
		Number    int    `json:"number"`
		URL       string `json:"url"`
		State     string `json:"state"`
		Mergeable string `json:"mergeable"`
		Checks    []struct {
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
		} `json:"statusCheckRollup"`
	}
	if err := json.Unmarshal(output, &pr); err != nil {
		return PRStatusResponse{State: "none"}
	}

	ciPassed := true
	for _, check := range pr.Checks {
		if check.Conclusion != "SUCCESS" && check.Conclusion != "NEUTRAL" && check.Conclusion != "SKIPPED" {
			ciPassed = false
			break
		}
	}

	return PRStatusResponse{
		PRID:      fmt.Sprintf("%d", pr.Number),
		URL:       pr.URL,
		State:     strings.ToLower(pr.State),
		Mergeable: strings.EqualFold(pr.Mergeable, "MERGEABLE"),
		CIPassed:  &ciPassed,
	}
}

// readChronicle reads the Claude log and returns a summary.
func (h *Handler) readChronicle(sess *Session) string {
	logPath := filepath.Join(sess.WorkspaceDir, ".forge-claude.log")
	// Return last portion of the log as a basic summary.
	cmd := exec.Command("tail", "-100", logPath) //nolint:gosec // fixed args, path from trusted session state
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(output)
}

// --- helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	writeJSON(w, status, map[string]string{"detail": msg})
}

// keepAlive sends periodic SSE comments to keep the connection alive.
func keepAlive(w http.ResponseWriter, flusher http.Flusher, done <-chan struct{}) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
