package tyr

import (
	"testing"
)

func TestValidateTransition_AllowedTransitions(t *testing.T) {
	tests := []struct {
		name    string
		from    RaidStatus
		to      RaidStatus
		wantErr bool
	}{
		{"pending to queued", RaidStatusPending, RaidStatusQueued, false},
		{"queued to running", RaidStatusQueued, RaidStatusRunning, false},
		{"queued to failed", RaidStatusQueued, RaidStatusFailed, false},
		{"running to review", RaidStatusRunning, RaidStatusReview, false},
		{"running to merged", RaidStatusRunning, RaidStatusMerged, false},
		{"running to failed", RaidStatusRunning, RaidStatusFailed, false},
		{"review to pending", RaidStatusReview, RaidStatusPending, false},
		{"review to queued", RaidStatusReview, RaidStatusQueued, false},
		{"review to escalated", RaidStatusReview, RaidStatusEscalated, false},
		{"review to merged", RaidStatusReview, RaidStatusMerged, false},
		{"review to failed", RaidStatusReview, RaidStatusFailed, false},
		{"escalated to queued", RaidStatusEscalated, RaidStatusQueued, false},
		{"escalated to merged", RaidStatusEscalated, RaidStatusMerged, false},
		{"escalated to failed", RaidStatusEscalated, RaidStatusFailed, false},
		{"failed to queued", RaidStatusFailed, RaidStatusQueued, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTransition(tt.from, tt.to)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTransition(%s, %s) error = %v, wantErr %v", tt.from, tt.to, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTransition_ForbiddenTransitions(t *testing.T) {
	tests := []struct {
		name string
		from RaidStatus
		to   RaidStatus
	}{
		{"pending to running", RaidStatusPending, RaidStatusRunning},
		{"pending to merged", RaidStatusPending, RaidStatusMerged},
		{"pending to failed", RaidStatusPending, RaidStatusFailed},
		{"queued to merged", RaidStatusQueued, RaidStatusMerged},
		{"queued to review", RaidStatusQueued, RaidStatusReview},
		{"running to queued", RaidStatusRunning, RaidStatusQueued},
		{"running to pending", RaidStatusRunning, RaidStatusPending},
		{"merged to anything", RaidStatusMerged, RaidStatusPending},
		{"merged to queued", RaidStatusMerged, RaidStatusQueued},
		{"merged to failed", RaidStatusMerged, RaidStatusFailed},
		{"failed to running", RaidStatusFailed, RaidStatusRunning},
		{"failed to merged", RaidStatusFailed, RaidStatusMerged},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTransition(tt.from, tt.to)
			if err == nil {
				t.Errorf("ValidateTransition(%s, %s) should have returned error", tt.from, tt.to)
			}
		})
	}
}

func TestValidateTransition_UnknownStatus(t *testing.T) {
	err := ValidateTransition(RaidStatus("UNKNOWN"), RaidStatusQueued)
	if err == nil {
		t.Error("expected error for unknown status")
	}
}

func TestSlugToFeatureBranch(t *testing.T) {
	tests := []struct {
		slug string
		want string
	}{
		{"my-project", "feat/my-project"},
		{"ABC", "feat/abc"},
		{"some-feature", "feat/some-feature"},
	}

	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			got := slugToFeatureBranch(tt.slug)
			if got != tt.want {
				t.Errorf("slugToFeatureBranch(%q) = %q, want %q", tt.slug, got, tt.want)
			}
		})
	}
}

func TestGenerateID(t *testing.T) {
	id1 := GenerateID()
	id2 := GenerateID()

	if id1 == "" {
		t.Error("GenerateID returned empty string")
	}
	if id1 == id2 {
		t.Error("GenerateID returned same ID twice")
	}
	if len(id1) != 36 {
		t.Errorf("GenerateID returned ID of unexpected length: %d", len(id1))
	}
}

func TestSagaStatusValues(t *testing.T) {
	if SagaStatusActive != "ACTIVE" {
		t.Errorf("SagaStatusActive = %q", SagaStatusActive)
	}
	if SagaStatusComplete != "COMPLETE" {
		t.Errorf("SagaStatusComplete = %q", SagaStatusComplete)
	}
	if SagaStatusFailed != "FAILED" {
		t.Errorf("SagaStatusFailed = %q", SagaStatusFailed)
	}
}

func TestPhaseStatusValues(t *testing.T) {
	if PhaseStatusPending != "PENDING" {
		t.Errorf("PhaseStatusPending = %q", PhaseStatusPending)
	}
	if PhaseStatusActive != "ACTIVE" {
		t.Errorf("PhaseStatusActive = %q", PhaseStatusActive)
	}
	if PhaseStatusGated != "GATED" {
		t.Errorf("PhaseStatusGated = %q", PhaseStatusGated)
	}
	if PhaseStatusComplete != "COMPLETE" {
		t.Errorf("PhaseStatusComplete = %q", PhaseStatusComplete)
	}
}

func TestRaidStatusValues(t *testing.T) {
	statuses := map[RaidStatus]string{
		RaidStatusPending:   "PENDING",
		RaidStatusQueued:    "QUEUED",
		RaidStatusRunning:   "RUNNING",
		RaidStatusReview:    "REVIEW",
		RaidStatusEscalated: "ESCALATED",
		RaidStatusMerged:    "MERGED",
		RaidStatusFailed:    "FAILED",
	}

	for got, want := range statuses {
		if string(got) != want {
			t.Errorf("RaidStatus %q != %q", got, want)
		}
	}
}

func TestRaidTransitions_TerminalMerged(t *testing.T) {
	// MERGED is terminal — no valid transitions.
	allowed := raidTransitions[RaidStatusMerged]
	if len(allowed) != 0 {
		t.Errorf("MERGED should have no allowed transitions, got %d", len(allowed))
	}
}

func TestRaidTransitions_AllStatusesCovered(t *testing.T) {
	allStatuses := []RaidStatus{
		RaidStatusPending, RaidStatusQueued, RaidStatusRunning,
		RaidStatusReview, RaidStatusEscalated, RaidStatusMerged, RaidStatusFailed,
	}

	for _, s := range allStatuses {
		if _, ok := raidTransitions[s]; !ok {
			t.Errorf("status %s is not in raidTransitions map", s)
		}
	}
}
