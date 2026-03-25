"""EventBus port — abstract interface for Tyr's event pub/sub system.

Consumers subscribe to receive TyrEvent objects; producers emit events.
The port is infrastructure-agnostic — the in-memory implementation lives
in ``tyr.adapters.memory_event_bus``.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TyrEvent:
    """A single Tyr SSE event.

    Attributes:
        event: Dot-separated event type (e.g. ``raid.state_changed``).
        data: Arbitrary event payload.
        owner_id: Tenant/user who owns the resource that triggered this event.
            Empty string when the owner is unknown or the event is global.
        id: Unique event identifier (auto-generated UUID by default).
    """

    event: str
    data: dict[str, Any]
    owner_id: str = ""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_sse(self) -> str:
        """Serialise as SSE wire format (id / event / data / blank line)."""
        return f"id: {self.id}\nevent: {self.event}\ndata: {json.dumps(self.data)}\n\n"


class EventBusPort(ABC):
    """Abstract event bus for Tyr domain events.

    Implementations must support fan-out to multiple subscribers,
    snapshot caching for state-type events, and capacity management.
    """

    @abstractmethod
    def subscribe(self) -> asyncio.Queue[TyrEvent]:
        """Register a new subscriber and return its dedicated queue."""

    @abstractmethod
    def unsubscribe(self, q: asyncio.Queue[TyrEvent]) -> None:
        """Remove a subscriber queue — safe to call even if already removed."""

    @abstractmethod
    async def emit(self, event: TyrEvent) -> None:
        """Broadcast an event to every connected subscriber."""

    @abstractmethod
    def get_snapshot(self) -> list[TyrEvent]:
        """Return the current state snapshot for delivery to a new subscriber."""

    @property
    @abstractmethod
    def client_count(self) -> int:
        """Number of currently connected subscribers."""

    @property
    @abstractmethod
    def at_capacity(self) -> bool:
        """True when the maximum number of subscribers is already connected."""
