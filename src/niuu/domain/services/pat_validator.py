"""PAT revocation validator with in-memory TTL cache.

Validates that a PAT JWT has not been revoked by checking its hash
against the database, with a configurable cache to bound the revocation
window (default: 5 minutes).

Non-PAT tokens (those without ``type: "pat"`` in the payload) are
passed through without validation.
"""

from __future__ import annotations

import hashlib
import logging
import time

import jwt

from niuu.ports.pat_repository import PATRepository

logger = logging.getLogger(__name__)

# Default cache TTL in seconds — the maximum delay between revocation and
# enforcement.  Configurable via ``revocation_cache_ttl_seconds``.
_DEFAULT_CACHE_TTL = 300.0  # 5 minutes


class PATValidator:
    """Validates PAT JWTs against the revocation store.

    On each call to ``is_valid()``:
    1. Decode the JWT (without signature verification — Envoy handles that).
    2. If ``type`` != ``"pat"``, return True immediately (not a PAT).
    3. SHA-256-hash the raw JWT.
    4. Check the in-memory cache; return the cached result if still fresh.
    5. Otherwise query ``PATRepository.exists_by_hash()`` and cache the result.

    The cache has two tiers:
    - **Valid tokens** are cached for ``cache_ttl`` seconds.  A revocation
      won't take effect until the cache entry expires.
    - **Revoked tokens** are cached for a shorter window (60 s) so that
      accidental revocations can be recovered from quickly.
    """

    def __init__(
        self,
        repo: PATRepository,
        signing_key: str,
        cache_ttl: float = _DEFAULT_CACHE_TTL,
    ) -> None:
        self._repo = repo
        self._signing_key = signing_key
        self._cache_ttl = cache_ttl
        # hash → (is_valid, expires_at_monotonic)
        self._cache: dict[str, tuple[bool, float]] = {}

    async def is_valid(self, raw_token: str) -> bool:
        """Return True if the token is a valid, non-revoked PAT (or not a PAT at all)."""
        # Decode without verification — Envoy validates the signature.
        try:
            payload = jwt.decode(
                raw_token,
                self._signing_key,
                algorithms=["HS256"],
                options={"verify_exp": False},
            )
        except jwt.InvalidTokenError:
            # Not a valid JWT at all — let the caller decide how to handle.
            return True

        if payload.get("type") != "pat":
            return True

        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        # Check cache first.
        cached = self._cache.get(token_hash)
        if cached is not None:
            is_valid, expires_at = cached
            if time.monotonic() < expires_at:
                return is_valid

        # Cache miss or expired — query the database.
        exists = await self._repo.exists_by_hash(token_hash)
        ttl = self._cache_ttl if exists else 60.0
        self._cache[token_hash] = (exists, time.monotonic() + ttl)

        if not exists:
            jti, sub = payload.get("jti"), payload.get("sub")
            logger.warning("Revoked PAT used: jti=%s sub=%s", jti, sub)

        return exists

    def invalidate(self, raw_token: str) -> None:
        """Immediately remove a token from the cache (called on revoke)."""
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        self._cache.pop(token_hash, None)

    def clear_cache(self) -> None:
        """Clear the entire cache (useful for testing)."""
        self._cache.clear()
