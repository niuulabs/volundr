"""CachePort — abstract interface for LLM response caching."""

from __future__ import annotations

from abc import ABC, abstractmethod

from bifrost.translation.models import AnthropicResponse


class CachePort(ABC):
    """Abstract interface that every cache adapter must implement."""

    @abstractmethod
    async def get(self, key: str) -> AnthropicResponse | None:
        """Return the cached response for *key*, or ``None`` on a miss.

        Args:
            key: SHA-256 hex digest cache key.

        Returns:
            The cached ``AnthropicResponse``, or ``None`` when absent or expired.
        """

    @abstractmethod
    async def set(self, key: str, response: AnthropicResponse, ttl: int) -> None:
        """Store *response* under *key* with a *ttl*-second time-to-live.

        Args:
            key:      SHA-256 hex digest cache key.
            response: The response to cache.
            ttl:      Time-to-live in seconds.
        """

    async def close(self) -> None:
        """Release any held resources (e.g. Redis connections)."""
