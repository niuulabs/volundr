// Package tracker provides a tracker integration abstraction and
// a Linear implementation for tyr-mini.
package tracker

// Project represents an external tracker project (Linear project).
type Project struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	Status         string  `json:"status"`
	URL            string  `json:"url"`
	MilestoneCount int     `json:"milestone_count"`
	IssueCount     int     `json:"issue_count"`
	Slug           string  `json:"slug"`
	Progress       float64 `json:"progress"`
	StartDate      *string `json:"start_date"`
	TargetDate     *string `json:"target_date"`
}

// Milestone represents a project milestone (Linear project milestone).
type Milestone struct {
	ID         string  `json:"id"`
	ProjectID  string  `json:"project_id"`
	Name       string  `json:"name"`
	Desc       string  `json:"description"`
	SortOrder  int     `json:"sort_order"`
	Progress   float64 `json:"progress"`
	TargetDate *string `json:"target_date"`
}

// Issue represents a tracker issue (Linear issue).
type Issue struct {
	ID            string   `json:"id"`
	Identifier    string   `json:"identifier"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Status        string   `json:"status"`
	StatusType    string   `json:"status_type"`
	Assignee      *string  `json:"assignee"`
	Labels        []string `json:"labels"`
	Priority      int      `json:"priority"`
	PriorityLabel string   `json:"priority_label"`
	Estimate      *int     `json:"estimate"`
	URL           string   `json:"url"`
	MilestoneID   *string  `json:"milestone_id"`
}

// Tracker is the port for external issue tracker integration.
// Implementations: LinearTracker.
// TODO(tracker): Add GitHub Issues, Jira adapters.
type Tracker interface {
	ListProjects() ([]Project, error)
	GetProject(id string) (*Project, error)
	GetProjectFull(id string) (*Project, []Milestone, []Issue, error)
	ListMilestones(projectID string) ([]Milestone, error)
	ListIssues(projectID string, milestoneID *string) ([]Issue, error)

	CreateProject(name, description string) (string, error)
	CreateMilestone(name, projectID string, sortOrder float64) (string, error)
	CreateIssue(title, description, projectID string, milestoneID *string, estimate *int) (string, error)

	UpdateIssueState(issueID, stateName string) error
	AddComment(issueID, body string) error

	Close() error
}
