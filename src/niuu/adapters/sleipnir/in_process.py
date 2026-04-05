"""In-process asyncio event bus adapter for Sleipnir.

This transport uses asyncio queues and in-memory dispatch — zero network
overhead. Suitable for standalone Ravn, tests, and single-process Pi mode.
"""

from __future__ import annotations

import logging

from niuu.domain.sleipnir import SleipnirEvent, match_event_type
from niuu.ports.sleipnir import EventHandler, SleipnirPublisher, SleipnirSubscriber, Subscription

logger = logging.getLogger(__name__)


class _InProcessSubscription(Subscription):
    """A subscription backed by an in-process handler registration."""

    def __init__(
        self,
        patterns: list[str],
        handler: EventHandler,
        bus: InProcessBus,
    ) -> None:
        self._patterns = patterns
        self._handler = handler
        self._bus = bus
        self._active = True

    @property
    def patterns(self) -> list[str]:
        return self._patterns

    @property
    def handler(self) -> EventHandler:
        return self._handler

    @property
    def active(self) -> bool:
        return self._active

    async def unsubscribe(self) -> None:
        if not self._active:
            return
        self._active = False
        self._bus._remove_subscription(self)


class InProcessBus(SleipnirPublisher, SleipnirSubscriber):
    """Combined publisher + subscriber backed by asyncio in-process dispatch.

    All publish calls dispatch events synchronously to registered handlers
    within the same event loop iteration (awaited sequentially). This gives
    simple, deterministic behaviour for testing and single-process use.
    """

    def __init__(self) -> None:
        self._subscriptions: list[_InProcessSubscription] = []

    def _remove_subscription(self, sub: _InProcessSubscription) -> None:
        try:
            self._subscriptions.remove(sub)
        except ValueError:
            pass

    async def publish(self, event: SleipnirEvent) -> None:
        """Dispatch *event* to all matching active subscriptions."""
        for sub in list(self._subscriptions):
            if not sub.active:
                continue
            if not any(match_event_type(p, event.event_type) for p in sub.patterns):
                continue
            try:
                await sub.handler(event)
            except Exception:
                logger.exception(
                    "Handler raised an exception for event %s (%s)",
                    event.event_id,
                    event.event_type,
                )

    async def publish_batch(self, events: list[SleipnirEvent]) -> None:
        """Dispatch all *events* in order to matching subscribers."""
        for event in events:
            await self.publish(event)

    async def subscribe(
        self,
        event_types: list[str],
        handler: EventHandler,
    ) -> Subscription:
        """Register *handler* for events matching any pattern in *event_types*."""
        sub = _InProcessSubscription(list(event_types), handler, self)
        self._subscriptions.append(sub)
        return sub
