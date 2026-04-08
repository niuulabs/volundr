package tyr

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

// Event is a single event in the Tyr event log.
type Event struct {
	ID        string         `json:"id"`
	Event     string         `json:"event"`
	Data      map[string]any `json:"data"`
	OwnerID   string         `json:"owner_id"`
	Timestamp string         `json:"timestamp"`
}

// EventLog is a ring buffer of recent Tyr events with SSE broadcast.
type EventLog struct {
	mu          sync.RWMutex
	events      []Event
	maxSize     int
	subscribers map[string]chan Event
}

// NewEventLog creates a new event log.
func NewEventLog(maxSize int) *EventLog {
	if maxSize == 0 {
		maxSize = 100
	}
	return &EventLog{
		events:      make([]Event, 0, maxSize),
		maxSize:     maxSize,
		subscribers: make(map[string]chan Event),
	}
}

// Emit adds an event and broadcasts to all SSE subscribers.
func (el *EventLog) Emit(eventType string, data map[string]any, ownerID string) {
	evt := Event{
		ID:        uuid.New().String(),
		Event:     eventType,
		Data:      data,
		OwnerID:   ownerID,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	el.mu.Lock()
	if len(el.events) >= el.maxSize {
		el.events = el.events[1:]
	}
	el.events = append(el.events, evt)

	// Broadcast to SSE subscribers (non-blocking).
	for _, ch := range el.subscribers {
		select {
		case ch <- evt:
		default:
		}
	}
	el.mu.Unlock()
}

// Subscribe returns a channel that receives new events.
func (el *EventLog) Subscribe() (subID string, out <-chan Event) {
	id := uuid.New().String()
	ch := make(chan Event, 64)
	el.mu.Lock()
	el.subscribers[id] = ch
	el.mu.Unlock()
	return id, ch
}

// Unsubscribe removes a subscriber.
func (el *EventLog) Unsubscribe(id string) {
	el.mu.Lock()
	if ch, ok := el.subscribers[id]; ok {
		close(ch)
		delete(el.subscribers, id)
	}
	el.mu.Unlock()
}

// Recent returns the last N events.
func (el *EventLog) Recent(n int) []Event {
	el.mu.RLock()
	defer el.mu.RUnlock()

	if n <= 0 || n > len(el.events) {
		n = len(el.events)
	}
	start := len(el.events) - n
	result := make([]Event, n)
	copy(result, el.events[start:])
	return result
}
