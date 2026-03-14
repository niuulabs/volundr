package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewSessionPodClient(t *testing.T) {
	spc := NewSessionPodClient("https://sessions.example.com/s/123/", "tok")
	if spc.baseURL != "https://sessions.example.com/s/123" {
		t.Errorf("expected trailing slash stripped, got %q", spc.baseURL)
	}
	if spc.token != "tok" {
		t.Errorf("expected token %q, got %q", "tok", spc.token)
	}
	if spc.httpClient == nil {
		t.Fatal("expected non-nil httpClient")
	}
}

func TestNewSessionPodClient_NoTrailingSlash(t *testing.T) {
	spc := NewSessionPodClient("https://sessions.example.com/s/123", "tok")
	if spc.baseURL != "https://sessions.example.com/s/123" {
		t.Errorf("expected unchanged URL, got %q", spc.baseURL)
	}
}

func TestSessionPodClient_DoWithBody_Auth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer my-token" {
			t.Errorf("expected Bearer auth, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", r.Header.Get("Content-Type"))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "my-token")
	resp, err := spc.do("GET", "/test")
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	_ = resp.Body.Close()
}

func TestSessionPodClient_DoWithBody_NoAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("expected no Authorization header for empty token")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "")
	resp, err := spc.do("GET", "/test")
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	_ = resp.Body.Close()
}

func TestSessionPodClient_DoWithBody_JSONBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["name"] != "test" {
			t.Errorf("expected body name=test, got %v", body)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	resp, err := spc.doWithBody("POST", "/test", map[string]string{"name": "test"})
	if err != nil {
		t.Fatalf("doWithBody: %v", err)
	}
	_ = resp.Body.Close()
}

func TestGetDiffFiles_Success(t *testing.T) {
	tests := []struct {
		name     string
		base     string
		wantPath string
	}{
		{"without base", "", "/api/diff/files"},
		{"with base", "main", "/api/diff/files?base=main"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RequestURI() != tt.wantPath {
					t.Errorf("expected path %q, got %q", tt.wantPath, r.URL.RequestURI())
				}
				w.Header().Set("Content-Type", "application/json")
				resp := DiffFilesResponse{
					Files: []DiffFileEntry{
						{Path: "main.go", Status: "M", Additions: 10, Deletions: 3},
						{Path: "new.go", Status: "A", Additions: 50, Deletions: 0},
					},
				}
				_ = json.NewEncoder(w).Encode(resp)
			}))
			defer srv.Close()

			spc := NewSessionPodClient(srv.URL, "tok")
			files, err := spc.GetDiffFiles(tt.base)
			if err != nil {
				t.Fatalf("GetDiffFiles: %v", err)
			}
			if len(files) != 2 {
				t.Fatalf("expected 2 files, got %d", len(files))
			}
			if files[0].Path != "main.go" {
				t.Errorf("expected path %q, got %q", "main.go", files[0].Path)
			}
			if files[0].Status != "M" {
				t.Errorf("expected status %q, got %q", "M", files[0].Status)
			}
		})
	}
}

func TestGetDiffFiles_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("server error"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetDiffFiles("")
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected error to contain status code, got %q", err.Error())
	}
}

func TestGetDiffFiles_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetDiffFiles("")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestGetFileDiff_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "base=main") {
			t.Errorf("expected base=main in query, got %q", r.URL.RawQuery)
		}
		if !strings.Contains(r.URL.RawQuery, "file=main.go") {
			t.Errorf("expected file=main.go in query, got %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		resp := DiffResponse{
			FilePath: "main.go",
			Hunks: []DiffHunk{
				{
					OldStart: 1,
					OldCount: 3,
					NewStart: 1,
					NewCount: 4,
					Lines: []DiffLine{
						{Type: "context", Content: "package main"},
						{Type: "add", Content: "import \"fmt\""},
						{Type: "remove", Content: "// old comment"},
						{Type: "context", Content: "func main() {}"},
					},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	diff, err := spc.GetFileDiff("main", "main.go")
	if err != nil {
		t.Fatalf("GetFileDiff: %v", err)
	}
	if !strings.Contains(diff, "@@ -1,3 +1,4 @@") {
		t.Errorf("expected hunk header, got %q", diff)
	}
	if !strings.Contains(diff, "+import \"fmt\"") {
		t.Errorf("expected added line in diff, got %q", diff)
	}
	if !strings.Contains(diff, "-// old comment") {
		t.Errorf("expected removed line in diff, got %q", diff)
	}
	if !strings.Contains(diff, " package main") {
		t.Errorf("expected context line in diff, got %q", diff)
	}
}

func TestGetFileDiff_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("file not found"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetFileDiff("main", "missing.go")
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestGetFileDiff_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetFileDiff("main", "file.go")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestHunksToUnifiedDiff(t *testing.T) {
	t.Run("empty hunks", func(t *testing.T) {
		result := hunksToUnifiedDiff(DiffResponse{})
		if result != "" {
			t.Errorf("expected empty string for no hunks, got %q", result)
		}
	})

	t.Run("multiple hunks", func(t *testing.T) {
		resp := DiffResponse{
			FilePath: "test.go",
			Hunks: []DiffHunk{
				{
					OldStart: 1, OldCount: 2, NewStart: 1, NewCount: 3,
					Lines: []DiffLine{
						{Type: "context", Content: "line1"},
						{Type: "add", Content: "new line"},
						{Type: "context", Content: "line2"},
					},
				},
				{
					OldStart: 10, OldCount: 1, NewStart: 11, NewCount: 0,
					Lines: []DiffLine{
						{Type: "remove", Content: "deleted"},
					},
				},
			},
		}
		result := hunksToUnifiedDiff(resp)
		if !strings.Contains(result, "@@ -1,2 +1,3 @@") {
			t.Errorf("expected first hunk header, got %q", result)
		}
		if !strings.Contains(result, "@@ -10,1 +11,0 @@") {
			t.Errorf("expected second hunk header, got %q", result)
		}
	})
}

func TestGetConversationHistory_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/conversation/history" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		resp := ConversationHistoryResponse{
			Turns: []ConversationTurn{
				{ID: "t1", Role: "user", Content: "hello"},
				{ID: "t2", Role: "assistant", Content: "hi there"},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	turns, err := spc.GetConversationHistory()
	if err != nil {
		t.Fatalf("GetConversationHistory: %v", err)
	}
	if len(turns) != 2 {
		t.Fatalf("expected 2 turns, got %d", len(turns))
	}
	if turns[0].Role != "user" {
		t.Errorf("expected role %q, got %q", "user", turns[0].Role)
	}
	if turns[1].Content != "hi there" {
		t.Errorf("expected content %q, got %q", "hi there", turns[1].Content)
	}
}

func TestGetConversationHistory_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetConversationHistory()
	if err == nil {
		t.Fatal("expected error for 403")
	}
}

func TestGetConversationHistory_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("bad json"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.GetConversationHistory()
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestListFiles_Success(t *testing.T) {
	tests := []struct {
		name     string
		dirPath  string
		wantPath string
	}{
		{"root", "", "/api/files"},
		{"subdir", "src", "/api/files?path=src"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.RequestURI() != tt.wantPath {
					t.Errorf("expected path %q, got %q", tt.wantPath, r.URL.RequestURI())
				}
				w.Header().Set("Content-Type", "application/json")
				files := []FileEntry{
					{Name: "main.go", Path: "/workspace/main.go", IsDir: false, Size: 1024},
					{Name: "pkg", Path: "/workspace/pkg", IsDir: true, Size: 0},
				}
				_ = json.NewEncoder(w).Encode(files)
			}))
			defer srv.Close()

			spc := NewSessionPodClient(srv.URL, "tok")
			files, err := spc.ListFiles(tt.dirPath)
			if err != nil {
				t.Fatalf("ListFiles: %v", err)
			}
			if len(files) != 2 {
				t.Fatalf("expected 2 files, got %d", len(files))
			}
			if files[0].Name != "main.go" {
				t.Errorf("expected name %q, got %q", "main.go", files[0].Name)
			}
			if files[1].IsDir != true {
				t.Error("expected second entry to be a directory")
			}
		})
	}
}

func TestListFiles_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("not found"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.ListFiles("nonexistent")
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestListFiles_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("bad"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.ListFiles("")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestListCliSessions_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/terminal/api/terminal/sessions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		resp := CliSessionList{
			Sessions: []CliSession{
				{TerminalID: "t1", Label: "main", CliType: "bash", Status: "running", Persistent: true},
			},
			Tmux: true,
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	result, err := spc.ListCliSessions()
	if err != nil {
		t.Fatalf("ListCliSessions: %v", err)
	}
	if !result.Tmux {
		t.Error("expected tmux=true")
	}
	if len(result.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(result.Sessions))
	}
	if result.Sessions[0].TerminalID != "t1" {
		t.Errorf("expected terminalID %q, got %q", "t1", result.Sessions[0].TerminalID)
	}
}

func TestListCliSessions_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("unavailable"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.ListCliSessions()
	if err == nil {
		t.Fatal("expected error for 503")
	}
}

func TestListCliSessions_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("bad"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.ListCliSessions()
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestCreateCliSession_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %q", r.Method)
		}
		if r.URL.Path != "/terminal/api/terminal/spawn" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		var req CreateCliSessionRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.CliType != "bash" {
			t.Errorf("expected cli_type %q, got %q", "bash", req.CliType)
		}
		w.Header().Set("Content-Type", "application/json")
		resp := CliSession{TerminalID: "new-t", Label: req.Label, CliType: req.CliType, Status: "running"}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	result, err := spc.CreateCliSession(CreateCliSessionRequest{CliType: "bash", Label: "dev"})
	if err != nil {
		t.Fatalf("CreateCliSession: %v", err)
	}
	if result.TerminalID != "new-t" {
		t.Errorf("expected terminalID %q, got %q", "new-t", result.TerminalID)
	}
}

func TestCreateCliSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("invalid request"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.CreateCliSession(CreateCliSessionRequest{CliType: "bash"})
	if err == nil {
		t.Fatal("expected error for 400")
	}
}

func TestCreateCliSession_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	_, err := spc.CreateCliSession(CreateCliSessionRequest{CliType: "bash"})
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestKillCliSession_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %q", r.Method)
		}
		if r.URL.Path != "/terminal/api/terminal/kill" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["terminalId"] != "t1" {
			t.Errorf("expected terminalId %q, got %q", "t1", body["terminalId"])
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	if err := spc.KillCliSession("t1"); err != nil {
		t.Fatalf("KillCliSession: %v", err)
	}
}

func TestKillCliSession_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("not found"))
	}))
	defer srv.Close()

	spc := NewSessionPodClient(srv.URL, "tok")
	err := spc.KillCliSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestCliSessionWSURL(t *testing.T) {
	tests := []struct {
		name       string
		endpoint   string
		terminalID string
		want       string
	}{
		{
			"https endpoint",
			"https://sessions.example.com/s/123/",
			"t1",
			"wss://sessions.example.com/s/123/terminal/ws/t1",
		},
		{
			"http endpoint",
			"http://localhost:8080/s/123/",
			"t2",
			"ws://localhost:8080/s/123/terminal/ws/t2",
		},
		{
			"no trailing slash",
			"https://sessions.example.com/s/123",
			"t3",
			"wss://sessions.example.com/s/123/terminal/ws/t3",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CliSessionWSURL(tt.endpoint, tt.terminalID)
			if got != tt.want {
				t.Errorf("CliSessionWSURL(%q, %q) = %q, want %q", tt.endpoint, tt.terminalID, got, tt.want)
			}
		})
	}
}

func TestChatWSURL(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		token    string
		want     string
	}{
		{
			"with token",
			"wss://sessions.example.com/s/123/session",
			"my-token",
			"wss://sessions.example.com/s/123/session?access_token=my-token",
		},
		{
			"empty token",
			"wss://sessions.example.com/s/123/session",
			"",
			"wss://sessions.example.com/s/123/session",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ChatWSURL(tt.endpoint, tt.token)
			if got != tt.want {
				t.Errorf("ChatWSURL(%q, %q) = %q, want %q", tt.endpoint, tt.token, got, tt.want)
			}
		})
	}
}
