"""In-process asyncio event bus adapter for Sleipnir.

This transport uses asyncio queues and in-memory dispatch — zero network
overhead. Suitable for standalone Ravn, tests, and single-process Pi mode.

Each subscriber gets its own bounded asyncio.Queue served by a consumer task.
Overflow evicts the oldest event with a warning log (ring buffer semantics).
"""

from __future__ import annotations

import asyncio
import logging

from sleipnir.adapters._subscriber_support import (
    _BaseSubscription,
    consume_queue,
    enqueue_with_overflow,
)
from sleipnir.domain.events import SleipnirEvent, match_event_type
from sleipnir.ports.events import EventHandler, SleipnirPublisher, SleipnirSubscriber, Subscription

logger = logging.getLogger(__name__)

DEFAULT_RING_BUFFER_DEPTH = 1000


class InProcessBus(SleipnirPublisher, SleipnirSubscriber):
    """Combined publisher + subscriber backed by asyncio in-process dispatch.

    Each subscriber owns an ``asyncio.Queue`` with depth ``ring_buffer_depth``.
    When a queue is full, the oldest event is dropped with a warning so that
    slow consumers never block fast producers.
    """

    def __init__(self, ring_buffer_depth: int = DEFAULT_RING_BUFFER_DEPTH) -> None:
        if ring_buffer_depth < 1:
            raise ValueError(f"ring_buffer_depth must be >= 1, got {ring_buffer_depth}")
        self._ring_buffer_depth = ring_buffer_depth
        self._subscriptions: list[_BaseSubscription] = []

    def _remove_subscription(self, sub: _BaseSubscription) -> None:
        try:
            self._subscriptions.remove(sub)
        except ValueError:
            pass

    async def publish(self, event: SleipnirEvent) -> None:
        """Place *event* on every matching subscriber queue.

        Events with ``ttl=0`` are expired on arrival and never delivered.
        """
        if event.ttl is not None and event.ttl <= 0:
            logger.debug(
                "Dropping expired event %s (%s): ttl=%d",
                event.event_id,
                event.event_type,
                event.ttl,
            )
            return
        for sub in list(self._subscriptions):
            if not sub.active:
                continue
            if not any(match_event_type(p, event.event_type) for p in sub.patterns):
                continue
            await enqueue_with_overflow(sub._queue, event, self._ring_buffer_depth, logger)

    async def publish_batch(self, events: list[SleipnirEvent]) -> None:
        """Publish all *events* in iteration order."""
        for event in events:
            await self.publish(event)

    async def subscribe(
        self,
        event_types: list[str],
        handler: EventHandler,
    ) -> Subscription:
        """Register *handler* for events matching any pattern in *event_types*."""
        queue: asyncio.Queue[SleipnirEvent] = asyncio.Queue(maxsize=self._ring_buffer_depth)
        task = asyncio.create_task(consume_queue(queue, handler))
        sub = _BaseSubscription(
            list(event_types), queue, task, lambda: self._remove_subscription(sub)
        )
        self._subscriptions.append(sub)
        return sub

    async def flush(self) -> None:
        """Wait until every queued event has been processed by its handler.

        Call this in tests after publishing to ensure delivery before asserting.
        """
        for sub in list(self._subscriptions):
            await sub._queue.join()
