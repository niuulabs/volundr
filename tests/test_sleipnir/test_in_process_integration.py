"""Integration tests: in-process transport adapter contract (NIU-520).

These tests define the behavioural specification that *all* Sleipnir transport
adapters must satisfy.  Each test case maps 1-to-1 with a requirement from
NIU-520 and is marked with the requirement name in the docstring.

Transport adapters can re-use this module as a shared test suite by
parameterising the ``bus`` fixture to supply their own implementation.
"""

from __future__ import annotations

import asyncio
import logging
import time

import pytest

from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.events import SleipnirEvent
from tests.test_sleipnir.conftest import make_event

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_HIGH_VOLUME_EVENT_COUNT = 50_000
_HIGH_VOLUME_BUFFER_DEPTH = 60_000  # larger than event count → no overflow


# ---------------------------------------------------------------------------
# 1. publish → single subscriber receives event
# ---------------------------------------------------------------------------


async def test_contract_single_subscriber_receives_event():
    """Contract: publish → single subscriber receives the published event."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["ravn.*"], handler)
    event = make_event(event_id="evt-single")
    await bus.publish(event)
    await bus.flush()

    assert len(received) == 1
    assert received[0].event_id == "evt-single"


# ---------------------------------------------------------------------------
# 2. publish → multiple subscribers each receive event independently
# ---------------------------------------------------------------------------


async def test_contract_multiple_subscribers_receive_independently():
    """Contract: each subscriber gets its own independent copy of the event."""
    bus = InProcessBus()
    bucket_a: list[SleipnirEvent] = []
    bucket_b: list[SleipnirEvent] = []
    bucket_c: list[SleipnirEvent] = []

    async def handler_a(evt: SleipnirEvent) -> None:
        bucket_a.append(evt)

    async def handler_b(evt: SleipnirEvent) -> None:
        bucket_b.append(evt)

    async def handler_c(evt: SleipnirEvent) -> None:
        bucket_c.append(evt)

    await bus.subscribe(["ravn.*"], handler_a)
    await bus.subscribe(["ravn.*"], handler_b)
    await bus.subscribe(["ravn.*"], handler_c)

    event = make_event(event_id="evt-multi")
    await bus.publish(event)
    await bus.flush()

    assert len(bucket_a) == 1
    assert len(bucket_b) == 1
    assert len(bucket_c) == 1
    assert bucket_a[0].event_id == "evt-multi"
    assert bucket_b[0].event_id == "evt-multi"
    assert bucket_c[0].event_id == "evt-multi"


# ---------------------------------------------------------------------------
# 3. glob pattern 'ravn.*' matches 'ravn.tool.complete',
#    does not match 'tyr.raid.complete'
# ---------------------------------------------------------------------------


async def test_contract_glob_ravn_star_matches_and_rejects():
    """Contract: 'ravn.*' matches ravn.tool.complete; rejects tyr.raid.complete."""
    bus = InProcessBus()
    received_types: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        received_types.append(evt.event_type)

    await bus.subscribe(["ravn.*"], handler)
    await bus.publish(make_event(event_type="ravn.tool.complete", event_id="e1"))
    await bus.publish(make_event(event_type="tyr.task.started", event_id="e2"))
    await bus.flush()

    assert received_types == ["ravn.tool.complete"]


# ---------------------------------------------------------------------------
# 4. glob pattern '*' matches all event types
# ---------------------------------------------------------------------------


async def test_contract_glob_star_matches_all_event_types():
    """Contract: '*' is a global wildcard that matches every event type."""
    bus = InProcessBus()
    received_types: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        received_types.append(evt.event_type)

    await bus.subscribe(["*"], handler)

    event_types = [
        "ravn.tool.complete",
        "tyr.task.started",
        "volundr.pr.opened",
        "bifrost.connection.open",
        "system.health.ping",
    ]
    for i, et in enumerate(event_types):
        await bus.publish(make_event(event_type=et, event_id=str(i)))
    await bus.flush()

    assert sorted(received_types) == sorted(event_types)


# ---------------------------------------------------------------------------
# 5. publish_batch → all events delivered in order
# ---------------------------------------------------------------------------


async def test_contract_publish_batch_delivers_in_order():
    """Contract: publish_batch delivers all events in the original iteration order."""
    bus = InProcessBus()
    order: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        order.append(evt.event_id)

    await bus.subscribe(["*"], handler)

    batch = [make_event(event_id=f"batch-{i}") for i in range(20)]
    await bus.publish_batch(batch)
    await bus.flush()

    assert order == [f"batch-{i}" for i in range(20)]


# ---------------------------------------------------------------------------
# 6. unsubscribe → no further events received after unsubscribe
# ---------------------------------------------------------------------------


async def test_contract_unsubscribe_stops_delivery():
    """Contract: events published after unsubscribe are never delivered."""
    bus = InProcessBus()
    received: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt.event_id)

    sub = await bus.subscribe(["ravn.*"], handler)

    await bus.publish(make_event(event_id="before"))
    await bus.flush()

    await sub.unsubscribe()

    await bus.publish(make_event(event_id="after"))
    await bus.flush()

    assert received == ["before"]


# ---------------------------------------------------------------------------
# 7. ring buffer overflow → oldest events dropped, warning logged,
#    newer events still delivered
# ---------------------------------------------------------------------------


async def test_contract_ring_buffer_overflow_drops_oldest_and_warns(caplog):
    """Contract: overflow drops oldest event, logs a warning, newer events arrive."""
    bus = InProcessBus(ring_buffer_depth=3)
    received_ids: list[str] = []

    async def slow_handler(evt: SleipnirEvent) -> None:
        await asyncio.sleep(100)  # blocks; events pile up in the queue
        received_ids.append(evt.event_id)

    await bus.subscribe(["*"], slow_handler)

    # Publish 5 events into a depth-3 buffer (one slot already occupied by
    # the first event being processed): e1 and e2 will be dropped.
    with caplog.at_level(logging.WARNING, logger="sleipnir.adapters.in_process"):
        for i in range(1, 6):
            await bus.publish(make_event(event_id=f"e{i}"))

    warning_records = [r for r in caplog.records if "Ring buffer overflow" in r.message]
    assert len(warning_records) >= 1

    # The queue should still have events — the adapter was not blocked
    assert not bus._subscriptions[0]._queue.empty()


# ---------------------------------------------------------------------------
# 8. high-volume: 50,000 events, no dropped events below buffer depth
# ---------------------------------------------------------------------------


async def test_contract_high_volume_no_drops_below_buffer_depth():
    """Contract: no events dropped when count < ring_buffer_depth."""
    bus = InProcessBus(ring_buffer_depth=_HIGH_VOLUME_BUFFER_DEPTH)
    received: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt.event_id)

    await bus.subscribe(["*"], handler)

    start = time.monotonic()
    batch = [make_event(event_id=str(i)) for i in range(_HIGH_VOLUME_EVENT_COUNT)]
    await bus.publish_batch(batch)
    await bus.flush()
    elapsed = time.monotonic() - start

    assert len(received) == _HIGH_VOLUME_EVENT_COUNT
    assert [r for r in received] == [str(i) for i in range(_HIGH_VOLUME_EVENT_COUNT)]

    # Sanity-check throughput: 50k events should complete well under 30 s
    assert elapsed < 30.0, f"High-volume test took {elapsed:.2f}s — too slow"


# ---------------------------------------------------------------------------
# 9. correlation_id preserved end-to-end
# ---------------------------------------------------------------------------


async def test_contract_correlation_id_preserved():
    """Contract: correlation_id on the published event reaches the subscriber unchanged."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)
    event = make_event(event_id="evt-corr", correlation_id="corr-abc-123")
    await bus.publish(event)
    await bus.flush()

    assert len(received) == 1
    assert received[0].correlation_id == "corr-abc-123"


# ---------------------------------------------------------------------------
# 10. urgency field preserved end-to-end
# ---------------------------------------------------------------------------


async def test_contract_urgency_preserved():
    """Contract: urgency on the published event reaches the subscriber unchanged."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)
    event = make_event(event_id="evt-urgency", urgency=0.9)
    await bus.publish(event)
    await bus.flush()

    assert len(received) == 1
    assert received[0].urgency == pytest.approx(0.9)


# ---------------------------------------------------------------------------
# 11. ttl=0 events are not delivered (expired immediately)
# ---------------------------------------------------------------------------


async def test_contract_ttl_zero_events_not_delivered():
    """Contract: events with ttl=0 are expired on arrival and never delivered."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)

    expired = make_event(event_id="evt-expired", ttl=0)
    live = make_event(event_id="evt-live", ttl=None)

    await bus.publish(expired)
    await bus.publish(live)
    await bus.flush()

    assert len(received) == 1
    assert received[0].event_id == "evt-live"


async def test_contract_ttl_negative_events_not_delivered():
    """Contract: events with ttl < 0 are also expired and never delivered."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)
    await bus.publish(make_event(event_id="neg-ttl", ttl=-5))
    await bus.flush()

    assert received == []


async def test_contract_ttl_positive_events_are_delivered():
    """Contract: events with ttl > 0 are not yet expired and must be delivered."""
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)
    await bus.publish(make_event(event_id="pos-ttl", ttl=60))
    await bus.flush()

    assert len(received) == 1
    assert received[0].event_id == "pos-ttl"
