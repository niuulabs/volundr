package tracker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const linearAPIURL = "https://api.linear.app/graphql"

// LinearTracker implements Tracker using the Linear GraphQL API.
type LinearTracker struct {
	apiKey     string
	apiURL     string
	teamID     string
	client     *http.Client
	maxRetries int

	mu    sync.RWMutex
	cache map[string]*cacheEntry
	ttl   time.Duration
}

type cacheEntry struct {
	value     any
	expiresAt time.Time
}

// LinearConfig holds configuration for the Linear tracker.
type LinearConfig struct {
	APIKey     string `yaml:"api_key"`
	TeamID     string `yaml:"team_id,omitempty"`
	APIURL     string `yaml:"api_url,omitempty"`
	CacheTTL   int    `yaml:"cache_ttl,omitempty"` // seconds
	MaxRetries int    `yaml:"max_retries,omitempty"`
}

// NewLinearTracker creates a Linear tracker adapter.
func NewLinearTracker(cfg LinearConfig) *LinearTracker {
	apiURL := cfg.APIURL
	if apiURL == "" {
		apiURL = linearAPIURL
	}
	ttl := time.Duration(cfg.CacheTTL) * time.Second
	if ttl == 0 {
		ttl = 30 * time.Second
	}
	maxRetries := cfg.MaxRetries
	if maxRetries == 0 {
		maxRetries = 3
	}
	return &LinearTracker{
		apiKey:     cfg.APIKey,
		apiURL:     apiURL,
		teamID:     cfg.TeamID,
		client:     &http.Client{Timeout: 15 * time.Second},
		maxRetries: maxRetries,
		cache:      make(map[string]*cacheEntry),
		ttl:        ttl,
	}
}

// Close is a no-op for the HTTP-based client.
func (lt *LinearTracker) Close() error { return nil }

// GraphQL execution.

func (lt *LinearTracker) query(gql string, vars map[string]any) (map[string]any, error) {
	payload := map[string]any{"query": gql}
	if vars != nil {
		payload["variables"] = vars
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal graphql: %w", err)
	}

	var lastErr error
	for attempt := range lt.maxRetries + 1 {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, lt.apiURL, bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		req.Header.Set("Authorization", lt.apiKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := lt.client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		respBody, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests && attempt < lt.maxRetries {
			retryAfter, _ := strconv.ParseFloat(resp.Header.Get("Retry-After"), 64)
			if retryAfter < 1 {
				retryAfter = 1
			}
			time.Sleep(time.Duration(retryAfter * float64(time.Second)))
			continue
		}

		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("linear api error %d: %s", resp.StatusCode, string(respBody[:min(len(respBody), 500)]))
		}

		var result struct {
			Data   map[string]any `json:"data"`
			Errors []struct {
				Message string `json:"message"`
			} `json:"errors"`
		}
		if err := json.Unmarshal(respBody, &result); err != nil {
			return nil, fmt.Errorf("unmarshal response: %w", err)
		}
		if len(result.Errors) > 0 {
			return nil, fmt.Errorf("graphql error: %s", result.Errors[0].Message)
		}
		return result.Data, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("exhausted retries")
}

// Cache.

func (lt *LinearTracker) getCached(key string) any {
	lt.mu.RLock()
	defer lt.mu.RUnlock()
	e, ok := lt.cache[key]
	if !ok || time.Now().After(e.expiresAt) {
		return nil
	}
	return e.value
}

func (lt *LinearTracker) setCached(key string, value any) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	lt.cache[key] = &cacheEntry{value: value, expiresAt: time.Now().Add(lt.ttl)}
}

func (lt *LinearTracker) invalidateCache(prefix string) {
	lt.mu.Lock()
	defer lt.mu.Unlock()
	for k := range lt.cache {
		if strings.HasPrefix(k, prefix) {
			delete(lt.cache, k)
		}
	}
}

// Team discovery.

func (lt *LinearTracker) getTeamID() (string, error) {
	if lt.teamID != "" {
		return lt.teamID, nil
	}
	data, err := lt.query("{ teams { nodes { id } } }", nil)
	if err != nil {
		return "", err
	}
	nodes := jsonNodes(data, "teams")
	if len(nodes) == 0 {
		return "", fmt.Errorf("no Linear teams accessible with this API key")
	}
	lt.teamID = jsonStr(nodes[0], "id")
	return lt.teamID, nil
}

// CRUD: Read.

// ListProjects returns all accessible Linear projects.
func (lt *LinearTracker) ListProjects() ([]Project, error) {
	if cached := lt.getCached("projects:all"); cached != nil {
		return cached.([]Project), nil
	}
	data, err := lt.query(qListProjects, map[string]any{"first": 50})
	if err != nil {
		return nil, err
	}
	nodes := jsonNodes(data, "projects")
	projects := make([]Project, 0, len(nodes))
	for _, n := range nodes {
		projects = append(projects, nodeToProject(n))
	}
	lt.setCached("projects:all", projects)
	return projects, nil
}

// GetProject returns a single Linear project by ID.
func (lt *LinearTracker) GetProject(id string) (*Project, error) {
	data, err := lt.query(qGetProject, map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	node, ok := data["project"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("project not found: %s", id)
	}
	p := nodeToProject(node)
	return &p, nil
}

// GetProjectFull returns a project with its milestones and issues.
func (lt *LinearTracker) GetProjectFull(id string) (*Project, []Milestone, []Issue, error) {
	data, err := lt.query(qGetProjectFull, map[string]any{"id": id, "issueFirst": 250})
	if err != nil {
		return nil, nil, nil, err
	}
	node, ok := data["project"].(map[string]any)
	if !ok {
		return nil, nil, nil, fmt.Errorf("project not found: %s", id)
	}

	// The full query uses aliased fields.
	countsNode := node
	if ic, ok := node["issueCount"]; ok {
		countsNode = copyMap(node)
		countsNode["issues"] = ic
	}
	p := nodeToProject(countsNode)

	msNodes := jsonNodes(node, "projectMilestones")
	milestones := make([]Milestone, 0, len(msNodes))
	for _, mn := range msNodes {
		milestones = append(milestones, nodeToMilestone(mn, id))
	}

	issueNodes := jsonNodesKey(node, "issuesFull")
	issues := make([]Issue, 0, len(issueNodes))
	for _, issueNode := range issueNodes {
		issues = append(issues, nodeToIssue(issueNode))
	}

	return &p, milestones, issues, nil
}

// ListMilestones returns milestones for a given project.
func (lt *LinearTracker) ListMilestones(projectID string) ([]Milestone, error) {
	cacheKey := "milestones:" + projectID
	if cached := lt.getCached(cacheKey); cached != nil {
		return cached.([]Milestone), nil
	}
	data, err := lt.query(qListMilestones, map[string]any{"projectId": projectID})
	if err != nil {
		return nil, err
	}
	project, _ := data["project"].(map[string]any)
	if project == nil {
		return []Milestone{}, nil
	}
	nodes := jsonNodes(project, "projectMilestones")
	milestones := make([]Milestone, 0, len(nodes))
	for _, n := range nodes {
		milestones = append(milestones, nodeToMilestone(n, projectID))
	}
	lt.setCached(cacheKey, milestones)
	return milestones, nil
}

// ListIssues returns issues for a project, optionally filtered by milestone.
func (lt *LinearTracker) ListIssues(projectID string, milestoneID *string) ([]Issue, error) {
	cacheKey := fmt.Sprintf("issues:%s:%v", projectID, milestoneID)
	if cached := lt.getCached(cacheKey); cached != nil {
		return cached.([]Issue), nil
	}

	var data map[string]any
	var err error
	if milestoneID != nil && *milestoneID != "" {
		data, err = lt.query(qListIssuesByMilestone, map[string]any{
			"projectId": projectID, "milestoneId": *milestoneID, "first": 100,
		})
	} else {
		data, err = lt.query(qListIssues, map[string]any{
			"projectId": projectID, "first": 100,
		})
	}
	if err != nil {
		return nil, err
	}

	nodes := jsonNodes(data, "issues")
	issues := make([]Issue, 0, len(nodes))
	for _, n := range nodes {
		issues = append(issues, nodeToIssue(n))
	}
	lt.setCached(cacheKey, issues)
	return issues, nil
}

// CRUD: Create.

// CreateProject creates a new Linear project and returns its ID.
func (lt *LinearTracker) CreateProject(name, description string) (string, error) {
	teamID, err := lt.getTeamID()
	if err != nil {
		return "", err
	}
	data, err := lt.query(qCreateProject, map[string]any{
		"name": name, "description": description, "teamIds": []string{teamID},
	})
	if err != nil {
		return "", err
	}
	project := jsonNested(data, "projectCreate", "project")
	if project == nil {
		return "", fmt.Errorf("failed to create Linear project")
	}
	lt.invalidateCache("projects")
	return jsonStr(project, "id"), nil
}

// CreateMilestone creates a new milestone in a Linear project and returns its ID.
func (lt *LinearTracker) CreateMilestone(name, projectID string, sortOrder float64) (string, error) {
	data, err := lt.query(qCreateMilestone, map[string]any{
		"name": name, "projectId": projectID, "sortOrder": sortOrder,
	})
	if err != nil {
		return "", err
	}
	ms := jsonNested(data, "projectMilestoneCreate", "projectMilestone")
	if ms == nil {
		return "", fmt.Errorf("failed to create Linear milestone")
	}
	lt.invalidateCache("milestones")
	return jsonStr(ms, "id"), nil
}

// CreateIssue creates a new issue in a Linear project and returns its ID.
func (lt *LinearTracker) CreateIssue(title, description, projectID string, milestoneID *string, estimate *int) (string, error) {
	teamID, err := lt.getTeamID()
	if err != nil {
		return "", err
	}
	vars := map[string]any{
		"title": title, "description": description,
		"projectId": projectID, "teamId": teamID,
	}
	if milestoneID != nil {
		vars["projectMilestoneId"] = *milestoneID
	}
	if estimate != nil {
		vars["estimate"] = *estimate
	}
	data, err := lt.query(qCreateIssue, vars)
	if err != nil {
		return "", err
	}
	issue := jsonNested(data, "issueCreate", "issue")
	if issue == nil {
		return "", fmt.Errorf("failed to create Linear issue")
	}
	lt.invalidateCache("issues")
	return jsonStr(issue, "id"), nil
}

// CRUD: Update.

// UpdateIssueState transitions a Linear issue to the named workflow state.
func (lt *LinearTracker) UpdateIssueState(issueID, stateName string) error {
	stateID, err := lt.resolveStateID(issueID, stateName)
	if err != nil {
		return err
	}
	_, err = lt.query(qUpdateIssueState, map[string]any{
		"issueId": issueID, "stateId": stateID,
	})
	if err != nil {
		return err
	}
	lt.invalidateCache("issues")
	return nil
}

// AddComment adds a comment to a Linear issue.
func (lt *LinearTracker) AddComment(issueID, body string) error {
	_, err := lt.query(qAddComment, map[string]any{
		"issueId": issueID, "body": body,
	})
	return err
}

// Internal helpers.

func (lt *LinearTracker) resolveStateID(issueID, stateName string) (string, error) {
	data, err := lt.query(qIssueTeam, map[string]any{"id": issueID})
	if err != nil {
		return "", err
	}
	issue, _ := data["issue"].(map[string]any)
	if issue == nil {
		return "", fmt.Errorf("issue not found: %s", issueID)
	}
	team, _ := issue["team"].(map[string]any)
	teamID := jsonStr(team, "id")

	data, err = lt.query(qTeamStates, map[string]any{"teamId": teamID})
	if err != nil {
		return "", err
	}
	states := jsonNodes(jsonMap(data, "team"), "states")
	for _, s := range states {
		if strings.EqualFold(jsonStr(s, "name"), stateName) {
			return jsonStr(s, "id"), nil
		}
	}
	var available []string
	for _, s := range states {
		available = append(available, jsonStr(s, "name"))
	}
	return "", fmt.Errorf("state '%s' not found. Available: %s", stateName, strings.Join(available, ", "))
}

// Node conversion.

func nodeToProject(n map[string]any) Project {
	msNodes := jsonNodes(n, "projectMilestones")
	progress := parseProgress(n["progress"])
	if len(msNodes) > 0 {
		var total float64
		for _, ms := range msNodes {
			total += parseProgress(ms["progress"])
		}
		progress = total / float64(len(msNodes))
	}

	slug := ""
	url := jsonStr(n, "url")
	slugID := jsonStr(n, "slugId")
	if url != "" && slugID != "" {
		parts := strings.Split(url, "/")
		last := parts[len(parts)-1]
		suffix := "-" + slugID
		if strings.HasSuffix(last, suffix) {
			slug = last[:len(last)-len(suffix)]
		}
	}

	return Project{
		ID:             jsonStr(n, "id"),
		Name:           jsonStr(n, "name"),
		Description:    jsonStr(n, "description"),
		Status:         jsonStr(n, "state"),
		URL:            url,
		MilestoneCount: len(msNodes),
		IssueCount:     len(jsonNodes(n, "issues")),
		Slug:           slug,
		Progress:       progress,
		StartDate:      jsonStrPtr(n, "startDate"),
		TargetDate:     jsonStrPtr(n, "targetDate"),
	}
}

func nodeToMilestone(n map[string]any, projectID string) Milestone {
	return Milestone{
		ID:         jsonStr(n, "id"),
		ProjectID:  projectID,
		Name:       jsonStr(n, "name"),
		Desc:       jsonStr(n, "description"),
		SortOrder:  jsonInt(n, "sortOrder"),
		Progress:   parseProgress(n["progress"]),
		TargetDate: jsonStrPtr(n, "targetDate"),
	}
}

func nodeToIssue(n map[string]any) Issue {
	state := jsonMap(n, "state")
	assignee := jsonMap(n, "assignee")
	var assigneeName *string
	if assignee != nil {
		name := jsonStr(assignee, "name")
		assigneeName = &name
	}

	labelNodes := jsonNodes(n, "labels")
	labels := make([]string, 0, len(labelNodes))
	for _, ln := range labelNodes {
		labels = append(labels, jsonStr(ln, "name"))
	}

	milestone := jsonMap(n, "projectMilestone")
	var msID *string
	if milestone != nil {
		id := jsonStr(milestone, "id")
		msID = &id
	}

	return Issue{
		ID:            jsonStr(n, "id"),
		Identifier:    jsonStr(n, "identifier"),
		Title:         jsonStr(n, "title"),
		Description:   jsonStr(n, "description"),
		Status:        jsonStr(state, "name"),
		StatusType:    jsonStr(state, "type"),
		Assignee:      assigneeName,
		Labels:        labels,
		Priority:      jsonInt(n, "priority"),
		PriorityLabel: jsonStr(n, "priorityLabel"),
		Estimate:      jsonIntPtr(n, "estimate"),
		URL:           jsonStr(n, "url"),
		MilestoneID:   msID,
	}
}

// JSON helpers.

func jsonStr(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func jsonStrPtr(m map[string]any, key string) *string {
	if m == nil {
		return nil
	}
	v, ok := m[key].(string)
	if !ok || v == "" {
		return nil
	}
	return &v
}

func jsonInt(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func jsonIntPtr(m map[string]any, key string) *int {
	if m == nil {
		return nil
	}
	switch v := m[key].(type) {
	case float64:
		i := int(v)
		return &i
	case int:
		return &v
	}
	return nil
}

func jsonMap(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	v, _ := m[key].(map[string]any)
	return v
}

func jsonNodes(m map[string]any, key string) []map[string]any {
	if m == nil {
		return nil
	}
	container, _ := m[key].(map[string]any)
	if container == nil {
		return nil
	}
	nodes, _ := container["nodes"].([]any)
	result := make([]map[string]any, 0, len(nodes))
	for _, n := range nodes {
		if nm, ok := n.(map[string]any); ok {
			result = append(result, nm)
		}
	}
	return result
}

func jsonNodesKey(m map[string]any, key string) []map[string]any {
	return jsonNodes(m, key)
}

func jsonNested(m map[string]any, keys ...string) map[string]any {
	current := m
	for _, k := range keys {
		next, _ := current[k].(map[string]any)
		if next == nil {
			return nil
		}
		current = next
	}
	return current
}

func copyMap(m map[string]any) map[string]any {
	cp := make(map[string]any, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}

func parseProgress(value any) float64 {
	if value == nil {
		return 0
	}
	switch v := value.(type) {
	case float64:
		return v / 100.0
	case int:
		return float64(v) / 100.0
	case string:
		s := strings.TrimSuffix(v, "%")
		f, _ := strconv.ParseFloat(s, 64)
		return f / 100.0
	}
	return 0
}
