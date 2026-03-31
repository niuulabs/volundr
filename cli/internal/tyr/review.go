package tyr

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"github.com/niuulabs/volundr/cli/internal/tracker"
)

// ReviewEngineConfig holds configuration for the review engine.
type ReviewEngineConfig struct {
	AutoApproveThreshold float64 // default 0.80
	MaxReviewRounds      int     // default 6
	ReviewerModel        string  // default claude-sonnet-4-6
	ReviewerSystemPrompt string
}

// ReviewEngine handles the review lifecycle: spawns reviewers, processes
// their output, and auto-approves or escalates raids.
type ReviewEngine struct {
	store    *Store
	pr       PRChecker
	tracker  tracker.Tracker
	spawner  SessionSpawner
	cfg      ReviewEngineConfig
	running  bool
}

// NewReviewEngine creates a new review engine.
func NewReviewEngine(store *Store, pr PRChecker, t tracker.Tracker, spawner SessionSpawner, cfg ReviewEngineConfig) *ReviewEngine {
	if cfg.AutoApproveThreshold == 0 {
		cfg.AutoApproveThreshold = 0.80
	}
	if cfg.MaxReviewRounds == 0 {
		cfg.MaxReviewRounds = 6
	}
	if cfg.ReviewerModel == "" {
		cfg.ReviewerModel = "claude-sonnet-4-6"
	}
	return &ReviewEngine{
		store:   store,
		pr:      pr,
		tracker: t,
		spawner: spawner,
		cfg:     cfg,
	}
}

// Start registers the engine with the activity subscriber.
func (re *ReviewEngine) Start(subscriber *ActivitySubscriber) {
	subscriber.OnReview(re.onRaidReview)
	re.running = true
	log.Println("tyr: review engine started")
}

// IsRunning returns whether the engine is active.
func (re *ReviewEngine) IsRunning() bool {
	return re.running
}

// onRaidReview is called when a raid enters REVIEW or a reviewer session idles.
func (re *ReviewEngine) onRaidReview(raidID string) {
	go re.evaluate(raidID)
}

func (re *ReviewEngine) evaluate(raidID string) {
	ctx := context.Background()

	raid, err := re.store.GetRaid(ctx, raidID)
	if err != nil || raid == nil {
		log.Printf("tyr: review: raid %s not found", raidID)
		return
	}

	// If raid has a reviewer session, this is a reviewer completion callback.
	if raid.ReviewerSessionID != nil && *raid.ReviewerSessionID != "" {
		re.handleReviewerCompletion(ctx, raid)
		return
	}

	// New review — spawn a reviewer session if we have a spawner.
	if re.spawner == nil {
		re.autoDecide(ctx, raid)
		return
	}

	re.spawnReviewer(ctx, raid)
}

func (re *ReviewEngine) spawnReviewer(ctx context.Context, raid *Raid) {
	saga, err := re.store.GetSagaForRaid(ctx, raid.ID)
	if err != nil || saga == nil {
		log.Printf("tyr: review: saga not found for raid %s", raid.ID)
		re.autoDecide(ctx, raid)
		return
	}

	prompt := buildReviewerPrompt(raid)

	sessionID, err := re.spawner.SpawnReviewerSession(
		raid, saga, re.cfg.ReviewerModel,
		re.cfg.ReviewerSystemPrompt, prompt,
	)
	if err != nil {
		log.Printf("tyr: review: spawn reviewer for %s: %v", raid.Identifier, err)
		re.autoDecide(ctx, raid)
		return
	}

	log.Printf("tyr: review: spawned reviewer session %s for raid %s", sessionID[:8], raid.Identifier)

	_ = re.store.UpdateRaidReviewer(ctx, raid.ID, sessionID)
}

func (re *ReviewEngine) handleReviewerCompletion(ctx context.Context, raid *Raid) {
	reviewerSessionID := *raid.ReviewerSessionID

	// Fetch reviewer output.
	output, err := re.spawner.GetLastAssistantMessage(reviewerSessionID)
	if err != nil {
		log.Printf("tyr: review: fetch reviewer output for %s: %v", raid.Identifier, err)
		return
	}

	if output == "" {
		return // Intermediate idle — reviewer still working.
	}

	result := parseReviewerResponse(output)
	if result == nil {
		return // No structured response yet — still working.
	}

	log.Printf("tyr: review: reviewer for %s: approved=%v confidence=%.2f findings=%d",
		raid.Identifier, result.Approved, result.Confidence, len(result.Findings))

	// Update confidence.
	_ = re.store.AddConfidenceEvent(ctx, raid.ID, "reviewer_score", result.Confidence-raid.Confidence)

	if result.Approved && len(result.Findings) == 0 && result.Confidence >= re.cfg.AutoApproveThreshold {
		re.autoApprove(ctx, raid, reviewerSessionID)
		return
	}

	if raid.ReviewRound >= re.cfg.MaxReviewRounds {
		re.escalate(ctx, raid, reviewerSessionID, "max review rounds reached")
		return
	}

	// Findings present — send feedback to working session.
	if len(result.Findings) > 0 && raid.SessionID != nil {
		feedback := buildReviewFeedback(result)
		if err := re.spawner.SendMessage(*raid.SessionID, feedback); err != nil {
			log.Printf("tyr: review: send feedback to working session: %v", err)
		}
	}

	// Reviewer will continue reviewing after the working session responds.
	// The subscriber will fire onReview again when the reviewer goes idle.
}

func (re *ReviewEngine) autoApprove(ctx context.Context, raid *Raid, reviewerSessionID string) {
	log.Printf("tyr: review: auto-approving raid %s", raid.Identifier)

	_ = re.store.AddConfidenceEvent(ctx, raid.ID, "auto_approved", 0.1)
	_ = re.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusMerged, nil)

	if re.tracker != nil && raid.TrackerID != "" {
		_ = re.tracker.UpdateIssueState(raid.TrackerID, "Done")
	}

	// Stop reviewer session.
	if reviewerSessionID != "" {
		_ = re.spawner.StopSession(reviewerSessionID)
	}

	// Check phase gate.
	re.checkPhaseGate(ctx, raid)
}

func (re *ReviewEngine) escalate(ctx context.Context, raid *Raid, reviewerSessionID, reason string) {
	log.Printf("tyr: review: escalating raid %s: %s", raid.Identifier, reason)

	_ = re.store.UpdateRaidStatus(ctx, raid.ID, RaidStatusEscalated, &reason)

	if re.tracker != nil && raid.TrackerID != "" {
		_ = re.tracker.AddComment(raid.TrackerID, "Escalated: "+reason)
	}

	if reviewerSessionID != "" {
		_ = re.spawner.StopSession(reviewerSessionID)
	}
}

func (re *ReviewEngine) autoDecide(ctx context.Context, raid *Raid) {
	// No reviewer session available — check PR/CI directly.
	if raid.SessionID == nil {
		return
	}

	pr, err := re.pr.GetPRStatus(*raid.SessionID)
	if err != nil {
		log.Printf("tyr: review: check PR for %s: %v", raid.Identifier, err)
		return
	}

	if pr.URL != "" && pr.CIPassed && pr.Mergeable {
		re.autoApprove(ctx, raid, "")
	} else {
		log.Printf("tyr: review: raid %s in REVIEW, waiting (pr=%v ci=%v mergeable=%v)",
			raid.Identifier, pr.URL != "", pr.CIPassed, pr.Mergeable)
	}
}

func (re *ReviewEngine) checkPhaseGate(ctx context.Context, raid *Raid) {
	phase, err := re.store.GetPhaseForRaid(ctx, raid.ID)
	if err != nil || phase == nil {
		return
	}

	allMerged, err := re.store.AllRaidsMerged(ctx, phase.ID)
	if err != nil || !allMerged {
		return
	}

	saga, _ := re.store.GetSagaForRaid(ctx, raid.ID)
	if saga == nil {
		return
	}

	nextPhase, err := re.store.GetNextPhase(ctx, saga.ID, phase.Number)
	if err != nil || nextPhase == nil {
		return
	}

	if nextPhase.Status == PhaseStatusGated {
		log.Printf("tyr: review: phase gate unlocked: %s (phase %d → %d)",
			saga.Name, phase.Number, nextPhase.Number)
		_ = re.store.UpdatePhaseStatus(ctx, nextPhase.ID, PhaseStatusActive)
	}
}

// --- Reviewer response parsing ---

// ReviewerResult is the structured output from a reviewer session.
type ReviewerResult struct {
	Confidence float64  `json:"confidence"`
	Approved   bool     `json:"approved"`
	Summary    string   `json:"summary"`
	Findings   []string `json:"findings"`
}

func parseReviewerResponse(text string) *ReviewerResult {
	// Try to extract JSON from markdown code fences.
	cleaned := strings.TrimSpace(text)
	for _, prefix := range []string{"```json", "```"} {
		if idx := strings.Index(cleaned, prefix); idx >= 0 {
			start := idx + len(prefix)
			if end := strings.Index(cleaned[start:], "```"); end >= 0 {
				cleaned = strings.TrimSpace(cleaned[start : start+end])
				break
			}
		}
	}

	var result ReviewerResult
	if err := json.Unmarshal([]byte(cleaned), &result); err != nil {
		return nil
	}

	if result.Summary == "" && result.Confidence == 0 {
		return nil // Not a structured response.
	}

	return &result
}

// --- Prompt builders ---

func buildReviewerPrompt(raid *Raid) string {
	var b strings.Builder
	b.WriteString("## Review Request\n\n")
	b.WriteString("**Ticket**: " + raid.Identifier + "\n")
	b.WriteString("**Raid**: " + raid.Name + "\n")
	if raid.Description != "" {
		b.WriteString("**Description**: " + raid.Description[:min(len(raid.Description), 500)] + "\n")
	}
	b.WriteString("\n")

	if raid.PRUrl != nil && *raid.PRUrl != "" {
		b.WriteString("**PR**: " + *raid.PRUrl + "\n\n")
	}

	b.WriteString("## Instructions\n\n")
	b.WriteString("1. Read CLAUDE.md and `.claude/rules/` for project conventions.\n")
	b.WriteString("2. Read the full diff — every changed file.\n")
	b.WriteString("3. Search for existing utilities that overlap with new code.\n")
	b.WriteString("4. Verify acceptance criteria are met.\n")
	b.WriteString("5. Check CI status.\n\n")

	b.WriteString("When satisfied (no findings), merge the PR:\n\n")
	b.WriteString("```bash\ngh pr merge --squash --delete-branch\n```\n\n")

	b.WriteString("## Response Format\n\n")
	b.WriteString("```json\n{\n")
	b.WriteString("  \"confidence\": <0.0-1.0>,\n")
	b.WriteString("  \"approved\": <true only if findings empty and PR merged>,\n")
	b.WriteString("  \"summary\": \"<one line>\",\n")
	b.WriteString("  \"findings\": [\"file:line — [category] description\"]\n")
	b.WriteString("}\n```\n")

	return b.String()
}

func buildReviewFeedback(result *ReviewerResult) string {
	var b strings.Builder
	b.WriteString("## Review Feedback\n\n")
	b.WriteString("**Findings to address** (all must be fixed before merge):\n\n")
	for _, f := range result.Findings {
		b.WriteString("- " + f + "\n")
	}
	b.WriteString("\nAfter fixing, `git add`, `git commit`, and `git push` your changes.\n")
	return b.String()
}
