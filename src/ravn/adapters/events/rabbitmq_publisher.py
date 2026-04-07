"""RabbitMQ event publisher — publishes drive-loop lifecycle events to RabbitMQ."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from ravn.domain.events import RavnEvent
from ravn.ports.event_publisher import EventPublisherPort

if TYPE_CHECKING:
    from ravn.config import SleipnirConfig

try:
    import aio_pika
except ImportError:  # pragma: no cover
    aio_pika = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _serialise_event(event: RavnEvent) -> bytes:
    """Serialise *event* to UTF-8 JSON bytes."""
    data = {
        "type": event.type,
        "source": event.source,
        "payload": event.payload,
        "timestamp": event.timestamp.isoformat(),
        "urgency": event.urgency,
        "correlation_id": event.correlation_id,
        "session_id": event.session_id,
        "task_id": event.task_id,
        "published_at": datetime.now(UTC).isoformat(),
    }
    return json.dumps(data).encode("utf-8")


class RabbitMQEventPublisher(EventPublisherPort):
    """Publishes drive-loop lifecycle events to RabbitMQ.

    Shares connection logic with SleipnirChannel (NIU-438) but operates
    independently — no session_id, no correlation_id from a turn.

    Routing key: ``ravn.system.<event_type>.<agent_id>``
    Exchange: ``ravn.events`` (same as SleipnirChannel — already declared durable)

    Connection is lazy: established on the first call to ``publish()``.
    Never raises — failures are logged at DEBUG level.
    """

    def __init__(self, config: SleipnirConfig) -> None:
        self._config = config
        self._agent_id = config.agent_id or socket.gethostname()
        self._connection: object | None = None
        self._channel: object | None = None
        self._exchange: object | None = None
        self._last_connect_attempt: float = 0.0
        self._connect_lock = asyncio.Lock()

    async def publish(self, event: RavnEvent) -> None:
        """Publish *event* to RabbitMQ. Never raises — failures are logged."""
        exchange = await self._ensure_exchange()
        if exchange is None:
            logger.debug(
                "rabbitmq_publisher: exchange unavailable, dropping event %s",
                event.type,
            )
            return

        routing_key = f"ravn.system.{event.type}.{self._agent_id}"
        body = _serialise_event(event)

        try:
            if aio_pika is None:
                logger.debug("rabbitmq_publisher: aio_pika not installed, dropping event")
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
            logger.debug("rabbitmq_publisher: publish failed (%s), dropping event", exc)
            await self._invalidate()

    async def close(self) -> None:
        """Close the RabbitMQ connection."""
        await self._invalidate()

    async def _ensure_exchange(self) -> object | None:
        """Return the cached exchange, (re)connecting lazily if needed."""
        if self._exchange is not None:
            return self._exchange

        async with self._connect_lock:
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
            logger.debug("rabbitmq_publisher: aio_pika not installed, publishing disabled")
            return None

        amqp_url = os.environ.get(self._config.amqp_url_env, "")
        if not amqp_url:
            logger.debug(
                "rabbitmq_publisher: %s not set, publishing disabled",
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
                "rabbitmq_publisher: connected to %s, exchange=%s",
                amqp_url,
                self._config.exchange,
            )
            return exchange
        except Exception as exc:
            logger.debug("rabbitmq_publisher: connection failed (%s), will retry", exc)
            return None

    async def _invalidate(self) -> None:
        """Drop cached connection state so next publish attempts to reconnect."""
        self._exchange = None
        self._channel = None
        if self._connection is not None:
            try:
                await self._connection.close()  # type: ignore[union-attr]
            except Exception:
                pass
        self._connection = None
