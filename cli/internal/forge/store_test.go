package forge

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_PutAndGet(t *testing.T) {
	store := NewStore("")

	sess := &Session{
		ID:        "test-1",
		Name:      "my-session",
		Status:    StatusRunning,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	store.Put(sess)

	got := store.Get("test-1")
	if got == nil {
		t.Fatal("expected session, got nil")
	}
	if got.Name != "my-session" {
		t.Errorf("expected name 'my-session', got %q", got.Name)
	}
	if got.Status != StatusRunning {
		t.Errorf("expected status running, got %q", got.Status)
	}
}

func TestStore_GetReturnsNilForMissing(t *testing.T) {
	store := NewStore("")
	if store.Get("nonexistent") != nil {
		t.Error("expected nil for missing session")
	}
}

func TestStore_List(t *testing.T) {
	store := NewStore("")

	store.Put(&Session{ID: "a", Name: "alpha", Status: StatusRunning})
	store.Put(&Session{ID: "b", Name: "beta", Status: StatusStopped})

	list := store.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(list))
	}
}

func TestStore_Delete(t *testing.T) {
	store := NewStore("")
	store.Put(&Session{ID: "a", Name: "alpha"})
	store.Delete("a")

	if store.Get("a") != nil {
		t.Error("expected nil after delete")
	}
	if store.Count("") != 0 {
		t.Error("expected 0 total after delete")
	}
}

func TestStore_Count(t *testing.T) {
	store := NewStore("")
	store.Put(&Session{ID: "a", Status: StatusRunning})
	store.Put(&Session{ID: "b", Status: StatusRunning})
	store.Put(&Session{ID: "c", Status: StatusStopped})

	if store.Count("") != 3 {
		t.Errorf("expected total 3, got %d", store.Count(""))
	}
	if store.Count(StatusRunning) != 2 {
		t.Errorf("expected 2 running, got %d", store.Count(StatusRunning))
	}
	if store.Count(StatusStopped) != 1 {
		t.Errorf("expected 1 stopped, got %d", store.Count(StatusStopped))
	}
}

func TestStore_Persistence(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "state.json")

	// Write sessions to a persistent store.
	store1 := NewStore(fp)
	store1.Put(&Session{ID: "x", Name: "persisted", Status: StatusRunning})

	// Verify file was written.
	if _, err := os.Stat(fp); err != nil {
		t.Fatalf("state file not created: %v", err)
	}

	// Load from a new store — running sessions should become stopped.
	store2 := NewStore(fp)
	got := store2.Get("x")
	if got == nil {
		t.Fatal("expected to restore session from disk")
	}
	if got.Name != "persisted" {
		t.Errorf("expected name 'persisted', got %q", got.Name)
	}
	if got.Status != StatusStopped {
		t.Errorf("expected status stopped after restore, got %q", got.Status)
	}
}

func TestStore_GetReturnsCopy(t *testing.T) {
	store := NewStore("")
	store.Put(&Session{ID: "a", Name: "original"})

	got := store.Get("a")
	got.Name = "mutated"

	got2 := store.Get("a")
	if got2.Name != "original" {
		t.Error("Get should return a copy; mutation leaked into store")
	}
}
