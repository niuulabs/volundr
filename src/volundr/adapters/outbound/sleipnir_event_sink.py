"""Sleipnir event sink — publishes raw session events to the Sleipnir bus.

This sink sits alongside the PostgreSQL, RabbitMQ, and OTel sinks in the
``EventIngestionService`` fan-out pipeline.  Each ``SessionEvent`` ingested
by Volundr is translated to a ``SleipnirEvent`` and published so that Skuld
brokers (and any other Sleipnir subscribers) can react in real time.
"""

from __future__ import annotations

import logging

from sleipnir.domain import registry
from sleipnir.domain.events import SleipnirEvent
from sleipnir.ports.events import SleipnirPublisher
from volundr.domain.models import SessionEvent, SessionEventType
from volundr.domain.ports import EventSink

logger = logging.getLogger(__name__)

_SOURCE = "volundr:event-sink"

# ---------------------------------------------------------------------------
# Event type mapping
# ---------------------------------------------------------------------------

#: Maps each ``SessionEventType`` to the Sleipnir event type constant to use.
_SESSION_TO_SLEIPNIR: dict[SessionEventType, str] = {
    SessionEventType.SESSION_START: registry.VOLUNDR_SESSION_STARTED,
    SessionEventType.SESSION_STOP: registry.VOLUNDR_SESSION_STOPPED,
    SessionEventType.TOKEN_USAGE: registry.VOLUNDR_TOKEN_USAGE,
    SessionEventType.MESSAGE_USER: registry.VOLUNDR_MESSAGE_USER,
    SessionEventType.MESSAGE_ASSISTANT: registry.VOLUNDR_MESSAGE_ASSISTANT,
    SessionEventType.FILE_CREATED: registry.VOLUNDR_FILE_CREATED,
    SessionEventType.FILE_MODIFIED: registry.VOLUNDR_FILE_MODIFIED,
    SessionEventType.FILE_DELETED: registry.VOLUNDR_FILE_DELETED,
    SessionEventType.GIT_COMMIT: registry.VOLUNDR_GIT_COMMIT,
    SessionEventType.GIT_PUSH: registry.VOLUNDR_GIT_PUSH,
    SessionEventType.GIT_BRANCH: registry.VOLUNDR_GIT_BRANCH,
    SessionEventType.GIT_CHECKOUT: registry.VOLUNDR_GIT_CHECKOUT,
    SessionEventType.TERMINAL_COMMAND: registry.VOLUNDR_TERMINAL_COMMAND,
    SessionEventType.TOOL_USE: registry.VOLUNDR_TOOL_USE,
    SessionEventType.ERROR: registry.VOLUNDR_SESSION_ERROR,
}

# Urgency values by event type (0.0 = low, 1.0 = high)
_URGENCY_MAP: dict[SessionEventType, float] = {
    SessionEventType.ERROR: 0.8,
    SessionEventType.SESSION_START: 0.6,
    SessionEventType.SESSION_STOP: 0.6,
    SessionEventType.TOKEN_USAGE: 0.2,
    SessionEventType.GIT_COMMIT: 0.5,
    SessionEventType.GIT_PUSH: 0.6,
}
_DEFAULT_URGENCY: float = 0.3


class SleipnirEventSink(EventSink):
    """``EventSink`` that republishes ``SessionEvent`` records to Sleipnir.

    Converts each inbound ``SessionEvent`` to a ``SleipnirEvent`` using a
    static type mapping and then publishes via the injected
    ``SleipnirPublisher``.  Event types with no mapping are silently dropped
    with a debug log.

    Failures are logged and re-raised so the :class:`EventIngestionService`
    can record them, but they never block the other sinks.
    """

    def __init__(
        self,
        publisher: SleipnirPublisher,
        source: str = _SOURCE,
    ) -> None:
        """Initialise the sink.

        :param publisher: The Sleipnir publisher to forward events to.
        :param source: Source identifier included in each published event
            (e.g. ``"volundr:event-sink"`` or ``"volundr:prod"``).
        """
        self._publisher = publisher
        self._source = source
        self._healthy = True

    # ------------------------------------------------------------------
    # EventSink interface
    # ------------------------------------------------------------------

    async def emit(self, event: SessionEvent) -> None:
        """Translate *event* and publish to Sleipnir."""
        sleipnir_event = self._to_sleipnir(event)
        if sleipnir_event is None:
            return
        try:
            await self._publisher.publish(sleipnir_event)
            self._healthy = True
        except Exception:
            logger.warning(
                "SleipnirEventSink: failed to publish event %s (type=%s)",
                event.id,
                event.event_type,
                exc_info=True,
            )
            self._healthy = False
            raise

    async def emit_batch(self, events: list[SessionEvent]) -> None:
        """Translate and publish a batch of ``SessionEvent`` records."""
        sleipnir_events = [mapped for ev in events if (mapped := self._to_sleipnir(ev)) is not None]
        if not sleipnir_events:
            return
        try:
            await self._publisher.publish_batch(sleipnir_events)
            self._healthy = True
        except Exception:
            logger.warning(
                "SleipnirEventSink: failed to publish batch of %d events",
                len(sleipnir_events),
                exc_info=True,
            )
            self._healthy = False
            raise

    async def flush(self) -> None:
        """No-op: Sleipnir publishers are fire-and-forget."""

    async def close(self) -> None:
        """No-op: publisher lifecycle is managed externally."""

    @property
    def sink_name(self) -> str:
        return "sleipnir"

    @property
    def healthy(self) -> bool:
        return self._healthy

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _to_sleipnir(self, event: SessionEvent) -> SleipnirEvent | None:
        """Convert a ``SessionEvent`` to a ``SleipnirEvent``.

        Returns ``None`` for unmapped event types (e.g. future types not yet
        registered in ``_SESSION_TO_SLEIPNIR``).
        """
        event_type = _SESSION_TO_SLEIPNIR.get(event.event_type)
        if event_type is None:
            logger.debug(
                "SleipnirEventSink: no mapping for SessionEventType %s, skipping",
                event.event_type,
            )
            return None

        session_id = str(event.session_id)
        tenant_id: str | None = event.data.get("tenant_id")

        payload: dict = {
            "session_id": session_id,
            "event_id": str(event.id),
            "sequence": event.sequence,
            **event.data,
        }
        if event.tokens_in is not None:
            payload["tokens_in"] = event.tokens_in
        if event.tokens_out is not None:
            payload["tokens_out"] = event.tokens_out
        if event.cost is not None:
            payload["cost"] = float(event.cost)
        if event.duration_ms is not None:
            payload["duration_ms"] = event.duration_ms
        if event.model is not None:
            payload["model"] = event.model

        urgency = _URGENCY_MAP.get(event.event_type, _DEFAULT_URGENCY)

        return SleipnirEvent(
            event_type=event_type,
            source=self._source,
            payload=payload,
            summary=f"{event.event_type.value} in session {session_id}",
            urgency=urgency,
            domain="code",
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
            event_type=registry.VOLUNDR_CHRONICLE_CREATED,
            source=_SOURCE,
            payload={"chronicle_id": chronicle_id, "session_id": session_id},
            summary=f"Chronicle created for session {session_id}",
            urgency=0.3,
            domain="code",
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
            event_type=registry.VOLUNDR_CHRONICLE_UPDATED,
            source=_SOURCE,
            payload={"chronicle_id": chronicle_id, "session_id": session_id},
            summary=f"Chronicle updated for session {session_id}",
            urgency=0.2,
            domain="code",
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
