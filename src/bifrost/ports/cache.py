"""CachePort — abstract interface for LLM response caching."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from bifrost.translation.models import AnthropicResponse


@dataclass
class CacheStats:
    """Aggregate statistics for a cache adapter instance."""

    hits: int = 0
    """Total number of cache hits (responses served from cache)."""

    misses: int = 0
    """Total number of cache misses (requests forwarded to provider)."""

    saved_input_tokens: int = 0
    """Cumulative input tokens saved by serving cached responses."""

    saved_output_tokens: int = 0
    """Cumulative output tokens saved by serving cached responses."""

    entries: int = field(default=0)
    """Current number of entries in the cache (where applicable)."""

    @property
    def hit_rate(self) -> float:
        """Hit rate as a fraction in [0.0, 1.0]. Returns 0.0 when no requests."""
        total = self.hits + self.misses
        if total == 0:
            return 0.0
        return self.hits / total

    @property
    def saved_tokens(self) -> int:
        """Total tokens saved (input + output)."""
        return self.saved_input_tokens + self.saved_output_tokens


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

    def stats(self) -> CacheStats:
        """Return aggregate statistics for this cache instance.

        The default implementation returns zeroed stats.  Adapters that
        track hits and misses should override this method.
        """
        return CacheStats()

    async def close(self) -> None:
        """Release any held resources (e.g. Redis connections)."""
