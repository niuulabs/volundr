"""PostgreSQL implementation of SagaRepository."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import asyncpg

from tyr.domain.models import Saga, SagaStatus
from tyr.ports.saga_repository import SagaRepository


class PostgresSagaRepository(SagaRepository):
    """Saga reference persistence backed by asyncpg."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def save_saga(self, saga: Saga) -> None:
        await self._pool.execute(
            """
            INSERT INTO sagas (id, tracker_id, tracker_type, slug, name, repos, feature_branch, status, confidence, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
            """,
            saga.id,
            saga.tracker_id,
            saga.tracker_type,
            saga.slug,
            saga.name,
            saga.repos,
            saga.feature_branch,
            saga.status.value,
            saga.confidence,
            saga.created_at,
        )

    async def list_sagas(self) -> list[Saga]:
        rows = await self._pool.fetch(
            "SELECT * FROM sagas ORDER BY created_at DESC"
        )
        return [self._row_to_saga(r) for r in rows]

    async def get_saga(self, saga_id: UUID) -> Saga | None:
        row = await self._pool.fetchrow(
            "SELECT * FROM sagas WHERE id = $1", saga_id
        )
        if row is None:
            return None
        return self._row_to_saga(row)

    async def delete_saga(self, saga_id: UUID) -> bool:
        result = await self._pool.execute(
            "DELETE FROM sagas WHERE id = $1", saga_id
        )
        return result == "DELETE 1"

    @staticmethod
    def _row_to_saga(row: asyncpg.Record) -> Saga:
        return Saga(
            id=row["id"],
            tracker_id=row["tracker_id"],
            tracker_type=row["tracker_type"],
            slug=row["slug"],
            name=row["name"],
            repos=list(row["repos"]),
            status=SagaStatus(row.get("status", "ACTIVE") or "ACTIVE"),
            confidence=row["confidence"] or 0.0,
            created_at=row["created_at"] or datetime.now(UTC),
        )
