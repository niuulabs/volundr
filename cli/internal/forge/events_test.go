package forge

import (
	"testing"
	"time"
)

func TestEventBus_SubscribeAndEmit(t *testing.T) {
	bus := NewEventBus()

	_, ch := bus.Subscribe()

	event := ActivityEvent{
		SessionID: "sess-1",
		State:     "active",
		OwnerID:   "alice",
	}
	bus.Emit(event)

	select {
	case got := <-ch:
		if got.SessionID != "sess-1" {
			t.Errorf("expected session_id 'sess-1', got %q", got.SessionID)
		}
		if got.State != "active" {
			t.Errorf("expected state 'active', got %q", got.State)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for event")
	}
}

func TestEventBus_Unsubscribe(t *testing.T) {
	bus := NewEventBus()

	id, ch := bus.Subscribe()
	bus.Unsubscribe(id)

	// Channel should be closed.
	_, ok := <-ch
	if ok {
		t.Error("expected channel to be closed after unsubscribe")
	}
}

func TestEventBus_MultipleSubscribers(t *testing.T) {
	bus := NewEventBus()

	_, ch1 := bus.Subscribe()
	_, ch2 := bus.Subscribe()

	bus.Emit(ActivityEvent{SessionID: "s1", State: "active"})

	for _, ch := range []<-chan ActivityEvent{ch1, ch2} {
		select {
		case got := <-ch:
			if got.SessionID != "s1" {
				t.Errorf("expected session_id 's1', got %q", got.SessionID)
			}
		case <-time.After(100 * time.Millisecond):
			t.Fatal("timed out waiting for event on subscriber")
		}
	}
}

func TestEventBus_SlowConsumerDropped(t *testing.T) {
	bus := NewEventBus()
	_, ch := bus.Subscribe()

	// Fill the buffer (64 events).
	for i := 0; i < 100; i++ {
		bus.Emit(ActivityEvent{SessionID: "s1", State: "active"})
	}

	// Drain what we can.
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			goto done
		}
	}
done:
	// Should have at most 64 (buffer size), the rest were dropped.
	if count > 64 {
		t.Errorf("expected at most 64 events, got %d", count)
	}
}
