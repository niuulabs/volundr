"""CompositeChannel — broadcasts a RavnEvent to multiple channels (NIU-438)."""

from __future__ import annotations

from ravn.domain.events import RavnEvent
from ravn.ports.channel import ChannelPort


class CompositeChannel(ChannelPort):
    """Broadcast a single RavnEvent to every channel in *channels*.

    Each channel's ``emit()`` is awaited in sequence.  If one channel raises,
    the exception is not propagated — the remaining channels still receive the
    event and the error is silently swallowed (each channel is responsible for
    its own resilience).

    Parameters
    ----------
    channels:
        Ordered list of :class:`~ravn.ports.channel.ChannelPort` instances.
        At least one channel should be provided; an empty list is valid but
        results in events being silently discarded.
    """

    def __init__(self, channels: list[ChannelPort]) -> None:
        self._channels = list(channels)

    async def emit(self, event: RavnEvent) -> None:
        for channel in self._channels:
            try:
                await channel.emit(event)
            except Exception:
                pass  # each channel is responsible for its own resilience
