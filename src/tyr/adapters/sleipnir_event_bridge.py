"""Sleipnir event bridge for Tyr — mirrors TyrEvents onto the Sleipnir bus.

:class:`SleipnirEventBridge` is a decorator around :class:`~tyr.ports.event_bus.EventBusPort`.
All calls are forwarded to the inner bus unchanged; in addition, each emitted
:class:`~tyr.ports.event_bus.TyrEvent` is mapped to a :class:`~sleipnir.domain.events.SleipnirEvent`
and published on the Sleipnir bus.

This enables Skuld (and other Sleipnir subscribers) to receive Tyr activity
events (saga progression, raid state changes, dispatcher health) without
polling Tyr's SSE endpoint.

Event mapping
-------------
``dispatcher.state``      → ``tyr.task.started``
``saga.created``          → ``tyr.saga.created``
``saga.step``             → ``tyr.saga.step``
``saga.completed``        → ``tyr.saga.complete``
``saga.failed``           → ``tyr.saga.failed``
``raid.state_changed``    → ``tyr.task.*``  (derived from new_status)
``notification.*``        → silently dropped (internal)
"""

from __future__ import annotations

import asyncio
import logging

from sleipnir.domain.events import SleipnirEvent
from sleipnir.domain.registry import (
    TYR_SAGA_COMPLETE,
    TYR_SAGA_CREATED,
    TYR_SAGA_FAILED,
    TYR_SAGA_STEP,
    TYR_TASK_CANCELLED,
    TYR_TASK_COMPLETE,
    TYR_TASK_FAILED,
    TYR_TASK_QUEUED,
    TYR_TASK_STARTED,
)
from sleipnir.ports.events import SleipnirPublisher
from tyr.ports.event_bus import EventBusPort, TyrEvent

logger = logging.getLogger(__name__)

_SOURCE = "tyr:event-bridge"

# Map saga.* TyrEvent types to Sleipnir constants.
_SAGA_TYPE_MAP: dict[str, str] = {
    "saga.created": TYR_SAGA_CREATED,
    "saga.step": TYR_SAGA_STEP,
    "saga.completed": TYR_SAGA_COMPLETE,
    "saga.failed": TYR_SAGA_FAILED,
}

# Map raid new_status values to Sleipnir task event types.
_RAID_STATUS_MAP: dict[str, str] = {
    "QUEUED": TYR_TASK_QUEUED,
    "RUNNING": TYR_TASK_STARTED,
    "MERGED": TYR_TASK_COMPLETE,
    "FAILED": TYR_TASK_FAILED,
    "CANCELLED": TYR_TASK_CANCELLED,
}


class SleipnirEventBridge(EventBusPort):
    """Decorator around :class:`EventBusPort` that also publishes to Sleipnir.

    All :class:`EventBusPort` operations are delegated to the *inner* bus.
    ``emit`` additionally publishes a :class:`SleipnirEvent` to *publisher*;
    publication errors are logged and swallowed to protect the inner bus.

    Args:
        inner: The actual :class:`EventBusPort` implementation.
        publisher: Sleipnir publisher to mirror events onto.
    """

    def __init__(self, inner: EventBusPort, publisher: SleipnirPublisher) -> None:
        self._inner = inner
        self._publisher = publisher

    # ------------------------------------------------------------------
    # EventBusPort delegation
    # ------------------------------------------------------------------

    def subscribe(self) -> asyncio.Queue[TyrEvent]:
        return self._inner.subscribe()

    def unsubscribe(self, q: asyncio.Queue[TyrEvent]) -> None:
        self._inner.unsubscribe(q)

    async def emit(self, event: TyrEvent) -> None:
        """Broadcast to inner bus *and* publish to Sleipnir."""
        await self._inner.emit(event)
        await self._mirror_to_sleipnir(event)

    def get_snapshot(self) -> list[TyrEvent]:
        return self._inner.get_snapshot()

    def get_log(self, n: int) -> list[TyrEvent]:
        return self._inner.get_log(n)

    @property
    def client_count(self) -> int:
        return self._inner.client_count

    @property
    def at_capacity(self) -> bool:
        return self._inner.at_capacity

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _mirror_to_sleipnir(self, event: TyrEvent) -> None:
        """Map *event* to a Sleipnir event and publish; swallow errors."""
        sleipnir_event = self._to_sleipnir(event)
        if sleipnir_event is None:
            return
        try:
            await self._publisher.publish(sleipnir_event)
        except Exception:
            logger.error(
                "SleipnirEventBridge: failed to publish %s (%s) to Sleipnir",
                event.event,
                event.id,
                exc_info=True,
            )

    def _to_sleipnir(self, event: TyrEvent) -> SleipnirEvent | None:
        """Return a mapped :class:`SleipnirEvent` or ``None`` if not forwarded."""
        owner_id = event.owner_id or None

        if event.event in _SAGA_TYPE_MAP:
            return self._map_saga(event, _SAGA_TYPE_MAP[event.event], owner_id)

        if event.event == "raid.state_changed":
            return self._map_raid(event, owner_id)

        if event.event == "dispatcher.state":
            return self._map_dispatcher_state(event, owner_id)

        return None

    def _map_saga(
        self,
        event: TyrEvent,
        sleipnir_type: str,
        owner_id: str | None,
    ) -> SleipnirEvent:
        saga_id = str(event.data.get("saga_id", ""))
        saga_name = str(event.data.get("name", ""))
        return SleipnirEvent(
            event_type=sleipnir_type,
            source=_SOURCE,
            payload={"owner_id": owner_id or "", **event.data},
            summary=f"Saga {event.event.split('.')[-1]}: {saga_name or saga_id}",
            urgency=0.6,
            domain="code",
            timestamp=event.timestamp,
            correlation_id=saga_id or None,
            tenant_id=owner_id,
        )

    def _map_raid(self, event: TyrEvent, owner_id: str | None) -> SleipnirEvent | None:
        new_status = str(event.data.get("new_status", "")).upper()
        sleipnir_type = _RAID_STATUS_MAP.get(new_status)
        if sleipnir_type is None:
            return None
        raid_id = str(event.data.get("raid_id", ""))
        return SleipnirEvent(
            event_type=sleipnir_type,
            source=_SOURCE,
            payload={"owner_id": owner_id or "", **event.data},
            summary=f"Raid {new_status.lower()}: {raid_id}",
            urgency=0.5,
            domain="code",
            timestamp=event.timestamp,
            correlation_id=raid_id or None,
            tenant_id=owner_id,
        )

    def _map_dispatcher_state(self, event: TyrEvent, owner_id: str | None) -> SleipnirEvent:
        return SleipnirEvent(
            event_type=TYR_TASK_STARTED,
            source=_SOURCE,
            payload={"owner_id": owner_id or "", **event.data},
            summary="Dispatcher state updated",
            urgency=0.3,
            domain="infrastructure",
            timestamp=event.timestamp,
            tenant_id=owner_id,
        )
