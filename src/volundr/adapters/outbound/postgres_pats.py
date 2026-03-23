"""PostgreSQL adapter for personal access token repository."""

from __future__ import annotations

from uuid import UUID

import asyncpg

from volundr.domain.models import PersonalAccessToken
from volundr.domain.ports import PATRepository


class PostgresPATRepository(PATRepository):
    """PostgreSQL implementation of PATRepository using raw SQL."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create(self, owner_id: str, name: str, token_hash: str) -> PersonalAccessToken:
        """Persist a new PAT record."""
        row = await self._pool.fetchrow(
            """
            INSERT INTO personal_access_tokens (owner_id, name, token_hash)
            VALUES ($1, $2, $3)
            RETURNING id, owner_id, name, created_at, last_used_at
            """,
            owner_id,
            name,
            token_hash,
        )
        return self._row_to_pat(row)

    async def list(self, owner_id: str) -> list[PersonalAccessToken]:
        """List all PATs for an owner."""
        rows = await self._pool.fetch(
            """
            SELECT id, owner_id, name, created_at, last_used_at
            FROM personal_access_tokens
            WHERE owner_id = $1
            ORDER BY created_at DESC
            """,
            owner_id,
        )
        return [self._row_to_pat(row) for row in rows]

    async def get(self, pat_id: UUID, owner_id: str) -> PersonalAccessToken | None:
        """Retrieve a PAT by ID scoped to an owner."""
        row = await self._pool.fetchrow(
            """
            SELECT id, owner_id, name, created_at, last_used_at
            FROM personal_access_tokens
            WHERE id = $1 AND owner_id = $2
            """,
            pat_id,
            owner_id,
        )
        if row is None:
            return None
        return self._row_to_pat(row)

    async def delete(self, pat_id: UUID, owner_id: str) -> bool:
        """Delete a PAT. Returns True if deleted."""
        result = await self._pool.execute(
            "DELETE FROM personal_access_tokens WHERE id = $1 AND owner_id = $2",
            pat_id,
            owner_id,
        )
        return result == "DELETE 1"

    @staticmethod
    def _row_to_pat(row: asyncpg.Record) -> PersonalAccessToken:
        """Convert a database row to a PersonalAccessToken domain model."""
        return PersonalAccessToken(
            id=row["id"],
            owner_id=row["owner_id"],
            name=row["name"],
            created_at=row["created_at"],
            last_used_at=row["last_used_at"],
        )
