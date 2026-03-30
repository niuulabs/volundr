package tyr

import (
	"testing"
)

func TestValidTransition(t *testing.T) {
	tests := []struct {
		name string
		from RaidStatus
		to   RaidStatus
		want bool
	}{
		{"pending to queued", RaidStatusPending, RaidStatusQueued, true},
		{"pending to dispatched", RaidStatusPending, RaidStatusDispatched, true},
		{"pending to running", RaidStatusPending, RaidStatusRunning, false},
		{"queued to dispatched", RaidStatusQueued, RaidStatusDispatched, true},
		{"queued to running", RaidStatusQueued, RaidStatusRunning, true},
		{"dispatched to running", RaidStatusDispatched, RaidStatusRunning, true},
		{"dispatched to failed", RaidStatusDispatched, RaidStatusFailed, true},
		{"dispatched to review", RaidStatusDispatched, RaidStatusReview, false},
		{"running to review", RaidStatusRunning, RaidStatusReview, true},
		{"running to failed", RaidStatusRunning, RaidStatusFailed, true},
		{"running to merged", RaidStatusRunning, RaidStatusMerged, false},
		{"review to merged", RaidStatusReview, RaidStatusMerged, true},
		{"review to failed", RaidStatusReview, RaidStatusFailed, true},
		{"review to running", RaidStatusReview, RaidStatusRunning, true},
		{"failed to queued", RaidStatusFailed, RaidStatusQueued, true},
		{"failed to pending", RaidStatusFailed, RaidStatusPending, true},
		{"failed to running", RaidStatusFailed, RaidStatusRunning, false},
		{"merged to anything", RaidStatusMerged, RaidStatusPending, false},
		{"unknown from status", RaidStatus("UNKNOWN"), RaidStatusPending, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidTransition(tt.from, tt.to)
			if got != tt.want {
				t.Errorf("ValidTransition(%s, %s) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

func TestSagaFeatureBranch(t *testing.T) {
	saga := &Saga{Slug: "my-project"}
	if got := saga.FeatureBranch(); got != "feat/my-project" {
		t.Errorf("FeatureBranch() = %q, want %q", got, "feat/my-project")
	}
}

func TestSagaStatusConstants(t *testing.T) {
	if SagaStatusActive != "ACTIVE" {
		t.Errorf("unexpected SagaStatusActive: %s", SagaStatusActive)
	}
	if SagaStatusComplete != "COMPLETE" {
		t.Errorf("unexpected SagaStatusComplete: %s", SagaStatusComplete)
	}
	if SagaStatusFailed != "FAILED" {
		t.Errorf("unexpected SagaStatusFailed: %s", SagaStatusFailed)
	}
}

func TestPhaseStatusConstants(t *testing.T) {
	statuses := []PhaseStatus{PhaseStatusPending, PhaseStatusActive, PhaseStatusGated, PhaseStatusComplete}
	expected := []string{"PENDING", "ACTIVE", "GATED", "COMPLETE"}
	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("PhaseStatus[%d] = %q, want %q", i, s, expected[i])
		}
	}
}

func TestRaidStatusConstants(t *testing.T) {
	statuses := []RaidStatus{
		RaidStatusPending, RaidStatusQueued, RaidStatusRunning,
		RaidStatusReview, RaidStatusMerged, RaidStatusFailed, RaidStatusDispatched,
	}
	expected := []string{"PENDING", "QUEUED", "RUNNING", "REVIEW", "MERGED", "FAILED", "DISPATCHED"}
	for i, s := range statuses {
		if string(s) != expected[i] {
			t.Errorf("RaidStatus[%d] = %q, want %q", i, s, expected[i])
		}
	}
}

func TestConfidenceEventTypeConstants(t *testing.T) {
	types := []ConfidenceEventType{
		ConfidenceEventCIPass, ConfidenceEventCIFail, ConfidenceEventScopeBreach,
		ConfidenceEventRetry, ConfidenceEventHumanReject, ConfidenceEventManual,
	}
	expected := []string{"ci_pass", "ci_fail", "scope_breach", "retry", "human_reject", "manual"}
	for i, s := range types {
		if string(s) != expected[i] {
			t.Errorf("ConfidenceEventType[%d] = %q, want %q", i, s, expected[i])
		}
	}
}
