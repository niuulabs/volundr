package forge

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// GitHubRepo represents a repository from the GitHub API.
type GitHubRepo struct {
	Provider      string   `json:"provider"`
	Org           string   `json:"org"`
	Name          string   `json:"name"`
	CloneURL      string   `json:"clone_url"`
	URL           string   `json:"url"`
	DefaultBranch string   `json:"default_branch"`
	Branches      []string `json:"branches"`
}

// GitHubInstance is the config for a single GitHub instance.
type GitHubInstance struct {
	Name     string
	BaseURL  string
	Token    string
	TokenEnv string
	Orgs     []string
}

var ghClient = &http.Client{Timeout: 15 * time.Second}

// fetchGitHubRepos returns repos for the configured GitHub instances.
func fetchGitHubRepos(cfg *Config) map[string][]GitHubRepo {
	result := make(map[string][]GitHubRepo)

	for _, inst := range cfg.GitHub {
		token := inst.Token
		if token == "" && inst.TokenEnv != "" {
			token = os.Getenv(inst.TokenEnv)
		}
		if token == "" {
			continue
		}

		baseURL := inst.BaseURL
		if baseURL == "" {
			baseURL = "https://api.github.com"
		}

		var repos []GitHubRepo
		for _, org := range inst.Orgs {
			repos = append(repos, listReposForAccount(baseURL, token, org)...)
		}
		if len(inst.Orgs) == 0 {
			repos = append(repos, listUserRepos(baseURL, token)...)
		}

		// Fetch branches concurrently.
		fetchAllBranches(baseURL, token, repos)

		name := strings.ToLower(inst.Name)
		if name == "" {
			name = "github"
		}
		if repos == nil {
			repos = []GitHubRepo{}
		}
		result[name] = repos
	}

	return result
}

// listReposForAccount tries /orgs/{account}/repos first, then falls back
// to /user/repos filtered by owner for personal accounts.
func listReposForAccount(baseURL, token, account string) []GitHubRepo {
	// Try org endpoint first.
	url := fmt.Sprintf("%s/orgs/%s/repos?per_page=100&type=all&sort=updated", baseURL, account)
	repos, status := fetchRepoPages(url, token)
	if status != http.StatusNotFound {
		// Filter to this org's repos only.
		for i := range repos {
			if repos[i].Org == "" {
				repos[i].Org = account
			}
		}
		return repos
	}

	// Org not found — try as a personal account via /user/repos.
	log.Printf("github: org %q not found, falling back to user repos", account)
	url = fmt.Sprintf("%s/user/repos?per_page=100&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated", baseURL)
	allRepos, _ := fetchRepoPages(url, token)

	// Filter to repos owned by this account.
	var filtered []GitHubRepo
	for _, r := range allRepos {
		if strings.EqualFold(r.Org, account) {
			filtered = append(filtered, r)
		}
	}

	// If still empty, try /users/{account}/repos (public repos).
	if len(filtered) == 0 {
		url = fmt.Sprintf("%s/users/%s/repos?per_page=100&type=all&sort=updated", baseURL, account)
		filtered, _ = fetchRepoPages(url, token)
	}

	return filtered
}

func listUserRepos(baseURL, token string) []GitHubRepo {
	url := fmt.Sprintf("%s/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member", baseURL)
	repos, _ := fetchRepoPages(url, token)
	return repos
}

// fetchRepoPages fetches all pages of repos from a GitHub API URL.
// Returns the repos and the HTTP status of the first request.
func fetchRepoPages(url, token string) ([]GitHubRepo, int) {
	var allRepos []GitHubRepo
	firstStatus := 0

	for url != "" {
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			return allRepos, 0
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")

		resp, err := ghClient.Do(req)
		if err != nil {
			log.Printf("github: fetch repos error: %v", err)
			return allRepos, 0
		}

		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		if firstStatus == 0 {
			firstStatus = resp.StatusCode
		}

		if resp.StatusCode != http.StatusOK {
			if resp.StatusCode != http.StatusNotFound {
				log.Printf("github: %s returned %d", url, resp.StatusCode)
			}
			return allRepos, firstStatus
		}

		var apiRepos []struct {
			Name          string `json:"name"`
			CloneURL      string `json:"clone_url"`
			HTMLURL       string `json:"html_url"`
			DefaultBranch string `json:"default_branch"`
			Owner         struct {
				Login string `json:"login"`
			} `json:"owner"`
		}
		if err := json.Unmarshal(body, &apiRepos); err != nil {
			log.Printf("github: parse repos: %v", err)
			return allRepos, firstStatus
		}

		for _, r := range apiRepos {
			allRepos = append(allRepos, GitHubRepo{
				Provider:      "github",
				Org:           r.Owner.Login,
				Name:          r.Name,
				CloneURL:      r.CloneURL,
				URL:           r.HTMLURL,
				DefaultBranch: r.DefaultBranch,
				Branches:      []string{r.DefaultBranch}, // placeholder, filled later
			})
		}

		url = nextLink(resp.Header.Get("Link"))
	}

	return allRepos, firstStatus
}

// fetchAllBranches fetches branches for all repos concurrently.
func fetchAllBranches(baseURL, token string, repos []GitHubRepo) {
	var wg sync.WaitGroup
	for i := range repos {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			r := &repos[idx]
			branches := fetchBranches(baseURL, token, r.Org, r.Name)
			if len(branches) > 0 {
				r.Branches = branches
			}
		}(i)
	}
	wg.Wait()
}

func fetchBranches(baseURL, token, org, repo string) []string {
	url := fmt.Sprintf("%s/repos/%s/%s/branches?per_page=100", baseURL, org, repo)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := ghClient.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}

	var apiBranches []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &apiBranches); err != nil {
		return nil
	}

	branches := make([]string, len(apiBranches))
	for i, b := range apiBranches {
		branches[i] = b.Name
	}
	return branches
}

// nextLink parses the GitHub Link header to find the next page URL.
var linkNextRe = regexp.MustCompile(`<([^>]+)>;\s*rel="next"`)

func nextLink(header string) string {
	if header == "" {
		return ""
	}
	matches := linkNextRe.FindStringSubmatch(header)
	if len(matches) < 2 {
		return ""
	}
	return matches[1]
}
