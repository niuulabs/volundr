"""Tyr event bus — in-process pub/sub for SSE broadcasting.

Application services call ``event_bus.emit(event)`` to broadcast state changes.
The SSE handler subscribes a per-client queue and streams events to the browser.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

# Event types that represent current persistent state.
# These are cached and replayed to new subscribers as an initial snapshot,
# so the UI doesn't need a separate hydration call.
_SNAPSHOT_TYPES: frozenset[str] = frozenset({"dispatcher.state"})


@dataclass
class TyrEvent:
    """A single Tyr SSE event."""

    event: str
    data: dict[str, Any]
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_sse(self) -> str:
        """Serialise as SSE wire format (id / event / data / blank line)."""
        return f"id: {self.id}\nevent: {self.event}\ndata: {json.dumps(self.data)}\n\n"


class EventBus:
    """In-process broadcast bus for Tyr SSE events.

    One queue per connected SSE client.  ``emit`` fans out to all queues.
    State-type events are cached and replayed to new clients on subscribe.
    """

    def __init__(self, max_clients: int = 10) -> None:
        self._max_clients = max_clients
        self._queues: list[asyncio.Queue[TyrEvent]] = []
        self._snapshots: dict[str, TyrEvent] = {}

    @property
    def client_count(self) -> int:
        """Number of currently connected SSE clients."""
        return len(self._queues)

    @property
    def at_capacity(self) -> bool:
        """True when the maximum number of SSE clients is already connected."""
        return len(self._queues) >= self._max_clients

    def subscribe(self) -> asyncio.Queue[TyrEvent]:
        """Register a new SSE client and return its dedicated queue."""
        q: asyncio.Queue[TyrEvent] = asyncio.Queue()
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[TyrEvent]) -> None:
        """Remove a client queue — safe to call even if already removed."""
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    async def emit(self, event: TyrEvent) -> None:
        """Broadcast an event to every connected client queue.

        State-type events (``_SNAPSHOT_TYPES``) are also saved so they can be
        replayed to new subscribers via ``get_snapshot``.
        """
        if event.event in _SNAPSHOT_TYPES:
            self._snapshots[event.event] = event
        for q in list(self._queues):
            await q.put(event)

    def get_snapshot(self) -> list[TyrEvent]:
        """Return the current state snapshot for delivery to a new subscriber."""
        return list(self._snapshots.values())
