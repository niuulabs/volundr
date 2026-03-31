package tyr

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/niuulabs/volundr/cli/internal/httputil"
	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// defaultInitialConfidence is the starting confidence score for new raids.
const defaultInitialConfidence = 0.75

// Handler holds the HTTP handlers for the tyr-mini REST API.
type Handler struct {
	store      *Store
	dispatcher *Dispatcher
	tracker    tracker.Tracker // nil if no tracker configured
}

// NewHandler creates a new tyr-mini API handler.
func NewHandler(store *Store, dispatcher *Dispatcher, t tracker.Tracker) *Handler {
	return &Handler{
		store:      store,
		dispatcher: dispatcher,
		tracker:    t,
	}
}

// RegisterRoutes registers all tyr-mini API routes on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	// Saga endpoints
	mux.HandleFunc("GET /api/v1/tyr/sagas", h.listSagas)
	mux.HandleFunc("GET /api/v1/tyr/sagas/{id}", h.getSaga)
	mux.HandleFunc("POST /api/v1/tyr/sagas/commit", h.commitSaga)
	mux.HandleFunc("DELETE /api/v1/tyr/sagas/{id}", h.deleteSaga)

	// Raid endpoints
	mux.HandleFunc("GET /api/v1/tyr/raids/summary", h.raidsSummary)
	mux.HandleFunc("GET /api/v1/tyr/raids/active", h.raidsActive)
	mux.HandleFunc("POST /api/v1/tyr/raids/{id}/approve", h.approveRaid)
	mux.HandleFunc("POST /api/v1/tyr/raids/{id}/reject", h.rejectRaid)
	mux.HandleFunc("POST /api/v1/tyr/raids/{id}/retry", h.retryRaid)

	// Dispatch endpoints
	mux.HandleFunc("POST /api/v1/tyr/dispatch/approve", h.dispatchApprove)
	mux.HandleFunc("GET /api/v1/tyr/dispatch/queue", h.dispatchQueue)
	mux.HandleFunc("GET /api/v1/tyr/dispatch/config", h.dispatchConfig)

	// Dashboard endpoints
	mux.HandleFunc("GET /api/v1/tyr/health/detailed", h.healthDetailed)
	mux.HandleFunc("GET /api/v1/tyr/events", h.events)
	mux.HandleFunc("GET /api/v1/tyr/dispatch/clusters", h.dispatchClusters)
	mux.HandleFunc("GET /api/v1/tyr/dispatcher/log", h.dispatcherLog)
	mux.HandleFunc("GET /api/v1/tyr/tracker/projects", h.trackerProjects)
	mux.HandleFunc("GET /api/v1/tyr/tracker/projects/{id}", h.trackerProject)
	mux.HandleFunc("GET /api/v1/tyr/tracker/projects/{id}/milestones", h.trackerMilestones)
	mux.HandleFunc("GET /api/v1/tyr/tracker/projects/{id}/issues", h.trackerIssues)
	mux.HandleFunc("POST /api/v1/tyr/tracker/import", h.trackerImport)

	// Not-implemented stubs for full Tyr endpoints
	mux.HandleFunc("POST /api/v1/tyr/sagas/decompose", h.notImplemented)
	mux.HandleFunc("POST /api/v1/tyr/sagas/plan", h.notImplemented)
	mux.HandleFunc("POST /api/v1/tyr/sagas/extract-structure", h.notImplemented)
	mux.HandleFunc("GET /api/v1/tyr/sagas/plan/config", h.notImplemented)
}

// Saga handlers.

func (h *Handler) listSagas(w http.ResponseWriter, r *http.Request) {
	ownerID := extractOwner(r)
	sagas, err := h.store.ListSagas(r.Context(), ownerID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "list sagas: %v", err)
		return
	}

	counts, err := h.store.CountPhasesAndRaidsBySaga(r.Context(), ownerID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "count phases/raids: %v", err)
		return
	}

	items := make([]SagaListItem, 0, len(sagas))
	for i := range sagas {
		s := &sagas[i]
		c := counts[s.ID]
		items = append(items, SagaListItem{
			ID:             s.ID,
			TrackerID:      s.TrackerID,
			TrackerType:    s.TrackerType,
			Slug:           s.Slug,
			Name:           s.Name,
			Repos:          s.Repos,
			FeatureBranch:  slugToFeatureBranch(s.Slug),
			Status:         string(s.Status),
			MilestoneCount: c.PhaseCount,
			IssueCount:     c.RaidCount,
		})
	}

	httputil.WriteJSON(w, http.StatusOK, items)
}

func (h *Handler) getSaga(w http.ResponseWriter, r *http.Request) {
	sagaID := r.PathValue("id")
	ownerID := extractOwner(r)

	saga, err := h.store.GetSaga(r.Context(), sagaID, ownerID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "get saga: %v", err)
		return
	}
	if saga == nil {
		httputil.WriteError(w, http.StatusNotFound, "saga not found: %s", sagaID)
		return
	}

	phases, err := h.store.ListPhases(r.Context(), saga.ID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "list phases: %v", err)
		return
	}

	phaseResponses := make([]PhaseDetailResponse, 0, len(phases))
	for pi := range phases {
		p := &phases[pi]
		raids, err := h.store.ListRaids(r.Context(), p.ID)
		if err != nil {
			httputil.WriteError(w, http.StatusInternalServerError, "list raids: %v", err)
			return
		}
		raidResponses := make([]RaidDetailResponse, 0, len(raids))
		for ri := range raids {
			rd := &raids[ri]
			raidResponses = append(raidResponses, RaidDetailResponse{
				ID:                 rd.ID,
				TrackerID:          rd.TrackerID,
				Name:               rd.Name,
				Description:        rd.Description,
				AcceptanceCriteria: rd.AcceptanceCriteria,
				Status:             string(rd.Status),
				Confidence:         rd.Confidence,
				SessionID:          rd.SessionID,
				Branch:             rd.Branch,
				PRUrl:              rd.PRUrl,
				RetryCount:         rd.RetryCount,
				CreatedAt:          rd.CreatedAt.UTC().Format(time.RFC3339),
				UpdatedAt:          rd.UpdatedAt.UTC().Format(time.RFC3339),
			})
		}

		phaseResponses = append(phaseResponses, PhaseDetailResponse{
			ID:         p.ID,
			Number:     p.Number,
			Name:       p.Name,
			Status:     string(p.Status),
			Confidence: p.Confidence,
			Raids:      raidResponses,
		})
	}

	resp := SagaDetailResponse{
		ID:            saga.ID,
		TrackerID:     saga.TrackerID,
		TrackerType:   saga.TrackerType,
		Slug:          saga.Slug,
		Name:          saga.Name,
		Repos:         saga.Repos,
		FeatureBranch: slugToFeatureBranch(saga.Slug),
		BaseBranch:    saga.BaseBranch,
		Status:        string(saga.Status),
		Confidence:    saga.Confidence,
		Phases:        phaseResponses,
	}

	httputil.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) commitSaga(w http.ResponseWriter, r *http.Request) {
	var req CommitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}

	if req.Name == "" || req.Slug == "" {
		httputil.WriteError(w, http.StatusBadRequest, "name and slug are required")
		return
	}
	if len(req.Phases) == 0 {
		httputil.WriteError(w, http.StatusUnprocessableEntity, "at least one phase is required")
		return
	}

	// Check for duplicate slug.
	existing, _ := h.store.GetSagaBySlug(r.Context(), req.Slug)
	if existing != nil {
		httputil.WriteError(w, http.StatusConflict, "saga with slug %q already exists", req.Slug)
		return
	}

	ownerID := extractOwner(r)
	now := time.Now().UTC()
	sagaID := uuid.New().String()
	featureBranch := slugToFeatureBranch(req.Slug)
	baseBranch := req.BaseBranch
	if baseBranch == "" {
		baseBranch = "main"
	}

	saga := Saga{
		ID:            sagaID,
		TrackerID:     sagaID,
		TrackerType:   "native",
		Slug:          req.Slug,
		Name:          req.Name,
		Repos:         req.Repos,
		FeatureBranch: featureBranch,
		BaseBranch:    baseBranch,
		Status:        SagaStatusActive,
		Confidence:    defaultInitialConfidence,
		OwnerID:       ownerID,
		CreatedAt:     now,
	}

	var phases []Phase
	var raids []Raid
	var phaseResponses []CommittedPhaseResponse

	for phaseNum, ps := range req.Phases {
		phaseID := uuid.New().String()
		phaseStatus := PhaseStatusGated
		if phaseNum == 0 {
			phaseStatus = PhaseStatusActive
		}

		phase := Phase{
			ID:         phaseID,
			SagaID:     sagaID,
			TrackerID:  phaseID,
			Number:     phaseNum + 1,
			Name:       ps.Name,
			Status:     phaseStatus,
			Confidence: defaultInitialConfidence,
		}
		phases = append(phases, phase)

		var raidResponses []CommittedRaidResponse
		for _, rs := range ps.Raids {
			raidID := uuid.New().String()
			var estHours *float64
			if rs.EstimateHours > 0 {
				v := rs.EstimateHours
				estHours = &v
			}

			raid := Raid{
				ID:                 raidID,
				PhaseID:            phaseID,
				TrackerID:          raidID,
				Name:               rs.Name,
				Description:        rs.Description,
				AcceptanceCriteria: rs.AcceptanceCriteria,
				DeclaredFiles:      rs.DeclaredFiles,
				EstimateHours:      estHours,
				Status:             RaidStatusPending,
				Confidence:         defaultInitialConfidence,
				RetryCount:         0,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
			raids = append(raids, raid)

			raidResponses = append(raidResponses, CommittedRaidResponse{
				ID:        raidID,
				TrackerID: raidID,
				Name:      rs.Name,
				Status:    string(RaidStatusPending),
			})
		}

		phaseResponses = append(phaseResponses, CommittedPhaseResponse{
			ID:        phaseID,
			TrackerID: phaseID,
			Number:    phaseNum + 1,
			Name:      ps.Name,
			Status:    string(phaseStatus),
			Raids:     raidResponses,
		})
	}

	if err := h.store.CreateSaga(r.Context(), &saga, phases, raids); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "create saga: %v", err)
		return
	}

	httputil.WriteJSON(w, http.StatusCreated, CommittedSagaResponse{
		ID:            sagaID,
		TrackerID:     sagaID,
		TrackerType:   "native",
		Slug:          req.Slug,
		Name:          req.Name,
		Repos:         req.Repos,
		FeatureBranch: featureBranch,
		BaseBranch:    baseBranch,
		Status:        string(SagaStatusActive),
		Confidence:    defaultInitialConfidence,
		Phases:        phaseResponses,
	})
}

func (h *Handler) deleteSaga(w http.ResponseWriter, r *http.Request) {
	sagaID := r.PathValue("id")
	ownerID := extractOwner(r)

	deleted, err := h.store.DeleteSaga(r.Context(), sagaID, ownerID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "delete saga: %v", err)
		return
	}
	if !deleted {
		httputil.WriteError(w, http.StatusNotFound, "saga not found: %s", sagaID)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Raid handlers.

func (h *Handler) raidsSummary(w http.ResponseWriter, r *http.Request) {
	counts, err := h.store.CountByStatus(r.Context())
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "count raids: %v", err)
		return
	}
	httputil.WriteJSON(w, http.StatusOK, counts)
}

func (h *Handler) raidsActive(w http.ResponseWriter, r *http.Request) {
	raids, err := h.store.ListActiveRaids(r.Context())
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "list active raids: %v", err)
		return
	}

	results := make([]ActiveRaidResponse, 0, len(raids))
	for i := range raids {
		rd := &raids[i]
		results = append(results, ActiveRaidResponse{
			TrackerID:         rd.TrackerID,
			Identifier:        rd.TrackerID,
			Title:             rd.Name,
			Status:            string(rd.Status),
			SessionID:         rd.SessionID,
			ReviewerSessionID: rd.ReviewerSessionID,
			ReviewRound:       rd.ReviewRound,
			Confidence:        rd.Confidence,
			PRUrl:             rd.PRUrl,
			LastUpdated:       rd.UpdatedAt.UTC().Format(time.RFC3339),
		})
	}

	httputil.WriteJSON(w, http.StatusOK, results)
}

func (h *Handler) approveRaid(w http.ResponseWriter, r *http.Request) {
	raidID := r.PathValue("id")
	ctx := r.Context()

	raid, err := h.store.GetRaid(ctx, raidID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "get raid: %v", err)
		return
	}
	if raid == nil {
		httputil.WriteError(w, http.StatusNotFound, "raid not found: %s", raidID)
		return
	}

	if err := h.store.UpdateRaidStatus(ctx, raidID, RaidStatusMerged, nil); err != nil {
		httputil.WriteError(w, http.StatusConflict, "approve raid: %v", err)
		return
	}

	_ = h.store.AddConfidenceEvent(ctx, raidID, "human_approved", 0.1)

	raid, _ = h.store.GetRaid(ctx, raidID)
	httputil.WriteJSON(w, http.StatusOK, raidToResponse(raid))
}

func (h *Handler) rejectRaid(w http.ResponseWriter, r *http.Request) {
	raidID := r.PathValue("id")
	ctx := r.Context()

	var body RaidStatusUpdate
	_ = json.NewDecoder(r.Body).Decode(&body)

	raid, err := h.store.GetRaid(ctx, raidID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "get raid: %v", err)
		return
	}
	if raid == nil {
		httputil.WriteError(w, http.StatusNotFound, "raid not found: %s", raidID)
		return
	}

	reason := nilIfEmpty(body.Reason)
	if err := h.store.UpdateRaidStatus(ctx, raidID, RaidStatusFailed, reason); err != nil {
		httputil.WriteError(w, http.StatusConflict, "reject raid: %v", err)
		return
	}

	_ = h.store.AddConfidenceEvent(ctx, raidID, "human_reject", -0.2)

	raid, _ = h.store.GetRaid(ctx, raidID)
	httputil.WriteJSON(w, http.StatusOK, raidToResponse(raid))
}

func (h *Handler) retryRaid(w http.ResponseWriter, r *http.Request) {
	raidID := r.PathValue("id")
	ctx := r.Context()

	raid, err := h.store.GetRaid(ctx, raidID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "get raid: %v", err)
		return
	}
	if raid == nil {
		httputil.WriteError(w, http.StatusNotFound, "raid not found: %s", raidID)
		return
	}

	if err := h.store.UpdateRaidStatus(ctx, raidID, RaidStatusQueued, nil); err != nil {
		httputil.WriteError(w, http.StatusConflict, "retry raid: %v", err)
		return
	}

	_ = h.store.AddConfidenceEvent(ctx, raidID, "retry", -0.1)

	raid, _ = h.store.GetRaid(ctx, raidID)
	httputil.WriteJSON(w, http.StatusOK, raidToResponse(raid))
}

// Dispatch handlers.

func (h *Handler) dispatchQueue(w http.ResponseWriter, r *http.Request) {
	ownerID := extractOwner(r)

	type queueItem struct {
		SagaID        string   `json:"saga_id"`
		SagaName      string   `json:"saga_name"`
		SagaSlug      string   `json:"saga_slug"`
		Repos         []string `json:"repos"`
		FeatureBranch string   `json:"feature_branch"`
		PhaseName     string   `json:"phase_name"`
		IssueID       string   `json:"issue_id"`
		Identifier    string   `json:"identifier"`
		Title         string   `json:"title"`
		Description   string   `json:"description"`
		Status        string   `json:"status"`
	}

	items, err := h.store.ListDispatchQueue(r.Context(), ownerID)
	if err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "list dispatch queue: %v", err)
		return
	}

	queue := make([]queueItem, 0, len(items))
	for i := range items {
		item := &items[i]
		queue = append(queue, queueItem{
			SagaID:        item.SagaID,
			SagaName:      item.SagaName,
			SagaSlug:      item.SagaSlug,
			Repos:         item.Repos,
			FeatureBranch: item.FeatureBranch,
			PhaseName:     item.PhaseName,
			IssueID:       item.RaidTrackerID,
			Identifier:    item.RaidTrackerID,
			Title:         item.RaidName,
			Description:   item.RaidDesc,
			Status:        item.RaidStatus,
		})
	}
	httputil.WriteJSON(w, http.StatusOK, queue)
}

func (h *Handler) dispatchApprove(w http.ResponseWriter, r *http.Request) {
	var req DispatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}

	ownerID := extractOwner(r)
	ctx := r.Context()
	var results []DispatchResult

	for _, item := range req.Items {
		saga, err := h.store.GetSaga(ctx, item.SagaID, ownerID)
		if err != nil || saga == nil {
			results = append(results, DispatchResult{
				IssueID: item.IssueID,
				Status:  "failed",
			})
			continue
		}

		// Find the raid by tracker_id (issue_id).
		raid := h.findRaidByTrackerID(ctx, saga.ID, item.IssueID)
		if raid == nil {
			results = append(results, DispatchResult{
				IssueID: item.IssueID,
				Status:  "failed",
			})
			continue
		}

		// Transition raid: PENDING → QUEUED → RUNNING
		_ = h.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusQueued, nil)
		_ = h.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusRunning, nil)

		session, err := h.dispatcher.SpawnSession(ctx, raid, saga, req.Model)
		if err != nil {
			// Revert to FAILED on dispatch error.
			_ = h.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusFailed, nil)
			results = append(results, DispatchResult{
				IssueID: item.IssueID,
				Status:  "failed",
			})
			continue
		}

		raidBranch := raid.TrackerID
		_ = h.store.UpdateRaidSession(ctx, raid.ID, session.ID, raidBranch)

		results = append(results, DispatchResult{
			IssueID:     item.IssueID,
			SessionID:   session.ID,
			SessionName: session.Name,
			Status:      "spawned",
		})
	}

	if results == nil {
		results = []DispatchResult{}
	}
	httputil.WriteJSON(w, http.StatusOK, results)
}

func (h *Handler) dispatchConfig(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"default_system_prompt": "",
		"default_model":         "claude-sonnet-4-6",
		"models":                []map[string]string{},
	})
}

// Not-implemented stub.

func (h *Handler) notImplemented(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusNotImplemented, map[string]string{
		"detail": "this endpoint requires full Tyr (not available in mini mode)",
	})
}

// Helpers.

func (h *Handler) findRaidByTrackerID(ctx context.Context, sagaID, trackerID string) *Raid {
	phases, err := h.store.ListPhases(ctx, sagaID)
	if err != nil {
		log.Printf("tyr-mini: list phases for saga %s: %v", sagaID, err)
		return nil
	}
	for _, phase := range phases {
		raids, err := h.store.ListRaids(ctx, phase.ID)
		if err != nil {
			log.Printf("tyr-mini: list raids for phase %s: %v", phase.ID, err)
			continue
		}
		for i := range raids {
			if raids[i].TrackerID == trackerID || raids[i].ID == trackerID {
				return &raids[i]
			}
		}
	}
	return nil
}

func raidToResponse(raid *Raid) RaidResponse {
	return RaidResponse{
		ID:               raid.ID,
		Name:             raid.Name,
		Status:           string(raid.Status),
		Confidence:       raid.Confidence,
		RetryCount:       raid.RetryCount,
		Branch:           raid.Branch,
		ChronicleSummary: raid.ChronicleSummary,
		Reason:           raid.Reason,
	}
}

func extractOwner(r *http.Request) string {
	ownerID := r.Header.Get("X-Auth-User-Id")
	if ownerID == "" {
		return "local"
	}
	return ownerID
}

func (h *Handler) trackerProject(w http.ResponseWriter, r *http.Request) {
	if h.tracker == nil {
		httputil.WriteError(w, http.StatusNotFound, "no tracker configured")
		return
	}
	project, err := h.tracker.GetProject(r.PathValue("id"))
	if err != nil {
		log.Printf("tyr: get tracker project: %v", err)
		httputil.WriteError(w, http.StatusNotFound, "project not found")
		return
	}
	httputil.WriteJSON(w, http.StatusOK, project)
}

func (h *Handler) trackerMilestones(w http.ResponseWriter, r *http.Request) {
	if h.tracker == nil {
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	milestones, err := h.tracker.ListMilestones(r.PathValue("id"))
	if err != nil {
		log.Printf("tyr: list tracker milestones: %v", err)
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, milestones)
}

func (h *Handler) trackerImport(w http.ResponseWriter, r *http.Request) {
	if h.tracker == nil {
		httputil.WriteError(w, http.StatusBadRequest, "no tracker configured")
		return
	}

	var req struct {
		ProjectID  string   `json:"project_id"`
		Repos      []string `json:"repos"`
		BaseBranch string   `json:"base_branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httputil.WriteError(w, http.StatusBadRequest, "invalid request: %v", err)
		return
	}

	project, err := h.tracker.GetProject(req.ProjectID)
	if err != nil {
		httputil.WriteError(w, http.StatusNotFound, "project not found: %v", err)
		return
	}

	slug := project.Slug
	if slug == "" {
		slug = slugify(project.Name)
	}

	ownerID := r.Header.Get("X-Auth-User-Id")
	if ownerID == "" {
		ownerID = "local"
	}

	saga := &Saga{
		ID:            uuid.New().String(),
		TrackerID:     project.ID,
		TrackerType:   "linear",
		Slug:          slug,
		Name:          project.Name,
		Repos:         req.Repos,
		FeatureBranch: "feat/" + slug,
		BaseBranch:    req.BaseBranch,
		Status:        SagaStatusActive,
		Confidence:    0,
		OwnerID:       ownerID,
		CreatedAt:     time.Now().UTC(),
	}

	if err := h.store.CreateSaga(context.Background(), saga, nil, nil); err != nil {
		httputil.WriteError(w, http.StatusInternalServerError, "create saga: %v", err)
		return
	}

	log.Printf("tyr: imported saga '%s' from project %s", saga.Name, project.ID)

	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"id":             saga.ID,
		"tracker_id":     saga.TrackerID,
		"name":           saga.Name,
		"repos":          saga.Repos,
		"feature_branch": saga.FeatureBranch,
		"status":         string(saga.Status),
		"phase_count":    project.MilestoneCount,
		"raid_count":     project.IssueCount,
	})
}

func slugify(name string) string {
	s := strings.ToLower(name)
	// Replace non-alphanumeric with hyphens.
	var b strings.Builder
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		} else {
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

func (h *Handler) trackerIssues(w http.ResponseWriter, r *http.Request) {
	if h.tracker == nil {
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	milestoneID := r.URL.Query().Get("milestone_id")
	var msPtr *string
	if milestoneID != "" {
		msPtr = &milestoneID
	}
	issues, err := h.tracker.ListIssues(r.PathValue("id"), msPtr)
	if err != nil {
		log.Printf("tyr: list tracker issues: %v", err)
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, issues)
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// --- Dashboard endpoints ---

func (h *Handler) healthDetailed(w http.ResponseWriter, _ *http.Request) {
	dbStatus := "ok"
	if err := h.store.Ping(context.Background()); err != nil {
		dbStatus = "unavailable"
	}
	status := "ok"
	if dbStatus != "ok" {
		status = "degraded"
	}
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"status":                       status,
		"database":                     dbStatus,
		"event_bus_subscriber_count":   0,
		"activity_subscriber_running":  false,
		"notification_service_running": false,
		"review_engine_running":        false,
	})
}

func (h *Handler) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	// Keep connection alive with comments until client disconnects.
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, _ = w.Write([]byte(": keepalive\n\n"))
			flusher.Flush()
		}
	}
}

func (h *Handler) dispatchClusters(w http.ResponseWriter, _ *http.Request) {
	// In mini mode, there's one local "cluster" — the Forge server itself.
	httputil.WriteJSON(w, http.StatusOK, []map[string]any{
		{
			"connection_id": "local",
			"name":          "Local (mini mode)",
			"url":           "http://127.0.0.1:8080",
			"enabled":       true,
		},
	})
}

func (h *Handler) dispatcherLog(w http.ResponseWriter, _ *http.Request) {
	httputil.WriteJSON(w, http.StatusOK, map[string]any{
		"events": []any{},
		"total":  0,
	})
}

func (h *Handler) trackerProjects(w http.ResponseWriter, _ *http.Request) {
	if h.tracker == nil {
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	projects, err := h.tracker.ListProjects()
	if err != nil {
		log.Printf("tyr: list tracker projects: %v", err)
		httputil.WriteJSON(w, http.StatusOK, []any{})
		return
	}
	httputil.WriteJSON(w, http.StatusOK, projects)
}
