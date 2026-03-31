package forge

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
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

// fetchGitHubRepos returns repos for the configured GitHub instances.
// Returns a map keyed by instance name.
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
			orgRepos := listOrgRepos(baseURL, token, org)
			repos = append(repos, orgRepos...)
		}

		// If no orgs configured, list user's repos.
		if len(inst.Orgs) == 0 {
			repos = append(repos, listUserRepos(baseURL, token)...)
		}

		name := inst.Name
		if name == "" {
			name = "github"
		}
		result[name] = repos
	}

	return result
}

func listOrgRepos(baseURL, token, org string) []GitHubRepo {
	url := fmt.Sprintf("%s/orgs/%s/repos?per_page=100&sort=updated", baseURL, org)
	return fetchRepoPage(url, token, org)
}

func listUserRepos(baseURL, token string) []GitHubRepo {
	url := fmt.Sprintf("%s/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member", baseURL)
	return fetchRepoPage(url, token, "")
}

func fetchRepoPage(url, token, defaultOrg string) []GitHubRepo {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
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

	var apiRepos []struct {
		FullName      string `json:"full_name"`
		Name          string `json:"name"`
		CloneURL      string `json:"clone_url"`
		HTMLURL       string `json:"html_url"`
		DefaultBranch string `json:"default_branch"`
		Owner         struct {
			Login string `json:"login"`
		} `json:"owner"`
	}
	if err := json.Unmarshal(body, &apiRepos); err != nil {
		return nil
	}

	repos := make([]GitHubRepo, 0, len(apiRepos))
	for _, r := range apiRepos {
		org := r.Owner.Login
		if org == "" {
			org = defaultOrg
		}
		repos = append(repos, GitHubRepo{
			Provider:      "github",
			Org:           org,
			Name:          r.Name,
			CloneURL:      r.CloneURL,
			URL:           r.HTMLURL,
			DefaultBranch: r.DefaultBranch,
			Branches:      []string{r.DefaultBranch},
		})
	}
	return repos
}

// GitHubInstance is a simplified config for the handler.
type GitHubInstance struct {
	Name     string
	BaseURL  string
	Token    string
	TokenEnv string
	Orgs     []string
}

// parseGitHubConfig extracts GitHub instances from the forge config's
// git section. The config stores instances but the handler needs them flat.
func parseGitHubConfig(instances []GitHubInstance) []GitHubInstance {
	// Filter out instances without tokens.
	var result []GitHubInstance
	for _, inst := range instances {
		token := inst.Token
		if token == "" && inst.TokenEnv != "" {
			token = os.Getenv(inst.TokenEnv)
		}
		if token != "" {
			result = append(result, inst)
		}
	}
	return result
}

// resolveGitHubToken returns a GitHub token from config or common env vars.
func resolveGitHubToken(cfg *Config) string {
	for _, inst := range cfg.GitHub {
		if inst.Token != "" {
			return inst.Token
		}
		if inst.TokenEnv != "" {
			if t := os.Getenv(inst.TokenEnv); t != "" {
				return t
			}
		}
	}
	// Fallback to common env vars.
	for _, env := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if t := os.Getenv(env); t != "" {
			return t
		}
	}
	return ""
}

// splitRepoFullName splits "org/name" into org and name.
func splitRepoFullName(fullName string) (org, name string) {
	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", fullName
}
