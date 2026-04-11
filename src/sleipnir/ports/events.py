"""Port interfaces for the Sleipnir event bus."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

from sleipnir.domain.events import SleipnirEvent

#: Type alias for an async event handler.
EventHandler = Callable[[SleipnirEvent], Awaitable[None]]


class Subscription(ABC):
    """Represents an active event subscription.

    Callers must call :meth:`unsubscribe` when they no longer wish to receive
    events, to release resources held by the transport.
    """

    @abstractmethod
    async def unsubscribe(self) -> None:
        """Cancel this subscription and release its resources."""


class SleipnirPublisher(ABC):
    """Port for publishing events onto the Sleipnir event bus."""

    @abstractmethod
    async def publish(self, event: SleipnirEvent) -> None:
        """Publish a single event.

        :param event: The event to publish.
        """

    @abstractmethod
    async def publish_batch(self, events: list[SleipnirEvent]) -> None:
        """Publish multiple events atomically (best-effort ordering).

        :param events: Events to publish; delivered in iteration order.
        """


class SleipnirSubscriber(ABC):
    """Port for subscribing to events on the Sleipnir event bus."""

    @abstractmethod
    async def subscribe(
        self,
        event_types: list[str],
        handler: EventHandler,
    ) -> Subscription:
        """Register *handler* for events matching any pattern in *event_types*.

        Pattern syntax follows shell-style wildcards (``fnmatch``):

        - ``"ravn.*"`` — all Ravn events
        - ``"ravn.tool.*"`` — all Ravn tool events
        - ``"*"`` — all events

        :param event_types: One or more patterns to subscribe to.
        :param handler: Async callable invoked for each matching event.
        :returns: A :class:`Subscription` handle; call ``unsubscribe()`` to cancel.
        """
