package tyr

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Handler provides HTTP handlers for the tyr-mini REST API.
type Handler struct {
	store      *Store
	dispatcher *Dispatcher
}

// NewHandler creates a handler with the given store and dispatcher.
func NewHandler(store *Store, dispatcher *Dispatcher) *Handler {
	return &Handler{store: store, dispatcher: dispatcher}
}

// RegisterRoutes mounts all tyr-mini API routes onto the given mux.
// All routes are prefixed with /api/v1/tyr/.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/tyr/sagas", h.handleSagas)
	mux.HandleFunc("/api/v1/tyr/sagas/", h.handleSagaByID)
	mux.HandleFunc("/api/v1/tyr/phases", h.handlePhases)
	mux.HandleFunc("/api/v1/tyr/phases/", h.handlePhaseByID)
	mux.HandleFunc("/api/v1/tyr/raids", h.handleRaids)
	mux.HandleFunc("/api/v1/tyr/raids/", h.handleRaidByID)
	mux.HandleFunc("/api/v1/tyr/health", h.handleHealth)
}

// --- Sagas ---

func (h *Handler) handleSagas(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listSagas(w, r)
	case http.MethodPost:
		h.createSaga(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleSagaByID(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, "/api/v1/tyr/sagas/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing saga id")
		return
	}

	// Check for sub-resource paths.
	parts := strings.SplitN(id, "/", 2)
	sagaID := parts[0]

	if len(parts) == 2 {
		subPath := parts[1]
		switch {
		case subPath == "phases":
			h.handleSagaPhases(w, r, sagaID)
		case strings.HasPrefix(subPath, "phases/"):
			// Redirect to phase-specific handler.
			h.handleSagaSubPhase(w, r, sagaID, strings.TrimPrefix(subPath, "phases/"))
		default:
			writeError(w, http.StatusNotFound, "not found")
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.getSaga(w, r, sagaID)
	case http.MethodPut:
		h.updateSaga(w, r, sagaID)
	case http.MethodDelete:
		h.deleteSaga(w, r, sagaID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) listSagas(w http.ResponseWriter, r *http.Request) {
	sagas, err := h.store.ListSagas(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if sagas == nil {
		sagas = []*Saga{}
	}

	type sagaListItem struct {
		*Saga
		FeatureBranch string `json:"feature_branch"`
	}

	items := make([]sagaListItem, len(sagas))
	for i, s := range sagas {
		items[i] = sagaListItem{Saga: s, FeatureBranch: s.FeatureBranch()}
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) createSaga(w http.ResponseWriter, r *http.Request) {
	var saga Saga
	if err := json.NewDecoder(r.Body).Decode(&saga); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if saga.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if saga.Slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required")
		return
	}
	if saga.Status == "" {
		saga.Status = SagaStatusActive
	}
	if saga.OwnerID == "" {
		saga.OwnerID = "default"
	}
	if saga.BaseBranch == "" {
		saga.BaseBranch = "main"
	}
	if saga.TrackerType == "" {
		saga.TrackerType = "native"
	}
	if saga.TrackerID == "" {
		saga.TrackerID = saga.Slug
	}

	created, err := h.store.CreateSaga(r.Context(), &saga)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) getSaga(w http.ResponseWriter, r *http.Request, id string) {
	saga, err := h.store.GetSaga(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if saga == nil {
		writeError(w, http.StatusNotFound, "saga not found")
		return
	}

	// Build detail response with phases and raids.
	phases, err := h.store.ListPhases(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	type phaseDetail struct {
		*Phase
		Raids []*Raid `json:"raids"`
	}

	phaseDetails := make([]phaseDetail, 0, len(phases))
	for _, p := range phases {
		raids, raidErr := h.store.ListRaids(r.Context(), p.ID)
		if raidErr != nil {
			writeError(w, http.StatusInternalServerError, raidErr.Error())
			return
		}
		if raids == nil {
			raids = []*Raid{}
		}
		phaseDetails = append(phaseDetails, phaseDetail{Phase: p, Raids: raids})
	}

	resp := struct {
		*Saga
		FeatureBranch string        `json:"feature_branch"`
		Phases        []phaseDetail `json:"phases"`
	}{
		Saga:          saga,
		FeatureBranch: saga.FeatureBranch(),
		Phases:        phaseDetails,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) updateSaga(w http.ResponseWriter, r *http.Request, id string) {
	existing, err := h.store.GetSaga(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "saga not found")
		return
	}

	var update Saga
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if update.Name != "" {
		existing.Name = update.Name
	}
	if update.Status != "" {
		existing.Status = update.Status
	}
	if len(update.Repos) > 0 {
		existing.Repos = update.Repos
	}
	if update.BaseBranch != "" {
		existing.BaseBranch = update.BaseBranch
	}
	if update.Confidence != 0 {
		existing.Confidence = update.Confidence
	}

	if err := h.store.UpdateSaga(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

func (h *Handler) deleteSaga(w http.ResponseWriter, r *http.Request, id string) {
	if err := h.store.DeleteSaga(r.Context(), id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Phases ---

func (h *Handler) handleSagaPhases(w http.ResponseWriter, r *http.Request, sagaID string) {
	switch r.Method {
	case http.MethodGet:
		h.listPhasesBySaga(w, r, sagaID)
	case http.MethodPost:
		h.createPhaseForSaga(w, r, sagaID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleSagaSubPhase(w http.ResponseWriter, r *http.Request, _ string, phaseIDAndSub string) {
	parts := strings.SplitN(phaseIDAndSub, "/", 2)
	phaseID := parts[0]

	if len(parts) == 2 && parts[1] == "raids" {
		h.handlePhaseRaids(w, r, phaseID)
		return
	}

	// Single phase operations under saga.
	switch r.Method {
	case http.MethodGet:
		h.getPhase(w, r, phaseID)
	case http.MethodPut:
		h.updatePhaseHandler(w, r, phaseID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handlePhases(w http.ResponseWriter, r *http.Request) {
	sagaID := r.URL.Query().Get("saga_id")
	if sagaID == "" {
		writeError(w, http.StatusBadRequest, "saga_id query parameter is required")
		return
	}
	switch r.Method {
	case http.MethodGet:
		h.listPhasesBySaga(w, r, sagaID)
	case http.MethodPost:
		h.createPhaseForSaga(w, r, sagaID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handlePhaseByID(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, "/api/v1/tyr/phases/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing phase id")
		return
	}

	parts := strings.SplitN(id, "/", 2)
	phaseID := parts[0]

	if len(parts) == 2 && parts[1] == "raids" {
		h.handlePhaseRaids(w, r, phaseID)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.getPhase(w, r, phaseID)
	case http.MethodPut:
		h.updatePhaseHandler(w, r, phaseID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) listPhasesBySaga(w http.ResponseWriter, r *http.Request, sagaID string) {
	phases, err := h.store.ListPhases(r.Context(), sagaID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if phases == nil {
		phases = []*Phase{}
	}
	writeJSON(w, http.StatusOK, phases)
}

func (h *Handler) createPhaseForSaga(w http.ResponseWriter, r *http.Request, sagaID string) {
	var phase Phase
	if err := json.NewDecoder(r.Body).Decode(&phase); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	phase.SagaID = sagaID
	if phase.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if phase.Status == "" {
		phase.Status = PhaseStatusGated
	}
	if phase.TrackerID == "" {
		phase.TrackerID = fmt.Sprintf("phase-%d", phase.Number)
	}

	created, err := h.store.CreatePhase(r.Context(), &phase)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) getPhase(w http.ResponseWriter, r *http.Request, id string) {
	phase, err := h.store.GetPhase(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if phase == nil {
		writeError(w, http.StatusNotFound, "phase not found")
		return
	}
	writeJSON(w, http.StatusOK, phase)
}

func (h *Handler) updatePhaseHandler(w http.ResponseWriter, r *http.Request, id string) {
	existing, err := h.store.GetPhase(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "phase not found")
		return
	}

	var update Phase
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if update.Name != "" {
		existing.Name = update.Name
	}
	if update.Status != "" {
		existing.Status = update.Status
	}
	if update.Confidence != 0 {
		existing.Confidence = update.Confidence
	}

	if err := h.store.UpdatePhase(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

// --- Raids ---

func (h *Handler) handlePhaseRaids(w http.ResponseWriter, r *http.Request, phaseID string) {
	switch r.Method {
	case http.MethodGet:
		h.listRaidsByPhase(w, r, phaseID)
	case http.MethodPost:
		h.createRaidForPhase(w, r, phaseID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleRaids(w http.ResponseWriter, r *http.Request) {
	phaseID := r.URL.Query().Get("phase_id")
	if phaseID == "" {
		writeError(w, http.StatusBadRequest, "phase_id query parameter is required")
		return
	}
	switch r.Method {
	case http.MethodGet:
		h.listRaidsByPhase(w, r, phaseID)
	case http.MethodPost:
		h.createRaidForPhase(w, r, phaseID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) handleRaidByID(w http.ResponseWriter, r *http.Request) {
	id := extractID(r.URL.Path, "/api/v1/tyr/raids/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing raid id")
		return
	}

	parts := strings.SplitN(id, "/", 2)
	raidID := parts[0]

	if len(parts) == 2 {
		switch parts[1] {
		case "dispatch":
			h.dispatchRaid(w, r, raidID)
		case "status":
			h.updateRaidStatusHandler(w, r, raidID)
		case "confidence":
			h.handleConfidence(w, r, raidID)
		default:
			writeError(w, http.StatusNotFound, "not found")
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.getRaid(w, r, raidID)
	case http.MethodPut:
		h.updateRaidHandler(w, r, raidID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) listRaidsByPhase(w http.ResponseWriter, r *http.Request, phaseID string) {
	raids, err := h.store.ListRaids(r.Context(), phaseID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if raids == nil {
		raids = []*Raid{}
	}
	writeJSON(w, http.StatusOK, raids)
}

func (h *Handler) createRaidForPhase(w http.ResponseWriter, r *http.Request, phaseID string) {
	var raid Raid
	if err := json.NewDecoder(r.Body).Decode(&raid); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	raid.PhaseID = phaseID
	if raid.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if raid.Status == "" {
		raid.Status = RaidStatusPending
	}
	if raid.TrackerID == "" {
		raid.TrackerID = raid.Name
	}

	created, err := h.store.CreateRaid(r.Context(), &raid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) getRaid(w http.ResponseWriter, r *http.Request, id string) {
	raid, err := h.store.GetRaid(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if raid == nil {
		writeError(w, http.StatusNotFound, "raid not found")
		return
	}
	writeJSON(w, http.StatusOK, raid)
}

func (h *Handler) updateRaidHandler(w http.ResponseWriter, r *http.Request, id string) {
	existing, err := h.store.GetRaid(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "raid not found")
		return
	}

	var update Raid
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if update.Name != "" {
		existing.Name = update.Name
	}
	if update.Description != "" {
		existing.Description = update.Description
	}
	if len(update.AcceptanceCriteria) > 0 {
		existing.AcceptanceCriteria = update.AcceptanceCriteria
	}
	if len(update.DeclaredFiles) > 0 {
		existing.DeclaredFiles = update.DeclaredFiles
	}
	if update.EstimateHours != nil {
		existing.EstimateHours = update.EstimateHours
	}

	if err := h.store.UpdateRaid(r.Context(), existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

func (h *Handler) dispatchRaid(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if h.dispatcher == nil {
		writeError(w, http.StatusServiceUnavailable, "dispatcher not configured")
		return
	}

	raid, err := h.dispatcher.DispatchRaid(r.Context(), id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		if strings.Contains(err.Error(), "cannot dispatch") {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, raid)
}

func (h *Handler) updateRaidStatusHandler(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var body struct {
		Status RaidStatus `json:"status"`
		Reason *string    `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	if body.Status == "" {
		writeError(w, http.StatusBadRequest, "status is required")
		return
	}

	if err := h.store.UpdateRaidStatus(r.Context(), id, body.Status, body.Reason); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		if strings.Contains(err.Error(), "invalid transition") {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	raid, err := h.store.GetRaid(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, raid)
}

// --- Confidence ---

func (h *Handler) handleConfidence(w http.ResponseWriter, r *http.Request, raidID string) {
	switch r.Method {
	case http.MethodGet:
		h.listConfidenceEvents(w, r, raidID)
	case http.MethodPost:
		h.createConfidenceEvent(w, r, raidID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (h *Handler) listConfidenceEvents(w http.ResponseWriter, r *http.Request, raidID string) {
	events, err := h.store.ListConfidenceEvents(r.Context(), raidID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if events == nil {
		events = []*ConfidenceEvent{}
	}
	writeJSON(w, http.StatusOK, events)
}

func (h *Handler) createConfidenceEvent(w http.ResponseWriter, r *http.Request, raidID string) {
	var body struct {
		EventType ConfidenceEventType `json:"event_type"`
		Delta     float64             `json:"delta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if body.EventType == "" {
		writeError(w, http.StatusBadRequest, "event_type is required")
		return
	}

	event, err := h.store.CreateConfidenceEvent(r.Context(), raidID, body.EventType, body.Delta)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, event)
}

// --- Health ---

func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	status := "ok"
	if err := h.store.Ping(r.Context()); err != nil {
		status = "degraded"
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"service": "tyr-mini",
		"status":  status,
	})
}

// --- Helpers ---

func extractID(path, prefix string) string {
	return strings.TrimPrefix(path, prefix)
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorResponse{Error: msg})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
