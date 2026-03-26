package forge

import (
	"fmt"
	"sync"
)

// EventBus is a simple pub/sub for session activity events.
// Subscribers receive events on a channel; slow consumers are dropped.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string]chan ActivityEvent
	nextID      int
}

// NewEventBus creates a new event bus.
func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]chan ActivityEvent),
	}
}

// Subscribe returns a channel that receives activity events and an ID
// for unsubscribing. The channel has a buffer of 64 events.
func (b *EventBus) Subscribe() (id string, ch <-chan ActivityEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.nextID++
	id := fmt.Sprintf("sub-%d", b.nextID)
	ch := make(chan ActivityEvent, 64)
	b.subscribers[id] = ch
	return id, ch
}

// Unsubscribe removes a subscriber and closes its channel.
func (b *EventBus) Unsubscribe(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if ch, ok := b.subscribers[id]; ok {
		close(ch)
		delete(b.subscribers, id)
	}
}

// Emit sends an event to all subscribers. Slow consumers are skipped.
func (b *EventBus) Emit(event ActivityEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for _, ch := range b.subscribers {
		select {
		case ch <- event:
		default:
			// Drop event for slow consumer.
		}
	}
}
