package tyr

import (
	"testing"
	"time"
)

func TestNewEventLog_DefaultMaxSize(t *testing.T) {
	el := NewEventLog(0)
	if el.maxSize != 100 {
		t.Errorf("expected default maxSize=100, got %d", el.maxSize)
	}
}

func TestNewEventLog_CustomMaxSize(t *testing.T) {
	el := NewEventLog(50)
	if el.maxSize != 50 {
		t.Errorf("expected maxSize=50, got %d", el.maxSize)
	}
}

func TestEventLog_Emit_AddsToBuffer(t *testing.T) {
	el := NewEventLog(10)

	el.Emit("test.event", map[string]any{"key": "value"}, "owner-1")

	events := el.Recent(10)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Event != "test.event" {
		t.Errorf("expected event type 'test.event', got %q", events[0].Event)
	}
	if events[0].Data["key"] != "value" {
		t.Errorf("expected data key='value', got %v", events[0].Data["key"])
	}
	if events[0].OwnerID != "owner-1" {
		t.Errorf("expected owner_id 'owner-1', got %q", events[0].OwnerID)
	}
	if events[0].ID == "" {
		t.Error("expected non-empty event ID")
	}
	if events[0].Timestamp == "" {
		t.Error("expected non-empty timestamp")
	}
}

func TestEventLog_Emit_BroadcastsToSubscribers(t *testing.T) {
	el := NewEventLog(10)

	subID, ch := el.Subscribe()
	defer el.Unsubscribe(subID)

	el.Emit("broadcast.test", map[string]any{"n": 1}, "")

	select {
	case evt := <-ch:
		if evt.Event != "broadcast.test" {
			t.Errorf("expected 'broadcast.test', got %q", evt.Event)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timed out waiting for broadcast event")
	}
}

func TestEventLog_SubscribeUnsubscribe(t *testing.T) {
	el := NewEventLog(10)

	subID, ch := el.Subscribe()

	el.mu.RLock()
	_, exists := el.subscribers[subID]
	el.mu.RUnlock()
	if !exists {
		t.Fatal("expected subscriber to exist after Subscribe()")
	}

	el.Unsubscribe(subID)

	el.mu.RLock()
	_, exists = el.subscribers[subID]
	el.mu.RUnlock()
	if exists {
		t.Fatal("expected subscriber to be removed after Unsubscribe()")
	}

	// Channel should be closed after unsubscribe.
	_, open := <-ch
	if open {
		t.Error("expected channel to be closed after Unsubscribe()")
	}
}

func TestEventLog_Recent_ReturnsLastN(t *testing.T) {
	el := NewEventLog(100)

	for i := 0; i < 10; i++ {
		el.Emit("event", map[string]any{"i": i}, "")
	}

	events := el.Recent(3)
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	// Should be the last 3 events (i=7,8,9).
	if events[0].Data["i"] != 7 {
		t.Errorf("expected first event i=7, got %v", events[0].Data["i"])
	}
	if events[2].Data["i"] != 9 {
		t.Errorf("expected last event i=9, got %v", events[2].Data["i"])
	}
}

func TestEventLog_Recent_MoreThanExists(t *testing.T) {
	el := NewEventLog(100)

	el.Emit("event", nil, "")
	el.Emit("event", nil, "")

	events := el.Recent(50)
	if len(events) != 2 {
		t.Errorf("expected 2 events, got %d", len(events))
	}
}

func TestEventLog_Recent_ZeroOrNegative(t *testing.T) {
	el := NewEventLog(100)

	el.Emit("event", nil, "")
	el.Emit("event", nil, "")

	events := el.Recent(0)
	if len(events) != 2 {
		t.Errorf("expected all 2 events for n=0, got %d", len(events))
	}

	events = el.Recent(-1)
	if len(events) != 2 {
		t.Errorf("expected all 2 events for n=-1, got %d", len(events))
	}
}

func TestEventLog_RingBuffer_WrapsWhenFull(t *testing.T) {
	el := NewEventLog(5)

	// Emit 8 events into a buffer of size 5.
	for i := 0; i < 8; i++ {
		el.Emit("event", map[string]any{"i": i}, "")
	}

	events := el.Recent(10)
	if len(events) != 5 {
		t.Fatalf("expected 5 events (buffer full), got %d", len(events))
	}

	// Oldest should be i=3 (events 0,1,2 were evicted).
	if events[0].Data["i"] != 3 {
		t.Errorf("expected oldest event i=3, got %v", events[0].Data["i"])
	}
	if events[4].Data["i"] != 7 {
		t.Errorf("expected newest event i=7, got %v", events[4].Data["i"])
	}
}

func TestEventLog_Emit_NonBlockingBroadcast(t *testing.T) {
	el := NewEventLog(10)

	// Subscribe but never read from the channel — it has buffer 64.
	subID, _ := el.Subscribe()
	defer el.Unsubscribe(subID)

	// Emit more than the channel buffer. Should not block.
	for i := 0; i < 100; i++ {
		el.Emit("flood", nil, "")
	}

	// If we got here without hanging, the non-blocking broadcast works.
	events := el.Recent(100)
	if len(events) != 10 {
		t.Errorf("expected 10 events in buffer, got %d", len(events))
	}
}
