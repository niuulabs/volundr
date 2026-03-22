"""Shared domain models for Niuu modules."""

from __future__ import annotations

import time

LINEAR_API_URL = "https://api.linear.app/graphql"


class CacheEntry:
    """Simple TTL cache entry."""

    __slots__ = ("value", "expires_at")

    def __init__(self, value: object, ttl: float) -> None:
        self.value = value
        self.expires_at = time.monotonic() + ttl

    @property
    def expired(self) -> bool:
        return time.monotonic() >= self.expires_at
