"""PostgreSQL implementation of SagaRepository."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import asyncpg

from tyr.domain.models import Phase, Raid, Saga, SagaStatus
from tyr.ports.saga_repository import SagaRepository


class PostgresSagaRepository(SagaRepository):
    """Saga reference persistence backed by asyncpg."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @asynccontextmanager
    async def begin(self) -> AsyncIterator[asyncpg.Connection]:
        """Acquire a connection and start a transaction."""
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                yield conn

    async def save_phase(self, phase: Phase, *, conn: Any | None = None) -> None:
        executor = conn or self._pool
        await executor.execute(
            """
            INSERT INTO phases (id, saga_id, tracker_id, number, name, status, confidence)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
            """,
            phase.id,
            phase.saga_id,
            phase.tracker_id,
            phase.number,
            phase.name,
            phase.status.value,
            phase.confidence,
        )

    async def save_raid(self, raid: Raid, *, conn: Any | None = None) -> None:
        executor = conn or self._pool
        await executor.execute(
            """
            INSERT INTO raids
                (id, phase_id, tracker_id, name, description, acceptance_criteria,
                 declared_files, estimate_hours, status, confidence, session_id,
                 branch, chronicle_summary, retry_count, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (id) DO NOTHING
            """,
            raid.id,
            raid.phase_id,
            raid.tracker_id,
            raid.name,
            raid.description,
            raid.acceptance_criteria,
            raid.declared_files,
            raid.estimate_hours,
            raid.status.value,
            raid.confidence,
            raid.session_id,
            raid.branch,
            raid.chronicle_summary,
            raid.retry_count,
            raid.created_at,
            raid.updated_at,
        )

    async def save_saga(self, saga: Saga, *, conn: Any | None = None) -> None:
        executor = conn or self._pool
        await executor.execute(
            """
            INSERT INTO sagas
                (id, tracker_id, tracker_type, slug, name,
                 repos, feature_branch, base_branch, status, confidence, created_at, owner_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING
            """,
            saga.id,
            saga.tracker_id,
            saga.tracker_type,
            saga.slug,
            saga.name,
            saga.repos,
            saga.feature_branch,
            saga.base_branch,
            saga.status.value,
            saga.confidence,
            saga.created_at,
            saga.owner_id,
        )

    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        if owner_id is not None:
            rows = await self._pool.fetch(
                "SELECT * FROM sagas WHERE owner_id = $1 ORDER BY created_at DESC",
                owner_id,
            )
        else:
            rows = await self._pool.fetch(
                "SELECT * FROM sagas ORDER BY created_at DESC",
            )
        return [self._row_to_saga(r) for r in rows]

    async def get_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> Saga | None:
        if owner_id is not None:
            row = await self._pool.fetchrow(
                "SELECT * FROM sagas WHERE id = $1 AND owner_id = $2",
                saga_id,
                owner_id,
            )
        else:
            row = await self._pool.fetchrow(
                "SELECT * FROM sagas WHERE id = $1",
                saga_id,
            )
        if row is None:
            return None
        return self._row_to_saga(row)

    async def get_saga_by_slug(self, slug: str) -> Saga | None:
        row = await self._pool.fetchrow(
            "SELECT * FROM sagas WHERE slug = $1",
            slug,
        )
        if row is None:
            return None
        return self._row_to_saga(row)

    async def delete_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> bool:
        if owner_id is not None:
            result = await self._pool.execute(
                "DELETE FROM sagas WHERE id = $1 AND owner_id = $2",
                saga_id,
                owner_id,
            )
        else:
            result = await self._pool.execute(
                "DELETE FROM sagas WHERE id = $1",
                saga_id,
            )
        return result == "DELETE 1"

    @staticmethod
    def _row_to_saga(row: asyncpg.Record) -> Saga:
        slug = row["slug"]
        return Saga(
            id=row["id"],
            tracker_id=row["tracker_id"],
            tracker_type=row["tracker_type"],
            slug=slug,
            name=row["name"],
            repos=list(row["repos"]),
            feature_branch=row.get("feature_branch") or f"feat/{slug}",
            base_branch=row.get("base_branch") or "main",
            status=SagaStatus(row.get("status", "ACTIVE") or "ACTIVE"),
            confidence=row["confidence"] or 0.0,
            created_at=row["created_at"] or datetime.now(UTC),
            owner_id=row.get("owner_id") or "",
        )
