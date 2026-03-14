"""Bifröst port interfaces (hexagonal architecture boundaries)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Awaitable, Callable

from volundr.bifrost.models import SynapseEnvelope


class UpstreamProvider(ABC):
    """Port for forwarding requests to model APIs.

    Implementations handle auth injection, header filtering, and
    format translation (if needed).  The proxy core never knows which
    upstream it is talking to.
    """

    @abstractmethod
    async def forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], bytes]:
        """Non-streaming forward.

        Returns ``(status_code, response_headers, response_body)``.
        """

    @abstractmethod
    async def stream_forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], AsyncIterator[bytes]]:
        """Streaming forward.

        Returns ``(status_code, response_headers, chunk_iterator)``
        where *chunk_iterator* yields raw bytes (SSE events) as they
        arrive from the upstream.
        """

    @abstractmethod
    async def close(self) -> None:
        """Release resources (HTTP client, connection pool)."""


class Synapse(ABC):
    """Port for event transport (publish / subscribe).

    Two adapters planned:
    - **LocalSynapse** (Phase A): in-process asyncio queues
    - **NngSynapse** / **SleipnirSynapse** (Phase D): nng or RabbitMQ

    ``request_reply`` is intentionally absent — it arrives in Phase C
    when Mimir enrichment needs synchronous responses with timeouts.
    """

    @abstractmethod
    async def publish(self, topic: str, message: SynapseEnvelope) -> None:
        """Fire-and-forget publish to *topic*.

        Must never block the caller.  If the transport is unavailable
        or a subscriber handler fails, the error is swallowed.
        """

    @abstractmethod
    async def subscribe(
        self,
        topic: str,
        handler: Callable[[SynapseEnvelope], Awaitable[None]],
    ) -> None:
        """Register *handler* to receive messages on *topic*."""

    @abstractmethod
    async def close(self) -> None:
        """Shut down transport and release resources."""
