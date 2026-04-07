"""Sleipnir channel adapter — publishes RavnEvents to RabbitMQ (NIU-438).

Events are wrapped in a SleipnirEnvelope and published to the ``ravn.events``
topic exchange with routing key ``ravn.<event_type>.<agent_id>``.

Connection is lazy: established on the first call to ``emit()``, not at
startup.  If RabbitMQ is unavailable the adapter swallows the error and logs
at DEBUG level so the agent never fails due to Sleipnir being down.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.domain.models import SleipnirEnvelope
from ravn.ports.channel import ChannelPort

if TYPE_CHECKING:
    from ravn.config import SleipnirConfig

try:
    import aio_pika
except ImportError:  # pragma: no cover
    aio_pika = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Urgency mapping (set by the adapter, not by the event factories)
# ---------------------------------------------------------------------------

_URGENCY: dict[RavnEventType, float] = {
    RavnEventType.THOUGHT: 0.1,
    RavnEventType.TOOL_START: 0.1,
    RavnEventType.TOOL_RESULT: 0.1,
    RavnEventType.RESPONSE: 0.2,
    RavnEventType.ERROR: 0.6,
    RavnEventType.DECISION: 0.9,
    RavnEventType.TASK_COMPLETE: 0.2,  # overridden for failures below
}


def _urgency_for(event: RavnEvent) -> float:
    """Return the Sleipnir urgency hint for *event*.

    TASK_COMPLETE urgency is elevated to 0.7 when the task failed (detected
    via the ``success`` key in the event payload).
    """
    if event.type == RavnEventType.TASK_COMPLETE:
        return 0.2 if event.payload.get("success", True) else 0.7
    return _URGENCY.get(event.type, 0.2)


# ---------------------------------------------------------------------------
# JSON serialisation helpers
# ---------------------------------------------------------------------------


def _serialise_envelope(envelope: SleipnirEnvelope) -> bytes:
    """Serialise *envelope* to UTF-8 JSON bytes."""
    event = envelope.event
    data = {
        "event": {
            "type": event.type,
            "source": event.source,
            "payload": event.payload,
            "timestamp": event.timestamp.isoformat(),
            "urgency": event.urgency,
            "correlation_id": event.correlation_id,
            "session_id": event.session_id,
            "task_id": event.task_id,
        },
        "source_agent": envelope.source_agent,
        "session_id": envelope.session_id,
        "task_id": envelope.task_id,
        "urgency": envelope.urgency,
        "correlation_id": envelope.correlation_id,
        "published_at": envelope.published_at.isoformat(),
    }
    return json.dumps(data).encode("utf-8")


# ---------------------------------------------------------------------------
# SleipnirChannel
# ---------------------------------------------------------------------------


class SleipnirChannel(ChannelPort):
    """Publishes RavnEvents to RabbitMQ via the Sleipnir event backbone.

    Parameters
    ----------
    config:
        Sleipnir section from Ravn settings.
    session_id:
        Session identifier forwarded to the envelope.
    task_id:
        Drive-loop task ID (NIU-539 integration point), or ``None`` for
        interactive turns.
    """

    def __init__(
        self,
        config: SleipnirConfig,
        *,
        session_id: str,
        task_id: str | None = None,
    ) -> None:
        self._config = config
        self._session_id = session_id
        self._task_id = task_id
        self._agent_id = config.agent_id or socket.gethostname()
        self._connection: object | None = None
        self._channel: object | None = None
        self._exchange: object | None = None
        self._last_connect_attempt: float = 0.0
        self._connect_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # ChannelPort interface
    # ------------------------------------------------------------------

    async def emit(self, event: RavnEvent) -> None:
        """Emit *event* to RabbitMQ. Never raises — failures are logged."""
        envelope = SleipnirEnvelope(
            event=event,
            source_agent=self._agent_id,
            session_id=self._session_id,
            task_id=self._task_id,
            urgency=_urgency_for(event),
            correlation_id=event.correlation_id,
            published_at=datetime.now(UTC),
        )
        await self._publish(envelope)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _publish(self, envelope: SleipnirEnvelope) -> None:
        """Serialise *envelope* and publish to RabbitMQ, swallowing errors."""
        exchange = await self._ensure_exchange()
        if exchange is None:
            logger.debug(
                "sleipnir: exchange unavailable, dropping event %s",
                envelope.event.type,
            )
            return

        routing_key = f"ravn.{envelope.event.type}.{self._agent_id}"
        body = _serialise_envelope(envelope)

        try:
            if aio_pika is None:
                logger.debug("sleipnir: aio_pika not installed, dropping event")
                return

            message = aio_pika.Message(
                body=body,
                content_type="application/json",
            )
            await asyncio.wait_for(
                exchange.publish(message, routing_key=routing_key),
                timeout=self._config.publish_timeout_s,
            )
        except Exception as exc:
            logger.debug("sleipnir: publish failed (%s), dropping event", exc)
            await self._invalidate()

    async def _ensure_exchange(self) -> object | None:
        """Return the cached exchange, (re)connecting lazily if needed."""
        if self._exchange is not None:
            return self._exchange

        async with self._connect_lock:
            # Double-checked locking — another coroutine may have connected.
            if self._exchange is not None:
                return self._exchange

            now = asyncio.get_running_loop().time()
            if now - self._last_connect_attempt < self._config.reconnect_delay_s:
                return None

            self._last_connect_attempt = now
            return await self._connect()

    async def _connect(self) -> object | None:
        """Establish a RabbitMQ connection and declare the topic exchange."""
        if aio_pika is None:
            logger.debug("sleipnir: aio_pika not installed, publishing disabled")
            return None

        amqp_url = os.environ.get(self._config.amqp_url_env, "")
        if not amqp_url:
            logger.debug(
                "sleipnir: %s not set, publishing disabled",
                self._config.amqp_url_env,
            )
            return None

        try:
            connection = await aio_pika.connect_robust(amqp_url)
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                self._config.exchange,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            self._connection = connection
            self._channel = channel
            self._exchange = exchange
            logger.debug(
                "sleipnir: connected to %s, exchange=%s",
                amqp_url,
                self._config.exchange,
            )
            return exchange
        except Exception as exc:
            logger.debug("sleipnir: connection failed (%s), will retry", exc)
            return None

    async def _invalidate(self) -> None:
        """Drop cached connection state so the next emit attempts to reconnect."""
        self._exchange = None
        self._channel = None
        if self._connection is not None:
            try:
                await self._connection.close()  # type: ignore[union-attr]
            except Exception:
                pass
        self._connection = None
