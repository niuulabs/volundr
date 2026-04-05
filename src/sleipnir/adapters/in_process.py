"""In-process asyncio event bus adapter for Sleipnir.

This transport uses asyncio queues and in-memory dispatch — zero network
overhead. Suitable for standalone Ravn, tests, and single-process Pi mode.

Each subscriber gets its own bounded asyncio.Queue served by a consumer task.
Overflow evicts the oldest event with a warning log (ring buffer semantics).
"""

from __future__ import annotations

import asyncio
import logging

from sleipnir.domain.events import SleipnirEvent, match_event_type
from sleipnir.ports.events import EventHandler, SleipnirPublisher, SleipnirSubscriber, Subscription

logger = logging.getLogger(__name__)

DEFAULT_RING_BUFFER_DEPTH = 1000


async def _consume(
    queue: asyncio.Queue[SleipnirEvent],
    handler: EventHandler,
) -> None:
    """Consumer loop: read events from *queue* and invoke *handler*."""
    while True:
        event = await queue.get()
        try:
            await handler(event)
        except Exception:
            logger.exception(
                "Handler raised an exception for event %s (%s)",
                event.event_id,
                event.event_type,
            )
        finally:
            queue.task_done()


class _InProcessSubscription(Subscription):
    """A subscription backed by an asyncio.Queue and a consumer task."""

    def __init__(
        self,
        patterns: list[str],
        queue: asyncio.Queue[SleipnirEvent],
        task: asyncio.Task[None],
        bus: InProcessBus,
    ) -> None:
        self._patterns = patterns
        self._queue = queue
        self._task = task
        self._bus = bus
        self._active = True

    @property
    def patterns(self) -> list[str]:
        return self._patterns

    @property
    def active(self) -> bool:
        return self._active

    async def unsubscribe(self) -> None:
        if not self._active:
            return
        self._active = False
        self._bus._remove_subscription(self)
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        # Drain remaining items so join() is never blocked.
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break


class InProcessBus(SleipnirPublisher, SleipnirSubscriber):
    """Combined publisher + subscriber backed by asyncio in-process dispatch.

    Each subscriber owns an ``asyncio.Queue`` with depth ``ring_buffer_depth``.
    When a queue is full, the oldest event is dropped with a warning so that
    slow consumers never block fast producers.
    """

    def __init__(self, ring_buffer_depth: int = DEFAULT_RING_BUFFER_DEPTH) -> None:
        self._ring_buffer_depth = ring_buffer_depth
        self._subscriptions: list[_InProcessSubscription] = []

    def _remove_subscription(self, sub: _InProcessSubscription) -> None:
        try:
            self._subscriptions.remove(sub)
        except ValueError:
            pass

    async def publish(self, event: SleipnirEvent) -> None:
        """Place *event* on every matching subscriber queue."""
        for sub in list(self._subscriptions):
            if not sub.active:
                continue
            if not any(match_event_type(p, event.event_type) for p in sub.patterns):
                continue
            queue = sub._queue
            if queue.full():
                try:
                    dropped = queue.get_nowait()
                    queue.task_done()
                    logger.warning(
                        "Ring buffer overflow (depth=%d): dropped event %s (%s)",
                        self._ring_buffer_depth,
                        dropped.event_id,
                        dropped.event_type,
                    )
                except asyncio.QueueEmpty:
                    pass
            await queue.put(event)

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
        task = asyncio.create_task(_consume(queue, handler))
        sub = _InProcessSubscription(list(event_types), queue, task, self)
        self._subscriptions.append(sub)
        return sub

    async def flush(self) -> None:
        """Wait until every queued event has been processed by its handler.

        Call this in tests after publishing to ensure delivery before asserting.
        """
        for sub in list(self._subscriptions):
            await sub._queue.join()
