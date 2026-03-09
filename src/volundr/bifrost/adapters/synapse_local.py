"""Local in-process Synapse adapter using asyncio."""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from volundr.bifrost.models import SynapseEnvelope
from volundr.bifrost.ports import Synapse

logger = logging.getLogger(__name__)


class LocalSynapse(Synapse):
    """In-process Synapse backed by asyncio tasks.

    Messages are Python objects passed by reference — zero-copy,
    no serialization.  Suitable for single-process local mode where
    Bifröst and all workers live in the same event loop.

    Publishing never blocks or raises.  Handler exceptions are logged
    and swallowed so a misbehaving subscriber cannot disrupt the
    proxy's request path.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable[[SynapseEnvelope], Awaitable[None]]]] = (
            defaultdict(list)
        )
        self._running = True
        self._pending_tasks: set[asyncio.Task] = set()  # type: ignore[type-arg]

    async def publish(self, topic: str, message: SynapseEnvelope) -> None:
        if not self._running:
            return

        handlers = self._subscribers.get(topic, [])
        for handler in handlers:
            task = asyncio.create_task(self._safe_dispatch(handler, message))
            self._pending_tasks.add(task)
            task.add_done_callback(self._pending_tasks.discard)

    async def subscribe(
        self,
        topic: str,
        handler: Callable[[SynapseEnvelope], Awaitable[None]],
    ) -> None:
        self._subscribers[topic].append(handler)

    async def close(self) -> None:
        self._running = False
        if self._pending_tasks:
            await asyncio.gather(*self._pending_tasks, return_exceptions=True)
        self._subscribers.clear()

    @staticmethod
    async def _safe_dispatch(
        handler: Callable[[SynapseEnvelope], Awaitable[None]],
        message: SynapseEnvelope,
    ) -> None:
        try:
            await handler(message)
        except Exception:
            logger.exception(
                "Synapse handler %s raised (swallowed)",
                getattr(handler, "__qualname__", handler),
            )
