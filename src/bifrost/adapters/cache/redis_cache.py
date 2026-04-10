"""Redis-backed response cache adapter.

Requires the ``redis`` package (``pip install 'redis>=5.0'``).  Suitable for
infra-mode deployments where multiple Bifröst instances share a cache and
persistence across restarts is desirable.

Responses are stored as JSON under their SHA-256 cache key with a per-entry TTL.
"""

from __future__ import annotations

import logging

from bifrost.adapters.cache._stats import CacheStatsMixin
from bifrost.ports.cache import CachePort
from bifrost.translation.models import AnthropicResponse

logger = logging.getLogger(__name__)


class RedisCache(CacheStatsMixin, CachePort):
    """Redis-backed cache using ``redis.asyncio``."""

    def __init__(self, redis_url: str = "redis://localhost:6379") -> None:
        super().__init__()
        try:
            import redis.asyncio as aioredis
        except ImportError as exc:
            raise ImportError(
                "The redis package is required for Redis cache mode. "
                "Install it with: pip install 'redis>=5.0'"
            ) from exc
        self._client = aioredis.from_url(redis_url, decode_responses=True)

    async def get(self, key: str) -> AnthropicResponse | None:
        try:
            data = await self._client.get(key)
        except Exception:
            logger.warning("Redis GET failed for key %s", key, exc_info=True)
            self._record_miss()
            return None
        if data is None:
            self._record_miss()
            return None
        response = AnthropicResponse.model_validate_json(data)
        self._record_hit(response)
        return response

    async def set(self, key: str, response: AnthropicResponse, ttl: int) -> None:
        try:
            await self._client.setex(key, ttl, response.model_dump_json())
        except Exception:
            logger.warning("Redis SETEX failed for key %s", key, exc_info=True)

    async def close(self) -> None:
        await self._client.aclose()
