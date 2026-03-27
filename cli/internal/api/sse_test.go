package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestNewSSEClient(t *testing.T) {
	c := NewSSEClient("http://example.com", "tok-123")
	if c.baseURL != "http://example.com" {
		t.Errorf("baseURL: got %q, want %q", c.baseURL, "http://example.com")
	}
	if c.token != "tok-123" {
		t.Errorf("token: got %q, want %q", c.token, "tok-123")
	}
}

func TestSSEClient_Connect_ParsesEvents(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "id: 1\nevent: activity\ndata: hello\n\n")
	}))
	defer srv.Close()

	client := NewSSEClient(srv.URL, "")
	var mu sync.Mutex
	var got []SSEEvent
	client.OnEvent = func(e SSEEvent) {
		mu.Lock()
		got = append(got, e)
		mu.Unlock()
	}

	if err := client.Connect(""); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	client.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got))
	}
	if got[0].ID != "1" {
		t.Errorf("ID: got %q, want %q", got[0].ID, "1")
	}
	if got[0].Event != "activity" {
		t.Errorf("Event: got %q, want %q", got[0].Event, "activity")
	}
	if got[0].Data != "hello" {
		t.Errorf("Data: got %q, want %q", got[0].Data, "hello")
	}
}

func TestSSEClient_Connect_MultilineData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "data: line1\ndata: line2\n\n")
	}))
	defer srv.Close()

	client := NewSSEClient(srv.URL, "")
	var mu sync.Mutex
	var got []SSEEvent
	client.OnEvent = func(e SSEEvent) {
		mu.Lock()
		got = append(got, e)
		mu.Unlock()
	}

	if err := client.Connect(""); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	client.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got))
	}
	if got[0].Data != "line1\nline2" {
		t.Errorf("Data: got %q, want %q", got[0].Data, "line1\nline2")
	}
}

func TestSSEClient_Connect_AuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewSSEClient(srv.URL, "my-token")
	if err := client.Connect(""); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	client.Close()

	if gotAuth != "Bearer my-token" {
		t.Errorf("Authorization: got %q, want %q", gotAuth, "Bearer my-token")
	}
}

func TestSSEClient_Connect_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := NewSSEClient(srv.URL, "")
	err := client.Connect("")
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestSSEClient_Close_Idempotent(t *testing.T) {
	client := NewSSEClient("http://example.com", "")
	client.Close()
	client.Close() // Should not panic
}

func TestSSEClient_Connect_EmptyDataIgnored(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Empty event (no data field) followed by real event
		fmt.Fprint(w, "event: ping\n\ndata: real\n\n")
	}))
	defer srv.Close()

	client := NewSSEClient(srv.URL, "")
	var mu sync.Mutex
	var got []SSEEvent
	client.OnEvent = func(e SSEEvent) {
		mu.Lock()
		got = append(got, e)
		mu.Unlock()
	}

	if err := client.Connect(""); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	client.Close()

	mu.Lock()
	defer mu.Unlock()
	// Only the event with data should be dispatched
	if len(got) != 1 {
		t.Fatalf("expected 1 event, got %d", len(got))
	}
	if got[0].Data != "real" {
		t.Errorf("Data: got %q, want %q", got[0].Data, "real")
	}
}
