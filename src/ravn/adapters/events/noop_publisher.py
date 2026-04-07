"""No-op event publisher — silently discards all events."""

from __future__ import annotations

from ravn.domain.events import RavnEvent
from ravn.ports.event_publisher import EventPublisherPort


class NoOpEventPublisher(EventPublisherPort):
    """Silently discards all events. Default when Sleipnir is not configured."""

    async def publish(self, event: RavnEvent) -> None:
        pass
