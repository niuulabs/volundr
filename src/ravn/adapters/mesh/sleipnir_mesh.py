"""SleipnirMeshAdapter — infra-mode Ravn-to-Ravn mesh via RabbitMQ (NIU-517).

Shares the AMQP connection from ``SleipnirConfig`` — no second connection.

**Pub/sub topology**

- ``publish()`` publishes to the ``ravn.mesh`` topic exchange with routing
  key ``ravn.mesh.<topic>.<source_peer_id>``.
- ``subscribe()`` binds an anonymous, exclusive queue to the exchange with
  the routing-key pattern ``ravn.mesh.<topic>.#``.

**Direct send — RabbitMQ RPC pattern**

- ``send()`` declares a temporary exclusive reply queue named
  ``ravn.rpc.reply.<own_peer_id>.<nonce>``.
- Publishes the request to ``ravn.mesh.rpc.<target_peer_id>`` with
  ``reply_to`` set to the reply queue name.
- Awaits a response on the reply queue within *timeout_s*.
- On response: deletes the reply queue and returns the decoded dict.

The target Ravn consumes from ``ravn.mesh.rpc.<own_peer_id>`` — this
consumer is started in ``start()``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import TYPE_CHECKING

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.ports.mesh import PeerNotFoundError

if TYPE_CHECKING:
    from ravn.config import MeshSleipnirConfig, SleipnirConfig

try:
    import aio_pika  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    aio_pika = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_RPC_ROUTING_PREFIX = "ravn.mesh.rpc"


def _encode_event(event: RavnEvent) -> bytes:
    return json.dumps(
        {
            "type": event.type,
            "source": event.source,
            "payload": event.payload,
            "timestamp": event.timestamp.isoformat(),
            "urgency": event.urgency,
            "correlation_id": event.correlation_id,
            "session_id": event.session_id,
            "task_id": event.task_id,
        }
    ).encode()


def _decode_event(data: bytes) -> RavnEvent:
    raw = json.loads(data)
    return RavnEvent(
        type=RavnEventType(raw["type"]),
        source=raw["source"],
        payload=raw["payload"],
        timestamp=datetime.fromisoformat(raw["timestamp"]),
        urgency=raw["urgency"],
        correlation_id=raw["correlation_id"],
        session_id=raw["session_id"],
        task_id=raw.get("task_id"),
    )


class SleipnirMeshAdapter:
    """RabbitMQ-based mesh transport for infra mode.

    Parameters
    ----------
    sleipnir_config:
        Main Sleipnir config block (carries the AMQP URL env var and
        reconnect timing).
    mesh_sleipnir_config:
        Mesh-specific Sleipnir settings (exchange name, rpc_timeout_s).
    own_peer_id:
        This Ravn's unique peer identifier.
    discovery:
        Injected DiscoveryPort — used to verify that a target peer is
        trusted before routing an RPC request to it.
    """

    def __init__(
        self,
        sleipnir_config: SleipnirConfig,
        mesh_sleipnir_config: MeshSleipnirConfig,
        own_peer_id: str,
        discovery: object,
    ) -> None:
        self._sleipnir_config = sleipnir_config
        self._mesh_config = mesh_sleipnir_config
        self._own_peer_id = own_peer_id
        self._discovery = discovery

        self._connection: object | None = None
        self._channel: object | None = None
        self._exchange: object | None = None
        self._connect_lock = asyncio.Lock()
        self._last_connect_attempt: float = 0.0

        self._handlers: dict[str, Callable[[RavnEvent], Awaitable[None]]] = {}
        self._rpc_handler: Callable[[dict], Awaitable[dict]] | None = None

        self._rpc_consumer_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public API — MeshPort interface
    # ------------------------------------------------------------------

    async def publish(self, event: RavnEvent, topic: str) -> None:
        """Broadcast *event* to the mesh exchange under *topic*."""
        exchange = await self._ensure_exchange()
        if exchange is None:
            logger.debug("sleipnir_mesh: exchange unavailable, dropping publish")
            return

        routing_key = f"{self._mesh_config.exchange}.{topic}.{self._own_peer_id}"
        body = _encode_event(event)
        try:
            msg = aio_pika.Message(body=body, content_type="application/json")  # type: ignore[union-attr]
            await asyncio.wait_for(
                exchange.publish(msg, routing_key=routing_key),
                timeout=self._sleipnir_config.publish_timeout_s,
            )
        except Exception as exc:
            logger.debug("sleipnir_mesh: publish failed (%s)", exc)
            await self._invalidate()

    async def subscribe(
        self,
        topic: str,
        handler: Callable[[RavnEvent], Awaitable[None]],
    ) -> None:
        """Bind an anonymous queue to the mesh exchange for *topic*."""
        self._handlers[topic] = handler
        channel = await self._ensure_channel()
        if channel is None:
            return
        exchange = await self._ensure_exchange()
        if exchange is None:
            return
        await self._bind_topic_queue(channel, exchange, topic, handler)

    async def unsubscribe(self, topic: str) -> None:
        """Remove handler for *topic* (best-effort)."""
        self._handlers.pop(topic, None)

    async def send(
        self,
        target_peer_id: str,
        message: dict,
        *,
        timeout_s: float = 10.0,
    ) -> dict:
        """Send *message* directly to *target_peer_id* and await its reply.

        Raises
        ------
        PeerNotFoundError
            If the peer is not in the verified DiscoveryPort peer table.
        TimeoutError
            If no reply arrives within *timeout_s*.
        """
        self._assert_peer_trusted(target_peer_id)

        channel = await self._ensure_channel()
        if channel is None:
            raise RuntimeError("sleipnir_mesh: AMQP channel unavailable for send()")

        exchange = await self._ensure_exchange()
        if exchange is None:
            raise RuntimeError("sleipnir_mesh: AMQP exchange unavailable for send()")

        nonce = uuid.uuid4().hex
        reply_queue_name = f"ravn.rpc.reply.{self._own_peer_id}.{nonce}"
        reply_queue = await channel.declare_queue(
            reply_queue_name,
            exclusive=True,
            auto_delete=True,
        )

        try:
            body = json.dumps(message).encode()
            routing_key = f"{_RPC_ROUTING_PREFIX}.{target_peer_id}"
            msg = aio_pika.Message(  # type: ignore[union-attr]
                body=body,
                reply_to=reply_queue_name,
                correlation_id=nonce,
                content_type="application/json",
            )
            await asyncio.wait_for(
                exchange.publish(msg, routing_key=routing_key),
                timeout=self._sleipnir_config.publish_timeout_s,
            )

            # Await reply
            try:
                async with asyncio.timeout(timeout_s):
                    async with reply_queue.iterator() as q_iter:
                        async for incoming in q_iter:
                            async with incoming.process():
                                return json.loads(incoming.body)
            except TimeoutError as exc:
                raise TimeoutError(
                    f"No reply from peer {target_peer_id!r} within {timeout_s}s"
                ) from exc
        finally:
            try:
                await reply_queue.delete()
            except Exception:
                pass

    async def start(self) -> None:
        """Connect to RabbitMQ and start the RPC consumer."""
        if aio_pika is None:  # pragma: no cover
            logger.warning("sleipnir_mesh: aio_pika not installed — mesh disabled")
            return

        exchange = await self._ensure_exchange()
        if exchange is None:
            logger.warning("sleipnir_mesh: could not connect at startup — will retry lazily")
            return

        # Re-bind any already-registered topic handlers
        channel = await self._ensure_channel()
        if channel is not None:
            for topic, handler in self._handlers.items():
                await self._bind_topic_queue(channel, exchange, topic, handler)

        self._rpc_consumer_task = asyncio.create_task(
            self._rpc_consumer_loop(), name="sleipnir_mesh_rpc_consumer"
        )
        logger.info(
            "sleipnir_mesh: started peer=%s exchange=%s",
            self._own_peer_id,
            self._mesh_config.exchange,
        )

    async def stop(self) -> None:
        """Graceful shutdown."""
        if self._rpc_consumer_task is not None:
            self._rpc_consumer_task.cancel()
            try:
                await self._rpc_consumer_task
            except asyncio.CancelledError:
                pass
            self._rpc_consumer_task = None

        await self._invalidate()
        logger.info("sleipnir_mesh: stopped peer=%s", self._own_peer_id)

    def set_rpc_handler(self, handler: Callable[[dict], Awaitable[dict]]) -> None:
        """Register the handler called for every incoming RPC request."""
        self._rpc_handler = handler

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _assert_peer_trusted(self, peer_id: str) -> None:
        """Raise ``PeerNotFoundError`` if *peer_id* is not in the peer table."""
        try:
            peers = self._discovery.peers()  # type: ignore[attr-defined]
        except Exception:
            peers = {}
        if peer_id not in peers:
            raise PeerNotFoundError(peer_id)

    async def _ensure_exchange(self) -> object | None:
        if self._exchange is not None:
            return self._exchange

        async with self._connect_lock:
            if self._exchange is not None:
                return self._exchange

            now = asyncio.get_running_loop().time()
            if now - self._last_connect_attempt < self._sleipnir_config.reconnect_delay_s:
                return None

            self._last_connect_attempt = now
            return await self._connect()

    async def _ensure_channel(self) -> object | None:
        await self._ensure_exchange()
        return self._channel

    async def _connect(self) -> object | None:
        if aio_pika is None:
            return None

        amqp_url = os.environ.get(self._sleipnir_config.amqp_url_env, "")
        if not amqp_url:
            logger.debug(
                "sleipnir_mesh: %s not set, mesh disabled",
                self._sleipnir_config.amqp_url_env,
            )
            return None

        try:
            connection = await aio_pika.connect_robust(amqp_url)
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                self._mesh_config.exchange,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            self._connection = connection
            self._channel = channel
            self._exchange = exchange
            logger.debug("sleipnir_mesh: connected exchange=%s", self._mesh_config.exchange)
            return exchange
        except Exception as exc:
            logger.debug("sleipnir_mesh: connection failed (%s), will retry", exc)
            return None

    async def _invalidate(self) -> None:
        self._exchange = None
        self._channel = None
        if self._connection is not None:
            try:
                await self._connection.close()  # type: ignore[union-attr]
            except Exception:
                pass
        self._connection = None

    async def _bind_topic_queue(
        self,
        channel: object,
        exchange: object,
        topic: str,
        handler: Callable[[RavnEvent], Awaitable[None]],
    ) -> None:
        """Declare an exclusive queue and bind it to *topic* on the exchange."""
        try:
            queue = await channel.declare_queue("", exclusive=True)  # type: ignore[union-attr]
            pattern = f"{self._mesh_config.exchange}.{topic}.#"
            await queue.bind(exchange, routing_key=pattern)

            async def _consume(message: object) -> None:  # type: ignore[type-arg]
                async with message.process():  # type: ignore[attr-defined]
                    try:
                        event = _decode_event(message.body)  # type: ignore[attr-defined]
                        await handler(event)
                    except Exception as exc:
                        logger.warning("sleipnir_mesh: handler for %r raised: %s", topic, exc)

            await queue.consume(_consume)  # type: ignore[union-attr]
        except Exception as exc:
            logger.debug("sleipnir_mesh: bind_topic_queue %r failed: %s", topic, exc)

    async def _rpc_consumer_loop(self) -> None:
        """Consume from the own-peer RPC queue and dispatch requests."""
        if aio_pika is None:  # pragma: no cover
            return

        while True:
            try:
                await self._run_rpc_consumer()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.debug(
                    "sleipnir_mesh: rpc_consumer error (%s) — retrying in %.0fs",
                    exc,
                    self._sleipnir_config.reconnect_delay_s,
                )
                await asyncio.sleep(self._sleipnir_config.reconnect_delay_s)

    async def _run_rpc_consumer(self) -> None:
        channel = await self._ensure_channel()
        if channel is None:
            await asyncio.sleep(self._sleipnir_config.reconnect_delay_s)
            return

        exchange = await self._ensure_exchange()
        if exchange is None:
            await asyncio.sleep(self._sleipnir_config.reconnect_delay_s)
            return

        rpc_routing_key = f"{_RPC_ROUTING_PREFIX}.{self._own_peer_id}"
        queue = await channel.declare_queue(  # type: ignore[union-attr]
            rpc_routing_key, durable=False, auto_delete=True
        )
        await queue.bind(exchange, routing_key=rpc_routing_key)

        logger.debug("sleipnir_mesh: RPC consumer listening on %s", rpc_routing_key)

        async with queue.iterator() as q_iter:
            async for message in q_iter:
                async with message.process():
                    await self._handle_rpc_message(message)

    async def _handle_rpc_message(self, message: object) -> None:
        """Decode *message*, call RPC handler, publish reply."""
        try:
            request = json.loads(message.body)  # type: ignore[attr-defined]
        except Exception as exc:
            logger.warning("sleipnir_mesh: could not decode RPC request: %s", exc)
            return

        reply_to = getattr(message, "reply_to", None)
        correlation_id = getattr(message, "correlation_id", None)

        try:
            if self._rpc_handler is not None:
                reply = await self._rpc_handler(request)
            else:
                reply = {"error": "no rpc handler registered"}
        except Exception as exc:
            reply = {"error": str(exc)}

        if not reply_to:
            return

        channel = await self._ensure_channel()
        if channel is None:
            return

        try:
            reply_msg = aio_pika.Message(  # type: ignore[union-attr]
                body=json.dumps(reply).encode(),
                correlation_id=correlation_id,
                content_type="application/json",
            )
            # Publish directly to the reply queue (default exchange, routing_key=queue_name)
            default_exchange = await channel.get_exchange("")  # type: ignore[union-attr]
            await default_exchange.publish(reply_msg, routing_key=reply_to)
        except Exception as exc:
            logger.debug("sleipnir_mesh: failed to send RPC reply: %s", exc)
