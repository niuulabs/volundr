package tui

import (
	"sync"

	tea "charm.land/bubbletea/v2"
)

// ProgramSender allows goroutines to push messages into the Bubble Tea program.
// It is safe for concurrent use. Set the Program field after tea.NewProgram()
// returns but before p.Run().
type ProgramSender struct {
	mu sync.RWMutex
	p  *tea.Program
}

// SetProgram stores the program reference. Call this before p.Run().
func (s *ProgramSender) SetProgram(p *tea.Program) {
	s.mu.Lock()
	s.p = p
	s.mu.Unlock()
}

// Send pushes a message into the Bubble Tea event loop.
// Safe to call from any goroutine. No-op if the program hasn't been set yet.
func (s *ProgramSender) Send(msg tea.Msg) {
	s.mu.RLock()
	p := s.p
	s.mu.RUnlock()
	if p != nil {
		p.Send(msg)
	}
}
