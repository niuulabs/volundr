"""Tests for the in-process Sleipnir event bus adapter."""

from __future__ import annotations

from datetime import UTC, datetime

from niuu.adapters.sleipnir.in_process import InProcessBus
from niuu.domain.sleipnir import SleipnirEvent

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _event(event_type: str = "ravn.tool.complete", event_id: str = "e1") -> SleipnirEvent:
    return SleipnirEvent(
        event_id=event_id,
        event_type=event_type,
        source="ravn:agent-test",
        payload={},
        summary="test event",
        urgency=0.3,
        domain="code",
        timestamp=datetime(2026, 4, 5, tzinfo=UTC),
    )


# ---------------------------------------------------------------------------
# publish → subscribe → handler called
# ---------------------------------------------------------------------------


async def test_subscribe_and_receive_event():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["ravn.*"], handler)
    await bus.publish(_event("ravn.tool.complete"))

    assert len(received) == 1
    assert received[0].event_id == "e1"


async def test_handler_not_called_for_non_matching_event():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["ravn.*"], handler)
    await bus.publish(_event("tyr.saga.created"))

    assert received == []


async def test_multiple_patterns_any_match_triggers_handler():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["tyr.*", "ravn.*"], handler)
    await bus.publish(_event("ravn.tool.complete"))
    await bus.publish(_event("tyr.saga.created"))
    await bus.publish(_event("volundr.pr.opened"))

    assert len(received) == 2
    types = {e.event_type for e in received}
    assert types == {"ravn.tool.complete", "tyr.saga.created"}


# ---------------------------------------------------------------------------
# Batch publishing
# ---------------------------------------------------------------------------


async def test_publish_batch_delivers_all_events():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], handler)
    events = [
        _event("ravn.tool.complete", "e1"),
        _event("tyr.saga.created", "e2"),
        _event("volundr.pr.opened", "e3"),
    ]
    await bus.publish_batch(events)

    assert len(received) == 3
    assert [e.event_id for e in received] == ["e1", "e2", "e3"]


async def test_publish_batch_preserves_order():
    bus = InProcessBus()
    order: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        order.append(evt.event_id)

    await bus.subscribe(["*"], handler)
    await bus.publish_batch([_event(event_id=str(i)) for i in range(10)])

    assert order == [str(i) for i in range(10)]


# ---------------------------------------------------------------------------
# Multiple subscribers
# ---------------------------------------------------------------------------


async def test_multiple_subscribers_each_receive_event():
    bus = InProcessBus()
    bucket_a: list[SleipnirEvent] = []
    bucket_b: list[SleipnirEvent] = []

    async def handler_a(evt: SleipnirEvent) -> None:
        bucket_a.append(evt)

    async def handler_b(evt: SleipnirEvent) -> None:
        bucket_b.append(evt)

    await bus.subscribe(["ravn.*"], handler_a)
    await bus.subscribe(["ravn.*"], handler_b)
    await bus.publish(_event("ravn.tool.complete"))

    assert len(bucket_a) == 1
    assert len(bucket_b) == 1


# ---------------------------------------------------------------------------
# Unsubscribe
# ---------------------------------------------------------------------------


async def test_unsubscribe_stops_delivery():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    sub = await bus.subscribe(["ravn.*"], handler)
    await bus.publish(_event("ravn.tool.complete", "e1"))
    await sub.unsubscribe()
    await bus.publish(_event("ravn.tool.complete", "e2"))

    assert len(received) == 1
    assert received[0].event_id == "e1"


async def test_unsubscribe_is_idempotent():
    bus = InProcessBus()

    async def handler(evt: SleipnirEvent) -> None:
        pass

    sub = await bus.subscribe(["ravn.*"], handler)
    await sub.unsubscribe()
    await sub.unsubscribe()  # Should not raise


async def test_unsubscribe_removes_from_bus():
    bus = InProcessBus()

    async def handler(evt: SleipnirEvent) -> None:
        pass

    sub = await bus.subscribe(["*"], handler)
    assert len(bus._subscriptions) == 1
    await sub.unsubscribe()
    assert len(bus._subscriptions) == 0


# ---------------------------------------------------------------------------
# Handler exception isolation
# ---------------------------------------------------------------------------


async def test_failing_handler_does_not_block_other_handlers():
    bus = InProcessBus()
    received: list[SleipnirEvent] = []

    async def bad_handler(evt: SleipnirEvent) -> None:
        raise RuntimeError("intentional test error")

    async def good_handler(evt: SleipnirEvent) -> None:
        received.append(evt)

    await bus.subscribe(["*"], bad_handler)
    await bus.subscribe(["*"], good_handler)
    await bus.publish(_event())

    assert len(received) == 1


# ---------------------------------------------------------------------------
# Global wildcard
# ---------------------------------------------------------------------------


async def test_global_wildcard_receives_all_namespaces():
    bus = InProcessBus()
    received: list[str] = []

    async def handler(evt: SleipnirEvent) -> None:
        received.append(evt.event_type)

    await bus.subscribe(["*"], handler)
    for et in [
        "ravn.tool.complete",
        "tyr.saga.created",
        "volundr.pr.opened",
        "bifrost.connection.open",
        "system.health.ping",
    ]:
        await bus.publish(_event(et))

    assert len(received) == 5
