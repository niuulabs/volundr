"""Domain service for personal access token lifecycle management."""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt

from tyr.domain.models import PersonalAccessToken
from tyr.ports.pat_repository import PATRepository

logger = logging.getLogger(__name__)


class PATService:
    """Service for creating, listing, and revoking personal access tokens.

    PATs are long-lived JWTs signed with the OIDC signing key so Envoy
    can validate them with zero infrastructure changes.
    """

    def __init__(
        self,
        repo: PATRepository,
        signing_key: str,
        ttl_days: int = 365,
    ) -> None:
        self._repo = repo
        self._signing_key = signing_key
        self._ttl_days = ttl_days

    async def create(self, owner_id: str, name: str) -> tuple[PersonalAccessToken, str]:
        """Create a new PAT. Returns (metadata, raw_jwt). raw_jwt shown once only."""
        now = datetime.now(UTC)
        jti = str(uuid4())
        payload = {
            "sub": owner_id,
            "type": "pat",
            "jti": jti,
            "name": name,
            "iat": now,
            "exp": now + timedelta(days=self._ttl_days),
        }
        raw_jwt = jwt.encode(payload, self._signing_key, algorithm="HS256")
        token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()

        pat = await self._repo.create(owner_id, name, token_hash)
        logger.info("PAT created: id=%s owner=%s name=%s", pat.id, owner_id, name)
        return pat, raw_jwt

    async def list(self, owner_id: str) -> list[PersonalAccessToken]:
        """List all PATs for an owner."""
        return await self._repo.list(owner_id)

    async def revoke(self, pat_id: UUID, owner_id: str) -> bool:
        """Revoke (delete) a PAT. Returns True if found and deleted."""
        deleted = await self._repo.delete(pat_id, owner_id)
        if deleted:
            logger.info("PAT revoked: id=%s owner=%s", pat_id, owner_id)
        return deleted
