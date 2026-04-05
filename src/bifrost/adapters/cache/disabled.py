"""Disabled (no-op) cache adapter.

Used when ``cache.mode`` is ``disabled`` (the default). All lookups miss and
all writes are silently dropped, so the system behaves as if no cache exists.
"""

from __future__ import annotations

from bifrost.ports.cache import CachePort
from bifrost.translation.models import AnthropicResponse


class DisabledCache(CachePort):
    """No-op cache — always misses, never stores."""

    async def get(self, key: str) -> AnthropicResponse | None:
        return None

    async def set(self, key: str, response: AnthropicResponse, ttl: int) -> None:
        pass
