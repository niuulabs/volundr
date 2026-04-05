"""In-memory LRU response cache adapter.

Suitable for standalone / Pi-mode deployments where a shared external cache
is not available. Entries expire after their TTL and the cache is bounded to
``max_entries`` to cap memory usage (LRU eviction when the limit is reached).

This implementation is NOT shared across processes or worker instances.
"""

from __future__ import annotations

import time
from collections import OrderedDict

from bifrost.ports.cache import CachePort
from bifrost.translation.models import AnthropicResponse

# Type alias: key → (response, expiry_monotonic_seconds)
_Entry = tuple[AnthropicResponse, float]


class MemoryCache(CachePort):
    """Thread-safe (GIL) in-memory LRU cache backed by ``OrderedDict``."""

    def __init__(self, max_entries: int = 1000) -> None:
        self._max_entries = max_entries
        self._store: OrderedDict[str, _Entry] = OrderedDict()

    async def get(self, key: str) -> AnthropicResponse | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        response, expiry = entry
        if time.monotonic() > expiry:
            del self._store[key]
            return None
        # Move to end (most-recently-used position).
        self._store.move_to_end(key)
        return response

    async def set(self, key: str, response: AnthropicResponse, ttl: int) -> None:
        expiry = time.monotonic() + ttl
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (response, expiry)
        # Evict oldest entries when capacity is exceeded.
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)
