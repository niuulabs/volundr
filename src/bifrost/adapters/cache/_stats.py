"""Shared stats-tracking mixin for CachePort adapters.

Both MemoryCache and RedisCache track the same counters (hits, misses,
saved input/output tokens).  This mixin consolidates that logic so there
is a single source of truth.
"""

from __future__ import annotations

from bifrost.ports.cache import CacheStats
from bifrost.translation.models import AnthropicResponse


class CacheStatsMixin:
    """Mixin that adds hit/miss counter tracking and a ``stats()`` implementation.

    Subclasses call ``_record_hit(response)`` on a cache hit and
    ``_record_miss()`` on a miss.  Override ``_cache_entries()`` to report
    the number of currently stored entries (default: 0).
    """

    def __init__(self) -> None:
        self._hits = 0
        self._misses = 0
        self._saved_input_tokens = 0
        self._saved_output_tokens = 0

    def _record_hit(self, response: AnthropicResponse) -> None:
        self._hits += 1
        if response.usage:
            self._saved_input_tokens += response.usage.input_tokens
            self._saved_output_tokens += response.usage.output_tokens

    def _record_miss(self) -> None:
        self._misses += 1

    def _cache_entries(self) -> int:
        return 0

    def stats(self) -> CacheStats:
        return CacheStats(
            hits=self._hits,
            misses=self._misses,
            saved_input_tokens=self._saved_input_tokens,
            saved_output_tokens=self._saved_output_tokens,
            entries=self._cache_entries(),
        )
