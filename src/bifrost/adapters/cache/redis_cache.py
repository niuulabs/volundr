"""Redis-backed response cache adapter.

Requires the ``redis`` package (``pip install 'redis>=5.0'``).  Suitable for
infra-mode deployments where multiple Bifröst instances share a cache and
persistence across restarts is desirable.

Responses are stored as JSON under their SHA-256 cache key with a per-entry TTL.
"""

from __future__ import annotations

import logging

from bifrost.ports.cache import CachePort, CacheStats
from bifrost.translation.models import AnthropicResponse

logger = logging.getLogger(__name__)


class RedisCache(CachePort):
    """Redis-backed cache using ``redis.asyncio``."""

    def __init__(self, redis_url: str = "redis://localhost:6379") -> None:
        try:
            import redis.asyncio as aioredis
        except ImportError as exc:
            raise ImportError(
                "The redis package is required for Redis cache mode. "
                "Install it with: pip install 'redis>=5.0'"
            ) from exc
        self._client = aioredis.from_url(redis_url, decode_responses=True)
        self._hits = 0
        self._misses = 0
        self._saved_input_tokens = 0
        self._saved_output_tokens = 0

    async def get(self, key: str) -> AnthropicResponse | None:
        try:
            data = await self._client.get(key)
        except Exception:
            logger.warning("Redis GET failed for key %s", key, exc_info=True)
            self._misses += 1
            return None
        if data is None:
            self._misses += 1
            return None
        response = AnthropicResponse.model_validate_json(data)
        self._hits += 1
        if response.usage:
            self._saved_input_tokens += response.usage.input_tokens
            self._saved_output_tokens += response.usage.output_tokens
        return response

    async def set(self, key: str, response: AnthropicResponse, ttl: int) -> None:
        try:
            await self._client.setex(key, ttl, response.model_dump_json())
        except Exception:
            logger.warning("Redis SETEX failed for key %s", key, exc_info=True)

    def stats(self) -> CacheStats:
        return CacheStats(
            hits=self._hits,
            misses=self._misses,
            saved_input_tokens=self._saved_input_tokens,
            saved_output_tokens=self._saved_output_tokens,
        )

    async def close(self) -> None:
        await self._client.aclose()
