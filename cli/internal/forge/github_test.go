package forge

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNextLink(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"empty", "", ""},
		{"no next", `<https://api.github.com/repos?page=2>; rel="prev"`, ""},
		{"has next", `<https://api.github.com/repos?page=3>; rel="next"`, "https://api.github.com/repos?page=3"},
		{"next and prev", `<https://api.github.com/repos?page=1>; rel="prev", <https://api.github.com/repos?page=3>; rel="next"`, "https://api.github.com/repos?page=3"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nextLink(tt.header)
			if got != tt.want {
				t.Errorf("nextLink(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}

// fakeGitHubServer creates a mock GitHub API returning one repo and one branch.
func fakeGitHubServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	// Org repos endpoint.
	mux.HandleFunc("/orgs/testorg/repos", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		repos := []map[string]any{
			{
				"name":           "myrepo",
				"clone_url":      "https://github.com/testorg/myrepo.git",
				"html_url":       "https://github.com/testorg/myrepo",
				"default_branch": "main",
				"owner":          map[string]string{"login": "testorg"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(repos)
	})

	// Branches endpoint.
	mux.HandleFunc("/repos/testorg/myrepo/branches", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		branches := []map[string]string{
			{"name": "main"},
			{"name": "dev"},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(branches)
	})

	// User repos endpoint (fallback).
	mux.HandleFunc("/user/repos", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		repos := []map[string]any{
			{
				"name":           "personal-repo",
				"clone_url":      "https://github.com/alice/personal-repo.git",
				"html_url":       "https://github.com/alice/personal-repo",
				"default_branch": "main",
				"owner":          map[string]string{"login": "alice"},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(repos)
	})

	// Branches for personal repo.
	mux.HandleFunc("/repos/alice/personal-repo/branches", func(w http.ResponseWriter, _ *http.Request) {
		branches := []map[string]string{{"name": "main"}}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(branches)
	})

	return httptest.NewServer(mux)
}

func TestFetchGitHubRepos_WithOrg(t *testing.T) {
	srv := fakeGitHubServer(t)
	defer srv.Close()

	origClient := ghClient
	ghClient = srv.Client()
	defer func() { ghClient = origClient }()

	cfg := &Config{
		GitHub: []GitHubInstance{
			{Name: "test", BaseURL: srv.URL, Token: "test-token", Orgs: []string{"testorg"}},
		},
	}

	repos := fetchGitHubRepos(cfg)
	got, ok := repos["test"]
	if !ok {
		t.Fatal("expected 'test' key in repos map")
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 repo, got %d", len(got))
	}
	if got[0].Name != "myrepo" {
		t.Errorf("expected repo name 'myrepo', got %q", got[0].Name)
	}
	if got[0].Org != "testorg" {
		t.Errorf("expected org 'testorg', got %q", got[0].Org)
	}
	// Should have fetched branches.
	if len(got[0].Branches) != 2 {
		t.Errorf("expected 2 branches, got %d", len(got[0].Branches))
	}
}

func TestFetchGitHubRepos_NoOrgs_UserRepos(t *testing.T) {
	srv := fakeGitHubServer(t)
	defer srv.Close()

	origClient := ghClient
	ghClient = srv.Client()
	defer func() { ghClient = origClient }()

	cfg := &Config{
		GitHub: []GitHubInstance{
			{Name: "personal", BaseURL: srv.URL, Token: "test-token"},
		},
	}

	repos := fetchGitHubRepos(cfg)
	got, ok := repos["personal"]
	if !ok {
		t.Fatal("expected 'personal' key in repos map")
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 repo, got %d", len(got))
	}
	if got[0].Name != "personal-repo" {
		t.Errorf("expected repo name 'personal-repo', got %q", got[0].Name)
	}
}

func TestFetchGitHubRepos_NoToken_Skipped(t *testing.T) {
	cfg := &Config{
		GitHub: []GitHubInstance{
			{Name: "no-token", BaseURL: "http://unused"},
		},
	}
	repos := fetchGitHubRepos(cfg)
	if len(repos) != 0 {
		t.Errorf("expected empty map when no token, got %d entries", len(repos))
	}
}

func TestFetchGitHubRepos_DefaultName(t *testing.T) {
	srv := fakeGitHubServer(t)
	defer srv.Close()

	origClient := ghClient
	ghClient = srv.Client()
	defer func() { ghClient = origClient }()

	cfg := &Config{
		GitHub: []GitHubInstance{
			{BaseURL: srv.URL, Token: "test-token"},
		},
	}

	repos := fetchGitHubRepos(cfg)
	if _, ok := repos["github"]; !ok {
		t.Error("expected default name 'github' when Name is empty")
	}
}

func TestFetchRepoPages_InvalidURL(t *testing.T) {
	repos, status := fetchRepoPages("://invalid", "token")
	if len(repos) != 0 {
		t.Errorf("expected empty repos for invalid URL, got %d", len(repos))
	}
	if status != 0 {
		t.Errorf("expected status 0, got %d", status)
	}
}

func TestFetchBranches_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	origClient := ghClient
	ghClient = srv.Client()
	defer func() { ghClient = origClient }()

	branches := fetchBranches(srv.URL, "token", "org", "repo")
	if branches != nil {
		t.Errorf("expected nil branches on server error, got %v", branches)
	}
}

func TestListReposForAccount_OrgNotFound_FallsBack(t *testing.T) {
	mux := http.NewServeMux()

	// Org endpoint returns 404.
	mux.HandleFunc("/orgs/unknown/repos", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	// User repos endpoint returns repos with different owners.
	mux.HandleFunc("/user/repos", func(w http.ResponseWriter, _ *http.Request) {
		repos := []map[string]any{
			{"name": "repo1", "clone_url": "u", "html_url": "h", "default_branch": "main", "owner": map[string]string{"login": "unknown"}},
			{"name": "repo2", "clone_url": "u", "html_url": "h", "default_branch": "main", "owner": map[string]string{"login": "other"}},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(repos)
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	origClient := ghClient
	ghClient = srv.Client()
	defer func() { ghClient = origClient }()

	repos := listReposForAccount(srv.URL, "token", "unknown")
	if len(repos) != 1 {
		t.Fatalf("expected 1 filtered repo, got %d", len(repos))
	}
	if repos[0].Name != "repo1" {
		t.Errorf("expected repo1, got %q", repos[0].Name)
	}
}
