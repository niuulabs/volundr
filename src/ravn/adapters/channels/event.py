"""Task dispatch channel — inbound task reception from Sleipnir (NIU-505).

Subscribes to ``ravn.task.dispatch`` on the ``ravn.events`` RabbitMQ topic
exchange.  Each inbound message is validated against the known persona
catalogue; unknown or untrusted personas are immediately rejected.

Response events published to the same exchange:

  ravn.task.accepted  — persona valid, task enqueued for execution
  ravn.task.rejected  — persona unknown or not trusted
  ravn.task.progress  — periodic update during execution (caller-driven)
  ravn.task.completed — task finished successfully
  ravn.task.failed    — unrecoverable error during execution

Autonomous mode is activated via ``ravn daemon`` or ``ravn listen`` at the
CLI level; both commands wire this channel into the drive loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from ravn.adapters.personas.loader import PersonaLoader
from ravn.domain.models import AgentTask, OutputMode

if TYPE_CHECKING:
    from ravn.config import SleipnirConfig

try:
    import aio_pika
except ImportError:  # pragma: no cover
    aio_pika = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Routing key constants
# ---------------------------------------------------------------------------

_INBOUND_ROUTING_KEY = "ravn.task.dispatch"

ROUTING_ACCEPTED = "ravn.task.accepted"
ROUTING_REJECTED = "ravn.task.rejected"
ROUTING_PROGRESS = "ravn.task.progress"
ROUTING_COMPLETED = "ravn.task.completed"
ROUTING_FAILED = "ravn.task.failed"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_deadline(value: str | None) -> datetime | None:
    """Parse an ISO-8601 deadline string, returning None on failure."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _build_initiative_context(task_text: str, context: dict) -> str:
    """Combine the task description and optional context dict into a prompt."""
    if not context:
        return task_text
    return f"{task_text}\n\nContext:\n{json.dumps(context, indent=2)}"


# ---------------------------------------------------------------------------
# TaskDispatchChannel
# ---------------------------------------------------------------------------


class TaskDispatchChannel:
    """Inbound task receiver and outbound response publisher for Sleipnir dispatch.

    Subscribes to ``ravn.task.dispatch`` (and the agent-targeted variant
    ``ravn.task.dispatch.<agent_id>``) on the ``ravn.events`` topic exchange.

    For each inbound message:

    1. Parse the dispatch payload.
    2. Validate the requested persona via ``PersonaLoader``.
    3. If persona unknown → publish ``ravn.task.rejected`` and discard.
    4. If persona valid → publish ``ravn.task.accepted`` and call ``enqueue``.

    The caller (drive loop / CLI) can also use the ``publish_*`` methods to
    emit progress, completed, and failed events back to the exchange.

    Parameters
    ----------
    config:
        Sleipnir section from Ravn settings.
    persona_loader:
        Used to validate persona names from dispatch payloads.  Defaults to a
        standard ``PersonaLoader`` (built-in personas + ``~/.ravn/personas``).
    retry_delay_seconds:
        Seconds to wait before reconnecting after a connection error.
    """

    def __init__(
        self,
        config: SleipnirConfig,
        *,
        persona_loader: PersonaLoader | None = None,
        retry_delay_seconds: float = 5.0,
    ) -> None:
        self._config = config
        self._agent_id = config.agent_id or socket.gethostname()
        self._persona_loader = persona_loader or PersonaLoader()
        self._retry_delay_seconds = retry_delay_seconds

        # Lazy publish connection (separate from the consume connection so that
        # a broken consume connection does not block publishing responses).
        self._pub_connection: object | None = None
        self._pub_channel: object | None = None
        self._pub_exchange: object | None = None
        self._pub_lock = asyncio.Lock()
        self._last_pub_attempt: float = 0.0

    # ------------------------------------------------------------------
    # TriggerPort-compatible interface
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """Unique identifier for drive-loop logging."""
        return f"task_dispatch:{self._agent_id}"

    async def run(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        """Subscribe to ``ravn.task.dispatch`` and run until cancelled.

        Reconnects automatically on connection errors.  Returns only when the
        task is cancelled (daemon shutdown).
        """
        if aio_pika is None:
            logger.warning("task_dispatch: aio_pika not installed — TaskDispatchChannel disabled")
            return

        while True:
            try:
                await self._connect_and_consume(enqueue)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning(
                    "task_dispatch: connection error (%s) — retrying in %.0fs",
                    exc,
                    self._retry_delay_seconds,
                )
                await asyncio.sleep(self._retry_delay_seconds)

    # ------------------------------------------------------------------
    # Inbound — consume loop
    # ------------------------------------------------------------------

    async def _connect_and_consume(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        """Establish connection, declare topology, and consume until error."""
        amqp_url = os.environ.get(self._config.amqp_url_env, "")
        if not amqp_url:
            logger.warning(
                "task_dispatch: %s not set — subscription disabled, retrying",
                self._config.amqp_url_env,
            )
            await asyncio.sleep(self._retry_delay_seconds)
            return

        connection = await aio_pika.connect_robust(amqp_url)  # type: ignore[union-attr]
        async with connection:
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                self._config.exchange,
                aio_pika.ExchangeType.TOPIC,  # type: ignore[union-attr]
                durable=True,
            )
            queue_name = f"ravn.dispatch.{self._agent_id}"
            queue = await channel.declare_queue(queue_name, durable=True)

            # Bind broadcast + agent-targeted routing keys.
            await queue.bind(exchange, routing_key=_INBOUND_ROUTING_KEY)
            await queue.bind(
                exchange,
                routing_key=f"{_INBOUND_ROUTING_KEY}.{self._agent_id}",
            )

            logger.info(
                "task_dispatch: listening on exchange=%r queue=%r agent_id=%s",
                self._config.exchange,
                queue_name,
                self._agent_id,
            )

            async with queue.iterator() as q_iter:
                async for message in q_iter:
                    async with message.process():
                        await self._handle_message(message, enqueue)

    async def _handle_message(
        self,
        message: object,
        enqueue: Callable[[AgentTask], Awaitable[None]],
    ) -> None:
        """Process one inbound dispatch message."""
        try:
            payload: dict = json.loads(message.body)  # type: ignore[attr-defined]
        except Exception:
            payload = {}

        task_id = str(payload.get("task_id") or f"dispatch_{int(time.time() * 1000)}")
        persona_name = str(payload.get("persona") or "autonomous-agent")
        task_text = str(payload.get("task") or "")
        context: dict = payload.get("context") or {}
        deadline_str: str | None = payload.get("deadline")
        dispatched_by = str(payload.get("dispatched_by") or "unknown")

        # ----------------------------------------------------------------
        # Persona validation — reject if unknown
        # ----------------------------------------------------------------
        persona = self._persona_loader.load(persona_name)
        if persona is None:
            logger.warning(
                "task_dispatch: unknown persona %r for task %s from %s — rejecting",
                persona_name,
                task_id,
                dispatched_by,
            )
            await self._publish_response(
                ROUTING_REJECTED,
                {
                    "task_id": task_id,
                    "reason": f"unknown persona: {persona_name!r}",
                    "dispatched_by": dispatched_by,
                    "agent_id": self._agent_id,
                },
            )
            return

        # ----------------------------------------------------------------
        # Enqueue accepted task
        # ----------------------------------------------------------------
        deadline = _parse_deadline(deadline_str)
        initiative_context = _build_initiative_context(task_text, context)
        title = (task_text[:100] if task_text else f"task from {dispatched_by}").strip()

        agent_task = AgentTask(
            task_id=task_id,
            title=title,
            initiative_context=initiative_context,
            triggered_by=f"sleipnir:{dispatched_by}",
            output_mode=OutputMode.AMBIENT,
            persona=persona_name,
            deadline=deadline,
        )

        logger.info(
            "task_dispatch: accepted task %s (persona=%s dispatched_by=%s)",
            task_id,
            persona_name,
            dispatched_by,
        )

        await self._publish_response(
            ROUTING_ACCEPTED,
            {
                "task_id": task_id,
                "persona": persona_name,
                "dispatched_by": dispatched_by,
                "agent_id": self._agent_id,
            },
        )
        await enqueue(agent_task)

    # ------------------------------------------------------------------
    # Outbound — response events
    # ------------------------------------------------------------------

    async def publish_progress(
        self,
        task_id: str,
        *,
        iteration: int,
        message: str = "",
    ) -> None:
        """Publish a ``ravn.task.progress`` event for a running task."""
        await self._publish_response(
            ROUTING_PROGRESS,
            {
                "task_id": task_id,
                "iteration": iteration,
                "message": message,
                "agent_id": self._agent_id,
            },
        )

    async def publish_completed(
        self,
        task_id: str,
        *,
        outcome: str = "success",
        summary: str = "",
    ) -> None:
        """Publish a ``ravn.task.completed`` event when a task finishes."""
        await self._publish_response(
            ROUTING_COMPLETED,
            {
                "task_id": task_id,
                "outcome": outcome,
                "summary": summary,
                "agent_id": self._agent_id,
            },
        )

    async def publish_failed(
        self,
        task_id: str,
        *,
        error: str,
    ) -> None:
        """Publish a ``ravn.task.failed`` event on unrecoverable error."""
        await self._publish_response(
            ROUTING_FAILED,
            {
                "task_id": task_id,
                "error": error,
                "agent_id": self._agent_id,
            },
        )

    # ------------------------------------------------------------------
    # Internal publish helpers
    # ------------------------------------------------------------------

    async def _publish_response(self, routing_key: str, payload: dict) -> None:
        """Publish *payload* to *routing_key* on the ravn.events exchange.

        Never raises — failures are logged at DEBUG level.
        """
        exchange = await self._ensure_pub_exchange()
        if exchange is None:
            logger.debug("task_dispatch: pub exchange unavailable, dropping %s", routing_key)
            return

        body = json.dumps(
            {
                "routing_key": routing_key,
                "payload": payload,
                "published_at": datetime.now(UTC).isoformat(),
            }
        ).encode("utf-8")

        try:
            if aio_pika is None:
                return
            message = aio_pika.Message(  # type: ignore[union-attr]
                body=body,
                content_type="application/json",
            )
            await asyncio.wait_for(
                exchange.publish(message, routing_key=routing_key),  # type: ignore[attr-defined]
                timeout=self._config.publish_timeout_s,
            )
        except Exception as exc:
            logger.debug("task_dispatch: publish failed (%s), dropping %s", exc, routing_key)
            await self._invalidate_pub()

    async def _ensure_pub_exchange(self) -> object | None:
        """Return cached publish exchange, reconnecting lazily when needed."""
        if self._pub_exchange is not None:
            return self._pub_exchange

        async with self._pub_lock:
            if self._pub_exchange is not None:
                return self._pub_exchange

            now = asyncio.get_running_loop().time()
            if now - self._last_pub_attempt < self._config.reconnect_delay_s:
                return None

            self._last_pub_attempt = now
            return await self._connect_pub()

    async def _connect_pub(self) -> object | None:
        """Establish a dedicated publish connection."""
        if aio_pika is None:
            return None

        amqp_url = os.environ.get(self._config.amqp_url_env, "")
        if not amqp_url:
            return None

        try:
            connection = await aio_pika.connect_robust(amqp_url)  # type: ignore[union-attr]
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                self._config.exchange,
                aio_pika.ExchangeType.TOPIC,  # type: ignore[union-attr]
                durable=True,
            )
            self._pub_connection = connection
            self._pub_channel = channel
            self._pub_exchange = exchange
            logger.debug(
                "task_dispatch: pub connected to %s exchange=%s",
                amqp_url,
                self._config.exchange,
            )
            return exchange
        except Exception as exc:
            logger.debug("task_dispatch: pub connection failed (%s), will retry", exc)
            return None

    async def _invalidate_pub(self) -> None:
        """Drop cached publish connection so next call reconnects."""
        self._pub_exchange = None
        self._pub_channel = None
        if self._pub_connection is not None:
            try:
                await self._pub_connection.close()  # type: ignore[union-attr]
            except Exception:
                pass
        self._pub_connection = None
