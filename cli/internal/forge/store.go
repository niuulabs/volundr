package forge

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Store manages session state in memory with optional JSON file persistence.
type Store struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	filePath string
}

// NewStore creates a new session store. If filePath is non-empty, state is
// persisted to disk on every mutation and restored on startup.
func NewStore(filePath string) *Store {
	s := &Store{
		sessions: make(map[string]*Session),
		filePath: filePath,
	}
	if filePath != "" {
		_ = s.load()
	}
	return s
}

// Get returns a session by ID, or nil if not found.
func (s *Store) Get(id string) *Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess := s.sessions[id]
	if sess == nil {
		return nil
	}
	cp := *sess
	return &cp
}

// List returns all sessions.
func (s *Store) List() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		cp := *sess
		result = append(result, &cp)
	}
	return result
}

// Put stores or updates a session.
func (s *Store) Put(sess *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := *sess
	s.sessions[sess.ID] = &cp
	s.persist()
}

// Delete removes a session from the store.
func (s *Store) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
	s.persist()
}

// Count returns the number of sessions matching the given status.
// If status is empty, returns the total count.
func (s *Store) Count(status SessionStatus) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if status == "" {
		return len(s.sessions)
	}
	count := 0
	for _, sess := range s.sessions {
		if sess.Status == status {
			count++
		}
	}
	return count
}

// persist writes the current state to disk (caller must hold s.mu).
func (s *Store) persist() {
	if s.filePath == "" {
		return
	}

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}

	data, err := json.MarshalIndent(s.sessions, "", "  ")
	if err != nil {
		return
	}

	_ = os.WriteFile(s.filePath, data, 0o600)
}

// load restores state from disk.
func (s *Store) load() error {
	data, err := os.ReadFile(s.filePath) //nolint:gosec // path from trusted config
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read state file: %w", err)
	}

	var sessions map[string]*Session
	if err := json.Unmarshal(data, &sessions); err != nil {
		return fmt.Errorf("parse state file: %w", err)
	}

	s.sessions = sessions

	// Mark any sessions that were "running" as "stopped" since
	// we just started and those processes are gone.
	for _, sess := range s.sessions {
		switch sess.Status {
		case StatusRunning, StatusStarting, StatusProvisioning:
			sess.Status = StatusStopped
		}
	}

	s.persist()
	return nil
}
