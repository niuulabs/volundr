"""Tests for tyr.adapters.sleipnir_event_bridge.SleipnirEventBridge."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.registry import (
    TYR_SAGA_COMPLETE,
    TYR_SAGA_CREATED,
    TYR_SAGA_FAILED,
    TYR_SAGA_STEP,
    TYR_TASK_COMPLETE,
    TYR_TASK_FAILED,
    TYR_TASK_QUEUED,
    TYR_TASK_STARTED,
)
from sleipnir.testing import EventCapture
from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.adapters.sleipnir_event_bridge import SleipnirEventBridge
from tyr.ports.event_bus import TyrEvent

_TS = datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC)


def _make_tyr_event(event: str, data: dict | None = None, owner_id: str = "") -> TyrEvent:
    return TyrEvent(
        event=event,
        data=data or {},
        owner_id=owner_id,
        id="evt-001",
        timestamp=_TS,
    )


# ---------------------------------------------------------------------------
# Delegation to inner bus
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeDelegation:
    async def test_emit_calls_inner_bus(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())

        q = bridge.subscribe()
        event = _make_tyr_event("saga.created", {"saga_id": "s-1", "name": "My Saga"})
        await bridge.emit(event)

        received = q.get_nowait()
        assert received is event

    def test_subscribe_returns_queue_from_inner(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())
        q = bridge.subscribe()
        assert isinstance(q, asyncio.Queue)

    def test_unsubscribe_removes_from_inner(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())
        q = bridge.subscribe()
        assert inner.client_count == 1
        bridge.unsubscribe(q)
        assert inner.client_count == 0

    def test_client_count_delegates(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())
        bridge.subscribe()
        assert bridge.client_count == 1

    def test_at_capacity_delegates(self):
        inner = InMemoryEventBus(max_clients=1)
        bridge = SleipnirEventBridge(inner, AsyncMock())
        bridge.subscribe()
        assert bridge.at_capacity is True

    def test_get_snapshot_delegates(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())
        assert bridge.get_snapshot() == []

    def test_get_log_delegates(self):
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, AsyncMock())
        assert bridge.get_log(10) == []


# ---------------------------------------------------------------------------
# Saga event mirroring
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeSagaMirroring:
    async def test_saga_created_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_SAGA_CREATED]) as capture:
            await bridge.emit(
                _make_tyr_event("saga.created", {"saga_id": "s-1", "name": "Test Saga"})
            )
            await sleipnir.flush()

        assert len(capture.events) == 1
        evt = capture.events[0]
        assert evt.event_type == TYR_SAGA_CREATED
        assert evt.payload["saga_id"] == "s-1"
        assert "Test Saga" in evt.summary

    async def test_saga_step_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_SAGA_STEP]) as capture:
            await bridge.emit(_make_tyr_event("saga.step", {"saga_id": "s-1", "step": 2}))
            await sleipnir.flush()

        assert len(capture.events) == 1

    async def test_saga_completed_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_SAGA_COMPLETE]) as capture:
            await bridge.emit(_make_tyr_event("saga.completed", {"saga_id": "s-1"}))
            await sleipnir.flush()

        assert len(capture.events) == 1

    async def test_saga_failed_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_SAGA_FAILED]) as capture:
            await bridge.emit(_make_tyr_event("saga.failed", {"saga_id": "s-1"}))
            await sleipnir.flush()

        assert len(capture.events) == 1


# ---------------------------------------------------------------------------
# Raid event mirroring
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeRaidMirroring:
    async def test_raid_queued_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_TASK_QUEUED]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "raid.state_changed",
                    {"raid_id": "r-1", "new_status": "QUEUED"},
                )
            )
            await sleipnir.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == TYR_TASK_QUEUED

    async def test_raid_running_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_TASK_STARTED]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "raid.state_changed",
                    {"raid_id": "r-1", "new_status": "RUNNING"},
                )
            )
            await sleipnir.flush()

        assert len(capture.events) == 1

    async def test_raid_merged_maps_to_task_complete(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_TASK_COMPLETE]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "raid.state_changed",
                    {"raid_id": "r-1", "new_status": "MERGED"},
                )
            )
            await sleipnir.flush()

        assert len(capture.events) == 1

    async def test_raid_failed_mirrored(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_TASK_FAILED]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "raid.state_changed",
                    {"raid_id": "r-1", "new_status": "FAILED"},
                )
            )
            await sleipnir.flush()

        assert len(capture.events) == 1

    async def test_raid_review_status_not_forwarded(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, ["tyr.*"]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "raid.state_changed",
                    {"raid_id": "r-1", "new_status": "REVIEW"},
                )
            )
            await sleipnir.flush()

        assert len(capture.events) == 0


# ---------------------------------------------------------------------------
# Events not forwarded
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeNoForward:
    async def test_notification_events_not_forwarded(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, ["tyr.*"]) as capture:
            await bridge.emit(_make_tyr_event("notification.sent", {"channel": "telegram"}))
            await sleipnir.flush()

        assert len(capture.events) == 0

    async def test_unrecognized_event_type_not_forwarded(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, ["tyr.*"]) as capture:
            await bridge.emit(_make_tyr_event("some.unknown.event", {}))
            await sleipnir.flush()

        assert len(capture.events) == 0


# ---------------------------------------------------------------------------
# Owner/tenant propagation
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeTenant:
    async def test_owner_id_propagated_as_tenant_id(self):
        sleipnir = InProcessBus()
        inner = InMemoryEventBus()
        bridge = SleipnirEventBridge(inner, sleipnir)

        async with EventCapture(sleipnir, [TYR_SAGA_CREATED]) as capture:
            await bridge.emit(
                _make_tyr_event(
                    "saga.created",
                    {"saga_id": "s-1", "name": "My Saga"},
                    owner_id="user-42",
                )
            )
            await sleipnir.flush()

        assert capture.events[0].tenant_id == "user-42"


# ---------------------------------------------------------------------------
# Fault tolerance
# ---------------------------------------------------------------------------


class TestSleipnirEventBridgeFaultTolerance:
    async def test_sleipnir_publish_error_does_not_block_inner_bus(self):
        inner = InMemoryEventBus()
        publisher = AsyncMock()
        publisher.publish.side_effect = RuntimeError("sleipnir down")
        bridge = SleipnirEventBridge(inner, publisher)

        q = bridge.subscribe()
        event = _make_tyr_event("saga.created", {"saga_id": "s-1", "name": "X"})
        await bridge.emit(event)  # must not raise

        # Inner bus still received the event
        received = q.get_nowait()
        assert received is event
