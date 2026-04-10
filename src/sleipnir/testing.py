"""Test utilities for Sleipnir-based components.

Provides helpers to capture events and await specific events during tests,
without requiring an external broker.
"""

from __future__ import annotations

import asyncio
from types import TracebackType

from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.events import SleipnirEvent
from sleipnir.ports.events import Subscription

DEFAULT_WAIT_TIMEOUT = 5.0


class EventCapture:
    """A test subscriber that collects all received events for assertion.

    Subscribes to *bus* on the given *event_types* patterns and records every
    event that arrives. Use as an async context manager or call
    :meth:`start` / :meth:`stop` manually.

    Example::

        async with EventCapture(bus, ["ravn.*"]) as capture:
            await bus.publish(make_event())
            await bus.flush()
            assert len(capture.events) == 1
            assert capture.events[0].event_type == "ravn.tool.complete"
    """

    def __init__(self, bus: InProcessBus, event_types: list[str]) -> None:
        self._bus = bus
        self._event_types = event_types
        self._events: list[SleipnirEvent] = []
        self._subscription: Subscription | None = None

    @property
    def events(self) -> list[SleipnirEvent]:
        """Immutable snapshot of all events received so far."""
        return list(self._events)

    async def _handler(self, event: SleipnirEvent) -> None:
        self._events.append(event)

    async def start(self) -> None:
        """Subscribe to the bus and begin capturing events."""
        self._subscription = await self._bus.subscribe(self._event_types, self._handler)

    async def stop(self) -> None:
        """Unsubscribe and stop capturing events."""
        if self._subscription is None:
            return
        await self._subscription.unsubscribe()
        self._subscription = None

    async def __aenter__(self) -> EventCapture:
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.stop()


async def wait_for_event(
    bus: InProcessBus,
    event_type: str,
    timeout: float = DEFAULT_WAIT_TIMEOUT,
) -> SleipnirEvent:
    """Block until an event matching *event_type* arrives on *bus*.

    Subscribes to *bus* for *event_type* (glob patterns are supported),
    then waits up to *timeout* seconds for a matching event to be delivered.

    :param bus: The in-process bus to subscribe to.
    :param event_type: Exact event type or glob pattern to match.
    :param timeout: Maximum seconds to wait before raising.
    :raises asyncio.TimeoutError: If no matching event arrives within *timeout*.
    :returns: The first matching event received.
    """
    received: list[SleipnirEvent] = []
    ready = asyncio.Event()

    async def handler(event: SleipnirEvent) -> None:
        if ready.is_set():
            return
        received.append(event)
        ready.set()

    sub = await bus.subscribe([event_type], handler)
    try:
        await asyncio.wait_for(ready.wait(), timeout=timeout)
    finally:
        await sub.unsubscribe()

    return received[0]
