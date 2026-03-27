package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewClientWithConfig(t *testing.T) {
	c := NewClientWithConfig("http://localhost", "tok", nil)
	if c.baseURL != "http://localhost" {
		t.Errorf("expected baseURL %q, got %q", "http://localhost", c.baseURL)
	}
	if c.token != "tok" {
		t.Errorf("expected token %q, got %q", "tok", c.token)
	}
}

func TestGetMe(t *testing.T) {
	profile := UserProfile{UserID: "u1", Email: "test@example.com", TenantID: "t1", Status: "active"}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/me" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(profile)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.GetMe()
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if got.UserID != "u1" {
		t.Errorf("expected userID %q, got %q", "u1", got.UserID)
	}
	if got.Email != "test@example.com" {
		t.Errorf("expected email %q, got %q", "test@example.com", got.Email)
	}
}

func TestGetMe_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("unauthorized"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "bad-tok")
	_, err := c.GetMe()
	if err == nil {
		t.Fatal("expected error for 401")
	}
}

func TestListUsers(t *testing.T) {
	users := []UserInfo{
		{ID: "u1", Email: "admin@example.com", DisplayName: "Admin", Status: "active"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/users" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(users)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListUsers()
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 user, got %d", len(got))
	}
	if got[0].Email != "admin@example.com" {
		t.Errorf("expected email %q, got %q", "admin@example.com", got[0].Email)
	}
}

func TestListUsers_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListUsers()
	if err == nil {
		t.Fatal("expected error for 403")
	}
}

func TestListTenants(t *testing.T) {
	tenants := []Tenant{
		{ID: "t1", Name: "Acme Corp"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/tenants" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(tenants)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListTenants()
	if err != nil {
		t.Fatalf("ListTenants: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 tenant, got %d", len(got))
	}
	if got[0].Name != "Acme Corp" {
		t.Errorf("expected name %q, got %q", "Acme Corp", got[0].Name)
	}
}

func TestListTenants_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListTenants()
	if err == nil {
		t.Fatal("expected error for 500")
	}
}

func TestListIntegrationCatalog(t *testing.T) {
	catalog := []IntegrationCatalogEntry{
		{Slug: "gitlab", Name: "GitLab", IntegrationType: "scm"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/integrations/catalog" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(catalog)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListIntegrationCatalog()
	if err != nil {
		t.Fatalf("ListIntegrationCatalog: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(got))
	}
	if got[0].Slug != "gitlab" {
		t.Errorf("expected slug %q, got %q", "gitlab", got[0].Slug)
	}
}

func TestListIntegrationCatalog_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListIntegrationCatalog()
	if err == nil {
		t.Fatal("expected error for 500")
	}
}

func TestListIntegrations(t *testing.T) {
	connections := []IntegrationConnection{
		{ID: "c1", IntegrationType: "scm", Enabled: true, Slug: "gitlab"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/integrations" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(connections)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListIntegrations()
	if err != nil {
		t.Fatalf("ListIntegrations: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(got))
	}
	if !got[0].Enabled {
		t.Error("expected enabled=true")
	}
}

func TestListIntegrations_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListIntegrations()
	if err == nil {
		t.Fatal("expected error for 403")
	}
}

func TestTestIntegration_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %q", r.Method)
		}
		if r.URL.Path != "/api/v1/volundr/integrations/c1/test" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.TestIntegration("c1"); err != nil {
		t.Fatalf("TestIntegration: %v", err)
	}
}

func TestTestIntegration_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream error"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	err := c.TestIntegration("c1")
	if err == nil {
		t.Fatal("expected error for 502")
	}
	if !strings.Contains(err.Error(), "502") {
		t.Errorf("expected error to contain status code, got %q", err.Error())
	}
}

func TestListAdminWorkspaces(t *testing.T) {
	workspaces := []AdminWorkspace{
		{ID: "w1", UserID: "u1", Status: "running", PodName: "pod-1"},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/admin/workspaces" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(workspaces)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	got, err := c.ListAdminWorkspaces()
	if err != nil {
		t.Fatalf("ListAdminWorkspaces: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 workspace, got %d", len(got))
	}
	if got[0].PodName != "pod-1" {
		t.Errorf("expected podName %q, got %q", "pod-1", got[0].PodName)
	}
}

func TestListAdminWorkspaces_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte("forbidden"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListAdminWorkspaces()
	if err == nil {
		t.Fatal("expected error for 403")
	}
}

func TestPing_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/volundr/stats" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.Ping(); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestPing_Error(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	err := c.Ping()
	if err == nil {
		t.Fatal("expected error for 503")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("expected error to contain status code, got %q", err.Error())
	}
}

func TestPing_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	err := c.Ping()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestListChronicles_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.ListChronicles()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestGetTimeline_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.GetTimeline("s1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestListModels_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.ListModels()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestGetStats_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.GetStats()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestListSessions_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestGetSession_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.GetSession("s1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestCreateSession_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.CreateSession(&SessionCreate{Name: "test"})
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestStartSession_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	err := c.StartSession("s1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestStopSession_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	err := c.StopSession("s1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestDeleteSession_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	err := c.DeleteSession("s1")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestGetAuthConfig_ConnectionError(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	_, err := c.GetAuthConfig()
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
}

func TestDecodeResponse_NonJSONContentType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<html><body>Login required</body></html>"))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for non-JSON content type")
	}
	if !strings.Contains(err.Error(), "unexpected response") {
		t.Errorf("expected 'unexpected response' in error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "text/html") {
		t.Errorf("expected content type in error, got %q", err.Error())
	}
}

func TestDecodeResponse_NonJSONContentType_LongBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		// Write a body longer than 200 chars to test truncation.
		body := strings.Repeat("x", 300)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	_, err := c.ListSessions()
	if err == nil {
		t.Fatal("expected error for non-JSON content type")
	}
	// The preview should be truncated to 200 chars.
	if !strings.Contains(err.Error(), "unexpected response") {
		t.Errorf("expected 'unexpected response' in error, got %q", err.Error())
	}
}
