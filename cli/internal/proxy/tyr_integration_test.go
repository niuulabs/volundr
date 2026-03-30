package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"github.com/niuulabs/volundr/cli/internal/tyr"
)

// TestTyrMiniRoutesViaProxy verifies that tyr-mini routes serve correctly
// alongside API proxy routes when registered directly on the proxy mux.
// This is the mini-mode path (as opposed to k3s mode which uses a reverse
// proxy to a Tyr Docker container).
func TestTyrMiniRoutesViaProxy(t *testing.T) {
	// Create mock API backend.
	apiBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"source":"api","path":"%s"}`, r.URL.Path)
	}))
	defer apiBackend.Close()

	r, err := NewRouter(apiBackend.URL)
	if err != nil {
		t.Fatalf("NewRouter() error: %v", err)
	}

	// Create a tyr-mini server with a mock DB so health checks work.
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	if err != nil {
		t.Fatalf("sqlmock.New() error: %v", err)
	}
	defer db.Close()

	// Health check will ping the DB.
	mock.ExpectPing()

	tyrStore := tyr.NewStore(db)
	tyrHandler := tyr.NewHandler(tyrStore, nil)
	tyrSrv := tyr.NewServerFromHandler(tyrHandler)
	r.RegisterTyrRoutes(tyrSrv)

	handler := r.Handler()

	// Tyr health endpoint should be served directly (not proxied).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/tyr/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("tyr health: expected 200, got %d (body: %s)", w.Code, w.Body.String())
	}

	var healthResp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &healthResp); err != nil {
		t.Fatalf("unmarshal tyr health response: %v", err)
	}
	if healthResp["service"] != "tyr-mini" {
		t.Errorf("expected service=tyr-mini, got %v", healthResp["service"])
	}

	// API endpoint should still go to the API backend (not tyr-mini).
	req2 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/volundr/sessions", nil)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)

	var apiResp map[string]string
	if err := json.Unmarshal(w2.Body.Bytes(), &apiResp); err != nil {
		t.Fatalf("unmarshal api response: %v", err)
	}
	if apiResp["source"] != "api" {
		t.Errorf("expected api backend, got source=%s", apiResp["source"])
	}

	// Web UI root should still serve SPA (web enabled by default).
	req3 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Errorf("web root: expected 200, got %d", w3.Code)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled sqlmock expectations: %v", err)
	}
}
