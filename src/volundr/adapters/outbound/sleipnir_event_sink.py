"""Sleipnir event sink — publishes Volundr session events to the Sleipnir bus.

Volundr's session lifecycle events (start, stop, fail), token usage, and
chronicle updates are mapped to structured :class:`~sleipnir.domain.events.SleipnirEvent`
objects and published to the Sleipnir bus.  Downstream subscribers (Skuld,
Tyr, analytics pipelines) then react to those events.
"""

from __future__ import annotations

import logging

from sleipnir.domain.events import SleipnirEvent
from sleipnir.domain.registry import (
    VOLUNDR_CHRONICLE_CREATED,
    VOLUNDR_CHRONICLE_UPDATED,
    VOLUNDR_SESSION_STARTED,
    VOLUNDR_SESSION_STOPPED,
    VOLUNDR_TOKEN_USAGE,
)
from sleipnir.ports.events import SleipnirPublisher
from volundr.domain.models import SessionEvent, SessionEventType
from volundr.domain.ports import EventSink

logger = logging.getLogger(__name__)

_SOURCE = "volundr:event-sink"

# Map SessionEventType → Sleipnir event type for session lifecycle.
_SESSION_TYPE_MAP: dict[SessionEventType, str] = {
    SessionEventType.SESSION_START: VOLUNDR_SESSION_STARTED,
    SessionEventType.SESSION_STOP: VOLUNDR_SESSION_STOPPED,
}


class SleipnirEventSink(EventSink):
    """EventSink adapter that publishes Volundr session events to Sleipnir.

    Failures in the Sleipnir publisher are logged and swallowed so that
    a transport outage does not interrupt core session event storage.
    """

    def __init__(self, publisher: SleipnirPublisher) -> None:
        self._publisher = publisher
        self._healthy = True

    @property
    def sink_name(self) -> str:
        return "sleipnir"

    @property
    def healthy(self) -> bool:
        return self._healthy

    async def emit(self, event: SessionEvent) -> None:
        """Map *event* to a Sleipnir event and publish it."""
        sleipnir_event = self._to_sleipnir(event)
        if sleipnir_event is None:
            return
        try:
            await self._publisher.publish(sleipnir_event)
            self._healthy = True
        except Exception:
            self._healthy = False
            logger.error(
                "SleipnirEventSink: failed to publish %s for session %s",
                event.event_type,
                event.session_id,
                exc_info=True,
            )

    async def emit_batch(self, events: list[SessionEvent]) -> None:
        """Map and publish each event individually."""
        for event in events:
            await self.emit(event)

    async def flush(self) -> None:
        """No-op — Sleipnir publisher is fire-and-forget."""

    async def close(self) -> None:
        """No-op — publisher lifecycle is managed externally."""

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _to_sleipnir(self, event: SessionEvent) -> SleipnirEvent | None:
        """Map a :class:`SessionEvent` to a :class:`SleipnirEvent`.

        Returns ``None`` for event types that are not forwarded to Sleipnir.
        """
        session_id = str(event.session_id)
        tenant_id = event.data.get("tenant_id")

        if event.event_type in _SESSION_TYPE_MAP:
            return self._session_lifecycle(event, session_id, tenant_id)

        if event.event_type == SessionEventType.TOKEN_USAGE:
            return self._token_usage(event, session_id, tenant_id)

        return None

    def _session_lifecycle(
        self,
        event: SessionEvent,
        session_id: str,
        tenant_id: str | None,
    ) -> SleipnirEvent:
        event_type = _SESSION_TYPE_MAP[event.event_type]
        payload: dict = {
            "session_id": session_id,
            **event.data,
        }
        summary = f"Session {event.event_type.value.replace('_', ' ')}: {session_id}"
        return SleipnirEvent(
            event_type=event_type,
            source=_SOURCE,
            payload=payload,
            summary=summary,
            urgency=0.6,
            domain="infrastructure",
            timestamp=event.timestamp,
            correlation_id=session_id,
            tenant_id=tenant_id,
        )

    def _token_usage(
        self,
        event: SessionEvent,
        session_id: str,
        tenant_id: str | None,
    ) -> SleipnirEvent:
        tokens_in = event.tokens_in or 0
        tokens_out = event.tokens_out or 0
        payload: dict = {
            "session_id": session_id,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost": float(event.cost) if event.cost is not None else None,
            "model": event.model,
            **event.data,
        }
        summary = f"Token usage for session {session_id}: {tokens_in}in/{tokens_out}out"
        return SleipnirEvent(
            event_type=VOLUNDR_TOKEN_USAGE,
            source=_SOURCE,
            payload=payload,
            summary=summary,
            urgency=0.2,
            domain="infrastructure",
            timestamp=event.timestamp,
            correlation_id=session_id,
            tenant_id=tenant_id,
        )


class ChronicleEventSink:
    """Publishes chronicle lifecycle events to Sleipnir.

    This is a standalone publisher (not an EventSink) since chronicle events
    are produced by the chronicle service, not the session event pipeline.
    """

    def __init__(self, publisher: SleipnirPublisher) -> None:
        self._publisher = publisher

    async def publish_created(
        self,
        chronicle_id: str,
        session_id: str,
        tenant_id: str | None = None,
    ) -> None:
        """Publish a chronicle-created event."""
        event = SleipnirEvent(
            event_type=VOLUNDR_CHRONICLE_CREATED,
            source=_SOURCE,
            payload={"chronicle_id": chronicle_id, "session_id": session_id},
            summary=f"Chronicle created for session {session_id}",
            urgency=0.3,
            domain="infrastructure",
            timestamp=SleipnirEvent.now(),
            correlation_id=session_id,
            tenant_id=tenant_id,
        )
        try:
            await self._publisher.publish(event)
        except Exception:
            logger.error(
                "ChronicleEventSink: failed to publish chronicle.created for %s",
                chronicle_id,
                exc_info=True,
            )

    async def publish_updated(
        self,
        chronicle_id: str,
        session_id: str,
        tenant_id: str | None = None,
    ) -> None:
        """Publish a chronicle-updated event."""
        event = SleipnirEvent(
            event_type=VOLUNDR_CHRONICLE_UPDATED,
            source=_SOURCE,
            payload={"chronicle_id": chronicle_id, "session_id": session_id},
            summary=f"Chronicle updated for session {session_id}",
            urgency=0.2,
            domain="infrastructure",
            timestamp=SleipnirEvent.now(),
            correlation_id=session_id,
            tenant_id=tenant_id,
        )
        try:
            await self._publisher.publish(event)
        except Exception:
            logger.error(
                "ChronicleEventSink: failed to publish chronicle.updated for %s",
                chronicle_id,
                exc_info=True,
            )
