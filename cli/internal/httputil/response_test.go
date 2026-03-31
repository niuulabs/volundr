package httputil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, map[string]string{"status": "ok"})

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %q", body["status"])
	}
}

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteError(rec, http.StatusBadRequest, "bad %s", "input")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["detail"] != "bad input" {
		t.Errorf("expected 'bad input', got %q", body["detail"])
	}
}
