package tracker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// gqlResponse builds a JSON response body with a "data" envelope.
func gqlResponse(data map[string]any) []byte {
	b, _ := json.Marshal(map[string]any{"data": data})
	return b
}

// gqlError builds a JSON response body with an "errors" envelope.
func gqlError(msg string) []byte {
	b, _ := json.Marshal(map[string]any{
		"errors": []map[string]any{{"message": msg}},
	})
	return b
}

// newTestTracker creates a LinearTracker pointed at a httptest server.
func newTestTracker(handler http.HandlerFunc) (*LinearTracker, *httptest.Server) {
	srv := httptest.NewServer(handler)
	lt := NewLinearTracker(LinearConfig{
		APIKey:     "test-key",
		TeamID:     "team-1",
		APIURL:     srv.URL,
		CacheTTL:   1, // 1 second
		MaxRetries: 2,
	})
	return lt, srv
}

// sampleProjectNode returns a typical project GraphQL node.
func sampleProjectNode() map[string]any {
	return map[string]any{
		"id":          "proj-1",
		"name":        "Alpha",
		"description": "Alpha project",
		"state":       "started",
		"url":         "https://linear.app/team/project/alpha-abc123",
		"slugId":      "abc123",
		"progress":    float64(50),
		"startDate":   "2025-01-01",
		"targetDate":  "2025-06-01",
		"projectMilestones": map[string]any{
			"nodes": []any{},
		},
		"issues": map[string]any{
			"nodes": []any{
				map[string]any{"id": "iss-1"},
				map[string]any{"id": "iss-2"},
			},
		},
	}
}

// sampleMilestoneNode returns a typical milestone GraphQL node.
func sampleMilestoneNode() map[string]any {
	return map[string]any{
		"id":          "ms-1",
		"name":        "M1",
		"description": "Milestone 1",
		"sortOrder":   float64(1),
		"progress":    float64(75),
		"targetDate":  "2025-03-01",
	}
}

// sampleIssueNode returns a typical issue GraphQL node.
func sampleIssueNode() map[string]any {
	return map[string]any{
		"id":         "iss-1",
		"identifier": "TEAM-1",
		"title":      "Fix bug",
		"description": "A bug fix",
		"state": map[string]any{
			"name": "In Progress",
			"type": "started",
		},
		"assignee": map[string]any{
			"name": "Alice",
		},
		"labels": map[string]any{
			"nodes": []any{
				map[string]any{"name": "bug"},
			},
		},
		"priority":      float64(2),
		"priorityLabel": "High",
		"estimate":      float64(3),
		"url":           "https://linear.app/team/issue/TEAM-1",
		"projectMilestone": map[string]any{
			"id": "ms-1",
		},
	}
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewLinearTracker_Defaults(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{APIKey: "k"})
	if lt.apiURL != linearAPIURL {
		t.Errorf("expected default API URL %s, got %s", linearAPIURL, lt.apiURL)
	}
	if lt.ttl != 30*time.Second {
		t.Errorf("expected default TTL 30s, got %s", lt.ttl)
	}
	if lt.maxRetries != 3 {
		t.Errorf("expected default maxRetries 3, got %d", lt.maxRetries)
	}
}

func TestNewLinearTracker_CustomConfig(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{
		APIKey:     "k",
		APIURL:     "https://custom.api",
		CacheTTL:   60,
		MaxRetries: 5,
		TeamID:     "t-1",
	})
	if lt.apiURL != "https://custom.api" {
		t.Errorf("expected custom API URL, got %s", lt.apiURL)
	}
	if lt.ttl != 60*time.Second {
		t.Errorf("expected 60s TTL, got %s", lt.ttl)
	}
	if lt.maxRetries != 5 {
		t.Errorf("expected 5 retries, got %d", lt.maxRetries)
	}
	if lt.teamID != "t-1" {
		t.Errorf("expected team t-1, got %s", lt.teamID)
	}
}

func TestClose(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{APIKey: "k"})
	if err := lt.Close(); err != nil {
		t.Errorf("Close should be nil, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// ListProjects
// ---------------------------------------------------------------------------

func TestListProjects(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"projects": map[string]any{
				"nodes": []any{sampleProjectNode()},
			},
		}))
	})
	defer srv.Close()

	projects, err := lt.ListProjects()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(projects))
	}
	p := projects[0]
	if p.ID != "proj-1" {
		t.Errorf("expected proj-1, got %s", p.ID)
	}
	if p.Name != "Alpha" {
		t.Errorf("expected Alpha, got %s", p.Name)
	}
	if p.IssueCount != 2 {
		t.Errorf("expected 2 issues, got %d", p.IssueCount)
	}
	if p.Slug != "alpha" {
		t.Errorf("expected slug alpha, got %s", p.Slug)
	}
	if p.Progress != 0.5 {
		t.Errorf("expected progress 0.5, got %f", p.Progress)
	}
	if p.StartDate == nil || *p.StartDate != "2025-01-01" {
		t.Errorf("expected start date 2025-01-01, got %v", p.StartDate)
	}
}

func TestListProjects_Cached(t *testing.T) {
	var calls int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Write(gqlResponse(map[string]any{
			"projects": map[string]any{
				"nodes": []any{sampleProjectNode()},
			},
		}))
	})
	defer srv.Close()

	_, _ = lt.ListProjects()
	_, _ = lt.ListProjects()
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("expected 1 API call (cached), got %d", calls)
	}
}

// ---------------------------------------------------------------------------
// GetProject
// ---------------------------------------------------------------------------

func TestGetProject(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"project": sampleProjectNode(),
		}))
	})
	defer srv.Close()

	p, err := lt.GetProject("proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.ID != "proj-1" {
		t.Errorf("expected proj-1, got %s", p.ID)
	}
}

func TestGetProject_NotFound(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"project": nil,
		}))
	})
	defer srv.Close()

	_, err := lt.GetProject("nonexistent")
	if err == nil || !strings.Contains(err.Error(), "project not found") {
		t.Errorf("expected project not found error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// GetProjectFull
// ---------------------------------------------------------------------------

func TestGetProjectFull(t *testing.T) {
	node := map[string]any{
		"id":          "proj-1",
		"name":        "Alpha",
		"description": "Full project",
		"state":       "started",
		"url":         "https://linear.app/team/project/alpha-abc123",
		"slugId":      "abc123",
		"progress":    float64(40),
		"startDate":   "2025-01-01",
		"targetDate":  "2025-12-01",
		"projectMilestones": map[string]any{
			"nodes": []any{sampleMilestoneNode()},
		},
		"issueCount": map[string]any{
			"nodes": []any{
				map[string]any{"id": "iss-1"},
			},
		},
		"issuesFull": map[string]any{
			"nodes": []any{sampleIssueNode()},
		},
	}

	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{"project": node}))
	})
	defer srv.Close()

	p, ms, issues, err := lt.GetProjectFull("proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.ID != "proj-1" {
		t.Errorf("expected proj-1, got %s", p.ID)
	}
	if len(ms) != 1 {
		t.Fatalf("expected 1 milestone, got %d", len(ms))
	}
	if ms[0].Name != "M1" {
		t.Errorf("expected M1, got %s", ms[0].Name)
	}
	if ms[0].ProjectID != "proj-1" {
		t.Errorf("expected projectID proj-1, got %s", ms[0].ProjectID)
	}
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(issues))
	}
	if issues[0].Title != "Fix bug" {
		t.Errorf("expected Fix bug, got %s", issues[0].Title)
	}
}

func TestGetProjectFull_NotFound(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{"project": nil}))
	})
	defer srv.Close()

	_, _, _, err := lt.GetProjectFull("bad")
	if err == nil || !strings.Contains(err.Error(), "project not found") {
		t.Errorf("expected error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// ListMilestones
// ---------------------------------------------------------------------------

func TestListMilestones(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"project": map[string]any{
				"projectMilestones": map[string]any{
					"nodes": []any{sampleMilestoneNode()},
				},
			},
		}))
	})
	defer srv.Close()

	ms, err := lt.ListMilestones("proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ms) != 1 {
		t.Fatalf("expected 1 milestone, got %d", len(ms))
	}
	if ms[0].ID != "ms-1" {
		t.Errorf("expected ms-1, got %s", ms[0].ID)
	}
	if ms[0].SortOrder != 1 {
		t.Errorf("expected sortOrder 1, got %d", ms[0].SortOrder)
	}
	if ms[0].Progress != 0.75 {
		t.Errorf("expected progress 0.75, got %f", ms[0].Progress)
	}
}

func TestListMilestones_ProjectNil(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{"project": nil}))
	})
	defer srv.Close()

	ms, err := lt.ListMilestones("proj-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ms) != 0 {
		t.Errorf("expected empty, got %d", len(ms))
	}
}

func TestListMilestones_Cached(t *testing.T) {
	var calls int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Write(gqlResponse(map[string]any{
			"project": map[string]any{
				"projectMilestones": map[string]any{
					"nodes": []any{},
				},
			},
		}))
	})
	defer srv.Close()

	_, _ = lt.ListMilestones("proj-1")
	_, _ = lt.ListMilestones("proj-1")
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

// ---------------------------------------------------------------------------
// ListIssues
// ---------------------------------------------------------------------------

func TestListIssues_NoMilestone(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"issues": map[string]any{
				"nodes": []any{sampleIssueNode()},
			},
		}))
	})
	defer srv.Close()

	issues, err := lt.ListIssues("proj-1", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(issues))
	}
	iss := issues[0]
	if iss.ID != "iss-1" {
		t.Errorf("expected iss-1, got %s", iss.ID)
	}
	if iss.Status != "In Progress" {
		t.Errorf("expected In Progress, got %s", iss.Status)
	}
	if iss.StatusType != "started" {
		t.Errorf("expected started, got %s", iss.StatusType)
	}
	if iss.Assignee == nil || *iss.Assignee != "Alice" {
		t.Errorf("expected Alice assignee, got %v", iss.Assignee)
	}
	if len(iss.Labels) != 1 || iss.Labels[0] != "bug" {
		t.Errorf("expected [bug] labels, got %v", iss.Labels)
	}
	if iss.Estimate == nil || *iss.Estimate != 3 {
		t.Errorf("expected estimate 3, got %v", iss.Estimate)
	}
	if iss.MilestoneID == nil || *iss.MilestoneID != "ms-1" {
		t.Errorf("expected milestoneID ms-1, got %v", iss.MilestoneID)
	}
}

func TestListIssues_WithMilestone(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		// Verify milestoneId is included in request
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		vars := req["variables"].(map[string]any)
		if _, ok := vars["milestoneId"]; !ok {
			t.Error("expected milestoneId in variables")
		}
		w.Write(gqlResponse(map[string]any{
			"issues": map[string]any{
				"nodes": []any{sampleIssueNode()},
			},
		}))
	})
	defer srv.Close()

	msID := "ms-1"
	issues, err := lt.ListIssues("proj-1", &msID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(issues) != 1 {
		t.Errorf("expected 1 issue, got %d", len(issues))
	}
}

func TestListIssues_EmptyMilestone(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		vars := req["variables"].(map[string]any)
		// Empty milestoneID should use qListIssues (no milestoneId var)
		if _, ok := vars["milestoneId"]; ok {
			t.Error("did not expect milestoneId in variables for empty milestone")
		}
		w.Write(gqlResponse(map[string]any{
			"issues": map[string]any{"nodes": []any{}},
		}))
	})
	defer srv.Close()

	empty := ""
	issues, err := lt.ListIssues("proj-1", &empty)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(issues) != 0 {
		t.Errorf("expected 0 issues, got %d", len(issues))
	}
}

func TestListIssues_Cached(t *testing.T) {
	var calls int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Write(gqlResponse(map[string]any{
			"issues": map[string]any{"nodes": []any{}},
		}))
	})
	defer srv.Close()

	_, _ = lt.ListIssues("proj-1", nil)
	_, _ = lt.ListIssues("proj-1", nil)
	if atomic.LoadInt32(&calls) != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

// ---------------------------------------------------------------------------
// CreateProject
// ---------------------------------------------------------------------------

func TestCreateProject(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"projectCreate": map[string]any{
				"project": map[string]any{"id": "new-proj"},
				"success": true,
			},
		}))
	})
	defer srv.Close()

	id, err := lt.CreateProject("New", "desc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "new-proj" {
		t.Errorf("expected new-proj, got %s", id)
	}
}

func TestCreateProject_FailedResponse(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"projectCreate": map[string]any{
				"project": nil,
			},
		}))
	})
	defer srv.Close()

	_, err := lt.CreateProject("Bad", "desc")
	if err == nil || !strings.Contains(err.Error(), "failed to create") {
		t.Errorf("expected create failure, got %v", err)
	}
}

func TestCreateProject_TeamAutoDiscovery(t *testing.T) {
	var callNum int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&callNum, 1)
		if n == 1 {
			// Team discovery
			w.Write(gqlResponse(map[string]any{
				"teams": map[string]any{
					"nodes": []any{
						map[string]any{"id": "discovered-team"},
					},
				},
			}))
			return
		}
		w.Write(gqlResponse(map[string]any{
			"projectCreate": map[string]any{
				"project": map[string]any{"id": "p1"},
				"success": true,
			},
		}))
	})
	defer srv.Close()

	lt.teamID = "" // force discovery
	id, err := lt.CreateProject("P", "D")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "p1" {
		t.Errorf("expected p1, got %s", id)
	}
	if lt.teamID != "discovered-team" {
		t.Errorf("expected discovered-team, got %s", lt.teamID)
	}
}

// ---------------------------------------------------------------------------
// CreateMilestone
// ---------------------------------------------------------------------------

func TestCreateMilestone(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"projectMilestoneCreate": map[string]any{
				"projectMilestone": map[string]any{"id": "ms-new"},
				"success":          true,
			},
		}))
	})
	defer srv.Close()

	id, err := lt.CreateMilestone("M1", "proj-1", 1.0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "ms-new" {
		t.Errorf("expected ms-new, got %s", id)
	}
}

func TestCreateMilestone_FailedResponse(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"projectMilestoneCreate": map[string]any{
				"projectMilestone": nil,
			},
		}))
	})
	defer srv.Close()

	_, err := lt.CreateMilestone("Bad", "proj-1", 1.0)
	if err == nil || !strings.Contains(err.Error(), "failed to create") {
		t.Errorf("expected create failure, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// CreateIssue
// ---------------------------------------------------------------------------

func TestCreateIssue(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"issueCreate": map[string]any{
				"issue":   map[string]any{"id": "iss-new", "identifier": "T-1"},
				"success": true,
			},
		}))
	})
	defer srv.Close()

	msID := "ms-1"
	est := 5
	id, err := lt.CreateIssue("Title", "Desc", "proj-1", &msID, &est)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "iss-new" {
		t.Errorf("expected iss-new, got %s", id)
	}
}

func TestCreateIssue_NoOptionals(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		vars := req["variables"].(map[string]any)
		if _, ok := vars["projectMilestoneId"]; ok {
			t.Error("did not expect projectMilestoneId")
		}
		if _, ok := vars["estimate"]; ok {
			t.Error("did not expect estimate")
		}
		w.Write(gqlResponse(map[string]any{
			"issueCreate": map[string]any{
				"issue":   map[string]any{"id": "iss-2", "identifier": "T-2"},
				"success": true,
			},
		}))
	})
	defer srv.Close()

	id, err := lt.CreateIssue("Title", "Desc", "proj-1", nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "iss-2" {
		t.Errorf("expected iss-2, got %s", id)
	}
}

func TestCreateIssue_FailedResponse(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"issueCreate": map[string]any{
				"issue": nil,
			},
		}))
	})
	defer srv.Close()

	_, err := lt.CreateIssue("Bad", "", "proj-1", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "failed to create") {
		t.Errorf("expected create failure, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// UpdateIssueState
// ---------------------------------------------------------------------------

func TestUpdateIssueState(t *testing.T) {
	var callNum int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&callNum, 1)
		switch n {
		case 1: // IssueTeam query
			w.Write(gqlResponse(map[string]any{
				"issue": map[string]any{
					"team": map[string]any{"id": "team-1"},
				},
			}))
		case 2: // TeamStates query
			w.Write(gqlResponse(map[string]any{
				"team": map[string]any{
					"states": map[string]any{
						"nodes": []any{
							map[string]any{"id": "state-1", "name": "Todo"},
							map[string]any{"id": "state-2", "name": "Done"},
						},
					},
				},
			}))
		case 3: // UpdateIssueState mutation
			w.Write(gqlResponse(map[string]any{
				"issueUpdate": map[string]any{
					"issue":   map[string]any{"id": "iss-1", "state": map[string]any{"name": "Done"}},
					"success": true,
				},
			}))
		}
	})
	defer srv.Close()

	err := lt.UpdateIssueState("iss-1", "Done")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if atomic.LoadInt32(&callNum) != 3 {
		t.Errorf("expected 3 API calls, got %d", callNum)
	}
}

func TestUpdateIssueState_CaseInsensitive(t *testing.T) {
	var callNum int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&callNum, 1)
		switch n {
		case 1:
			w.Write(gqlResponse(map[string]any{
				"issue": map[string]any{
					"team": map[string]any{"id": "team-1"},
				},
			}))
		case 2:
			w.Write(gqlResponse(map[string]any{
				"team": map[string]any{
					"states": map[string]any{
						"nodes": []any{
							map[string]any{"id": "state-1", "name": "In Progress"},
						},
					},
				},
			}))
		case 3:
			w.Write(gqlResponse(map[string]any{
				"issueUpdate": map[string]any{
					"issue":   map[string]any{"id": "iss-1"},
					"success": true,
				},
			}))
		}
	})
	defer srv.Close()

	err := lt.UpdateIssueState("iss-1", "in progress")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpdateIssueState_StateNotFound(t *testing.T) {
	var callNum int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&callNum, 1)
		switch n {
		case 1:
			w.Write(gqlResponse(map[string]any{
				"issue": map[string]any{
					"team": map[string]any{"id": "team-1"},
				},
			}))
		case 2:
			w.Write(gqlResponse(map[string]any{
				"team": map[string]any{
					"states": map[string]any{
						"nodes": []any{
							map[string]any{"id": "state-1", "name": "Todo"},
						},
					},
				},
			}))
		}
	})
	defer srv.Close()

	err := lt.UpdateIssueState("iss-1", "Nonexistent")
	if err == nil || !strings.Contains(err.Error(), "state 'Nonexistent' not found") {
		t.Errorf("expected state not found error, got %v", err)
	}
}

func TestUpdateIssueState_IssueNotFound(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"issue": nil,
		}))
	})
	defer srv.Close()

	err := lt.UpdateIssueState("bad-id", "Done")
	if err == nil || !strings.Contains(err.Error(), "issue not found") {
		t.Errorf("expected issue not found error, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// AddComment
// ---------------------------------------------------------------------------

func TestAddComment(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"commentCreate": map[string]any{"success": true},
		}))
	})
	defer srv.Close()

	err := lt.AddComment("iss-1", "Hello")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Cache tests
// ---------------------------------------------------------------------------

func TestCache_GetSetExpiry(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{APIKey: "k", CacheTTL: 1})

	// Empty cache returns nil
	if v := lt.getCached("key"); v != nil {
		t.Errorf("expected nil for missing key, got %v", v)
	}

	// Set and get
	lt.setCached("key", "value")
	if v := lt.getCached("key"); v != "value" {
		t.Errorf("expected value, got %v", v)
	}

	// Wait for expiry
	time.Sleep(1100 * time.Millisecond)
	if v := lt.getCached("key"); v != nil {
		t.Errorf("expected nil after expiry, got %v", v)
	}
}

func TestCache_Invalidate(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{APIKey: "k", CacheTTL: 60})

	lt.setCached("projects:all", "p1")
	lt.setCached("projects:single", "p2")
	lt.setCached("milestones:p1", "m1")

	lt.invalidateCache("projects")
	if v := lt.getCached("projects:all"); v != nil {
		t.Error("expected projects:all invalidated")
	}
	if v := lt.getCached("projects:single"); v != nil {
		t.Error("expected projects:single invalidated")
	}
	if v := lt.getCached("milestones:p1"); v != "m1" {
		t.Error("expected milestones:p1 to survive")
	}
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

func TestGraphQLError(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlError("Something went wrong"))
	})
	defer srv.Close()

	_, err := lt.ListProjects()
	if err == nil || !strings.Contains(err.Error(), "Something went wrong") {
		t.Errorf("expected graphql error, got %v", err)
	}
}

func TestHTTP400Error(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("bad request body"))
	})
	defer srv.Close()

	_, err := lt.ListProjects()
	if err == nil || !strings.Contains(err.Error(), "400") {
		t.Errorf("expected 400 error, got %v", err)
	}
}

func TestHTTP429Retry(t *testing.T) {
	var calls int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			w.Header().Set("Retry-After", "0.1")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte("rate limited"))
			return
		}
		w.Write(gqlResponse(map[string]any{
			"projects": map[string]any{"nodes": []any{}},
		}))
	})
	defer srv.Close()

	projects, err := lt.ListProjects()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(projects) != 0 {
		t.Errorf("expected 0 projects, got %d", len(projects))
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Errorf("expected 2 calls (1 retry), got %d", calls)
	}
}

func TestHTTP429ExhaustedRetries(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "0.01")
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte("rate limited"))
	})
	defer srv.Close()

	_, err := lt.ListProjects()
	if err == nil || !strings.Contains(err.Error(), "429") {
		t.Errorf("expected 429 error after exhausting retries, got %v", err)
	}
}

func TestHTTP429NoRetryAfterHeader(t *testing.T) {
	var calls int32
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			// No Retry-After header; should default to 1s min
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte("rate limited"))
			return
		}
		w.Write(gqlResponse(map[string]any{
			"projects": map[string]any{"nodes": []any{}},
		}))
	})
	defer srv.Close()

	_, err := lt.ListProjects()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Team discovery
// ---------------------------------------------------------------------------

func TestGetTeamID_NoTeams(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		w.Write(gqlResponse(map[string]any{
			"teams": map[string]any{
				"nodes": []any{},
			},
		}))
	})
	defer srv.Close()

	lt.teamID = ""
	_, err := lt.CreateProject("P", "D")
	if err == nil || !strings.Contains(err.Error(), "no Linear teams") {
		t.Errorf("expected no teams error, got %v", err)
	}
}

func TestGetTeamID_AlreadySet(t *testing.T) {
	lt := NewLinearTracker(LinearConfig{APIKey: "k", TeamID: "t-1"})
	id, err := lt.getTeamID()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "t-1" {
		t.Errorf("expected t-1, got %s", id)
	}
}

// ---------------------------------------------------------------------------
// parseProgress
// ---------------------------------------------------------------------------

func TestParseProgress(t *testing.T) {
	tests := []struct {
		name   string
		input  any
		expect float64
	}{
		{"nil", nil, 0},
		{"float64", float64(50), 0.5},
		{"int", 75, 0.75},
		{"string percent", "80%", 0.8},
		{"string no percent", "60", 0.6},
		{"zero", float64(0), 0},
		{"unknown type", true, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseProgress(tt.input)
			if fmt.Sprintf("%.4f", got) != fmt.Sprintf("%.4f", tt.expect) {
				t.Errorf("parseProgress(%v) = %f, want %f", tt.input, got, tt.expect)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// nodeToProject
// ---------------------------------------------------------------------------

func TestNodeToProject_WithMilestones(t *testing.T) {
	node := map[string]any{
		"id":    "p1",
		"name":  "P1",
		"state": "planned",
		"url":   "https://linear.app/t/project/my-proj-xyz",
		"slugId": "xyz",
		"progress": float64(50),
		"projectMilestones": map[string]any{
			"nodes": []any{
				map[string]any{"id": "ms-1", "progress": float64(40)},
				map[string]any{"id": "ms-2", "progress": float64(60)},
			},
		},
		"issues": map[string]any{"nodes": []any{}},
	}

	p := nodeToProject(node)
	if p.MilestoneCount != 2 {
		t.Errorf("expected 2 milestones, got %d", p.MilestoneCount)
	}
	// Progress should be average of milestones: (0.4 + 0.6) / 2 = 0.5
	if fmt.Sprintf("%.2f", p.Progress) != "0.50" {
		t.Errorf("expected progress 0.50, got %.2f", p.Progress)
	}
	if p.Slug != "my-proj" {
		t.Errorf("expected slug my-proj, got %s", p.Slug)
	}
}

func TestNodeToProject_NoSlug(t *testing.T) {
	node := map[string]any{
		"id":   "p1",
		"name": "P1",
		"url":  "",
		"projectMilestones": map[string]any{"nodes": []any{}},
		"issues":            map[string]any{"nodes": []any{}},
	}
	p := nodeToProject(node)
	if p.Slug != "" {
		t.Errorf("expected empty slug, got %s", p.Slug)
	}
}

// ---------------------------------------------------------------------------
// nodeToMilestone
// ---------------------------------------------------------------------------

func TestNodeToMilestone(t *testing.T) {
	ms := nodeToMilestone(sampleMilestoneNode(), "proj-1")
	if ms.ID != "ms-1" {
		t.Errorf("expected ms-1, got %s", ms.ID)
	}
	if ms.ProjectID != "proj-1" {
		t.Errorf("expected proj-1, got %s", ms.ProjectID)
	}
	if ms.TargetDate == nil || *ms.TargetDate != "2025-03-01" {
		t.Errorf("expected target date 2025-03-01, got %v", ms.TargetDate)
	}
}

// ---------------------------------------------------------------------------
// nodeToIssue
// ---------------------------------------------------------------------------

func TestNodeToIssue_Full(t *testing.T) {
	iss := nodeToIssue(sampleIssueNode())
	if iss.ID != "iss-1" {
		t.Errorf("expected iss-1, got %s", iss.ID)
	}
	if iss.Identifier != "TEAM-1" {
		t.Errorf("expected TEAM-1, got %s", iss.Identifier)
	}
	if iss.Assignee == nil || *iss.Assignee != "Alice" {
		t.Errorf("expected Alice, got %v", iss.Assignee)
	}
	if iss.MilestoneID == nil || *iss.MilestoneID != "ms-1" {
		t.Errorf("expected ms-1, got %v", iss.MilestoneID)
	}
}

func TestNodeToIssue_Minimal(t *testing.T) {
	node := map[string]any{
		"id":    "iss-2",
		"title": "Bare issue",
	}
	iss := nodeToIssue(node)
	if iss.ID != "iss-2" {
		t.Errorf("expected iss-2, got %s", iss.ID)
	}
	if iss.Assignee != nil {
		t.Errorf("expected nil assignee, got %v", iss.Assignee)
	}
	if len(iss.Labels) != 0 {
		t.Errorf("expected empty labels, got %v", iss.Labels)
	}
	if iss.MilestoneID != nil {
		t.Errorf("expected nil milestoneID, got %v", iss.MilestoneID)
	}
	if iss.Estimate != nil {
		t.Errorf("expected nil estimate, got %v", iss.Estimate)
	}
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func TestJsonStr(t *testing.T) {
	if v := jsonStr(nil, "k"); v != "" {
		t.Errorf("expected empty, got %s", v)
	}
	m := map[string]any{"k": "v", "num": float64(1)}
	if v := jsonStr(m, "k"); v != "v" {
		t.Errorf("expected v, got %s", v)
	}
	if v := jsonStr(m, "num"); v != "" {
		t.Errorf("expected empty for non-string, got %s", v)
	}
	if v := jsonStr(m, "missing"); v != "" {
		t.Errorf("expected empty for missing, got %s", v)
	}
}

func TestJsonStrPtr(t *testing.T) {
	if v := jsonStrPtr(nil, "k"); v != nil {
		t.Errorf("expected nil, got %v", v)
	}
	m := map[string]any{"k": "v", "empty": ""}
	if v := jsonStrPtr(m, "k"); v == nil || *v != "v" {
		t.Errorf("expected v, got %v", v)
	}
	if v := jsonStrPtr(m, "empty"); v != nil {
		t.Errorf("expected nil for empty string, got %v", v)
	}
	if v := jsonStrPtr(m, "missing"); v != nil {
		t.Errorf("expected nil for missing, got %v", v)
	}
}

func TestJsonInt(t *testing.T) {
	if v := jsonInt(nil, "k"); v != 0 {
		t.Errorf("expected 0, got %d", v)
	}
	m := map[string]any{"f": float64(5), "i": 3, "s": "x"}
	if v := jsonInt(m, "f"); v != 5 {
		t.Errorf("expected 5, got %d", v)
	}
	if v := jsonInt(m, "i"); v != 3 {
		t.Errorf("expected 3, got %d", v)
	}
	if v := jsonInt(m, "s"); v != 0 {
		t.Errorf("expected 0 for string, got %d", v)
	}
	if v := jsonInt(m, "missing"); v != 0 {
		t.Errorf("expected 0 for missing, got %d", v)
	}
}

func TestJsonIntPtr(t *testing.T) {
	if v := jsonIntPtr(nil, "k"); v != nil {
		t.Errorf("expected nil, got %v", v)
	}
	m := map[string]any{"f": float64(5), "i": 3, "s": "x"}
	if v := jsonIntPtr(m, "f"); v == nil || *v != 5 {
		t.Errorf("expected 5, got %v", v)
	}
	if v := jsonIntPtr(m, "i"); v == nil || *v != 3 {
		t.Errorf("expected 3, got %v", v)
	}
	if v := jsonIntPtr(m, "s"); v != nil {
		t.Errorf("expected nil for string, got %v", v)
	}
}

func TestJsonMap(t *testing.T) {
	if v := jsonMap(nil, "k"); v != nil {
		t.Errorf("expected nil, got %v", v)
	}
	inner := map[string]any{"x": "y"}
	m := map[string]any{"k": inner, "s": "str"}
	if v := jsonMap(m, "k"); v == nil || v["x"] != "y" {
		t.Errorf("expected inner map, got %v", v)
	}
	if v := jsonMap(m, "s"); v != nil {
		t.Errorf("expected nil for string, got %v", v)
	}
}

func TestJsonNodes(t *testing.T) {
	if v := jsonNodes(nil, "k"); v != nil {
		t.Errorf("expected nil, got %v", v)
	}
	m := map[string]any{
		"k": map[string]any{
			"nodes": []any{
				map[string]any{"id": "1"},
				map[string]any{"id": "2"},
			},
		},
		"empty": map[string]any{
			"nodes": []any{},
		},
		"bad": map[string]any{},
	}
	nodes := jsonNodes(m, "k")
	if len(nodes) != 2 {
		t.Errorf("expected 2 nodes, got %d", len(nodes))
	}
	if jsonStr(nodes[0], "id") != "1" {
		t.Errorf("expected id 1, got %s", jsonStr(nodes[0], "id"))
	}
	empty := jsonNodes(m, "empty")
	if len(empty) != 0 {
		t.Errorf("expected 0 nodes, got %d", len(empty))
	}
	if v := jsonNodes(m, "bad"); len(v) != 0 {
		t.Errorf("expected 0 for no nodes key, got %d", len(v))
	}
	if v := jsonNodes(m, "missing"); v != nil {
		t.Errorf("expected nil for missing key, got %v", v)
	}
}

func TestJsonNodesKey(t *testing.T) {
	m := map[string]any{
		"items": map[string]any{
			"nodes": []any{map[string]any{"id": "a"}},
		},
	}
	nodes := jsonNodesKey(m, "items")
	if len(nodes) != 1 || jsonStr(nodes[0], "id") != "a" {
		t.Errorf("expected 1 node with id=a, got %v", nodes)
	}
}

func TestJsonNested(t *testing.T) {
	m := map[string]any{
		"a": map[string]any{
			"b": map[string]any{
				"c": "deep",
			},
		},
	}
	if v := jsonNested(m, "a", "b"); v == nil || v["c"] != "deep" {
		t.Errorf("expected deep nested, got %v", v)
	}
	if v := jsonNested(m, "a", "x"); v != nil {
		t.Errorf("expected nil for missing path, got %v", v)
	}
	if v := jsonNested(nil); v != nil {
		t.Errorf("expected nil for nil map, got %v", v)
	}
}

func TestCopyMap(t *testing.T) {
	orig := map[string]any{"a": 1, "b": "two"}
	cp := copyMap(orig)
	if len(cp) != 2 || cp["a"] != 1 || cp["b"] != "two" {
		t.Errorf("copy mismatch: %v", cp)
	}
	cp["a"] = 99
	if orig["a"] == 99 {
		t.Error("copy should not affect original")
	}
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

func TestAuthHeaderSent(t *testing.T) {
	lt, srv := newTestTracker(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "test-key" {
			t.Errorf("expected Authorization: test-key, got %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type: application/json, got %s", r.Header.Get("Content-Type"))
		}
		w.Write(gqlResponse(map[string]any{
			"projects": map[string]any{"nodes": []any{}},
		}))
	})
	defer srv.Close()

	_, _ = lt.ListProjects()
}

// ---------------------------------------------------------------------------
// Tracker interface compliance
// ---------------------------------------------------------------------------

func TestLinearTrackerImplementsTracker(t *testing.T) {
	var _ Tracker = (*LinearTracker)(nil)
}
