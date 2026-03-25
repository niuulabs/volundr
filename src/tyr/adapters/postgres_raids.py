"""PostgreSQL implementation of RaidRepository."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import asyncpg

from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.ports.raid_repository import RaidRepository


class PostgresRaidRepository(RaidRepository):
    """Raid persistence backed by asyncpg."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get_raid(self, raid_id: UUID) -> Raid | None:
        row = await self._pool.fetchrow("SELECT * FROM raids WHERE id = $1", raid_id)
        if row is None:
            return None
        return self._row_to_raid(row)

    async def update_raid_status(
        self,
        raid_id: UUID,
        status: RaidStatus,
        *,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        now = datetime.now(UTC)
        if increment_retry:
            row = await self._pool.fetchrow(
                """
                UPDATE raids
                SET status = $2, reason = $3, retry_count = retry_count + 1, updated_at = $4
                WHERE id = $1
                RETURNING *
                """,
                raid_id,
                status.value,
                reason,
                now,
            )
        else:
            row = await self._pool.fetchrow(
                """
                UPDATE raids
                SET status = $2, reason = $3, updated_at = $4
                WHERE id = $1
                RETURNING *
                """,
                raid_id,
                status.value,
                reason,
                now,
            )
        if row is None:
            return None
        return self._row_to_raid(row)

    async def get_confidence_events(self, raid_id: UUID) -> list[ConfidenceEvent]:
        rows = await self._pool.fetch(
            "SELECT * FROM confidence_events WHERE raid_id = $1 ORDER BY created_at",
            raid_id,
        )
        return [self._row_to_event(r) for r in rows]

    async def add_confidence_event(self, event: ConfidenceEvent) -> None:
        await self._pool.execute(
            """
            INSERT INTO confidence_events (id, raid_id, event_type, delta, score_after, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            event.id,
            event.raid_id,
            event.event_type.value,
            event.delta,
            event.score_after,
            event.created_at,
        )
        await self._pool.execute(
            "UPDATE raids SET confidence = $2, updated_at = $3 WHERE id = $1",
            event.raid_id,
            event.score_after,
            event.created_at,
        )

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        row = await self._pool.fetchrow(
            """
            SELECT s.* FROM sagas s
            JOIN phases p ON p.saga_id = s.id
            JOIN raids r ON r.phase_id = p.id
            WHERE r.id = $1
            """,
            raid_id,
        )
        if row is None:
            return None
        return self._row_to_saga(row)

    async def get_phase_for_raid(self, raid_id: UUID) -> Phase | None:
        row = await self._pool.fetchrow(
            """
            SELECT p.* FROM phases p
            JOIN raids r ON r.phase_id = p.id
            WHERE r.id = $1
            """,
            raid_id,
        )
        if row is None:
            return None
        return self._row_to_phase(row)

    async def list_by_status(self, status: RaidStatus) -> list[Raid]:
        rows = await self._pool.fetch(
            "SELECT * FROM raids WHERE status = $1 ORDER BY updated_at",
            status.value,
        )
        return [self._row_to_raid(r) for r in rows]

    async def update_raid_completion(
        self,
        raid_id: UUID,
        *,
        status: RaidStatus,
        chronicle_summary: str | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        now = datetime.now(UTC)
        retry_expr = "retry_count + 1" if increment_retry else "retry_count"
        row = await self._pool.fetchrow(
            f"""
            UPDATE raids
            SET status = $2,
                chronicle_summary = COALESCE($3, chronicle_summary),
                pr_url = COALESCE($4, pr_url),
                pr_id = COALESCE($5, pr_id),
                reason = COALESCE($6, reason),
                retry_count = {retry_expr},
                updated_at = $7
            WHERE id = $1
            RETURNING *
            """,  # noqa: S608
            raid_id,
            status.value,
            chronicle_summary,
            pr_url,
            pr_id,
            reason,
            now,
        )
        if row is None:
            return None
        return self._row_to_raid(row)

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        row = await self._pool.fetchrow(
            """
            SELECT count(*) FILTER (WHERE status != 'MERGED') AS remaining
            FROM raids WHERE phase_id = $1
            """,
            phase_id,
        )
        return row is not None and row["remaining"] == 0

    # -- Row mappers --

    @staticmethod
    def _row_to_raid(row: asyncpg.Record) -> Raid:
        return Raid(
            id=row["id"],
            phase_id=row["phase_id"],
            tracker_id=row["tracker_id"],
            name=row["name"],
            description=row.get("description", "") or "",
            acceptance_criteria=list(row.get("acceptance_criteria") or []),
            declared_files=list(row.get("declared_files") or []),
            estimate_hours=row.get("estimate_hours"),
            status=RaidStatus(row["status"]),
            confidence=row.get("confidence", 0.0) or 0.0,
            session_id=row.get("session_id"),
            branch=row.get("branch"),
            chronicle_summary=row.get("chronicle_summary"),
            pr_url=row.get("pr_url"),
            pr_id=row.get("pr_id"),
            retry_count=row.get("retry_count", 0) or 0,
            created_at=row["created_at"] or datetime.now(UTC),
            updated_at=row["updated_at"] or datetime.now(UTC),
        )

    @staticmethod
    def _row_to_event(row: asyncpg.Record) -> ConfidenceEvent:
        return ConfidenceEvent(
            id=row["id"],
            raid_id=row["raid_id"],
            event_type=ConfidenceEventType(row["event_type"]),
            delta=row["delta"],
            score_after=row["score_after"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_saga(row: asyncpg.Record) -> Saga:
        return Saga(
            id=row["id"],
            tracker_id=row["tracker_id"],
            tracker_type=row["tracker_type"],
            slug=row["slug"],
            name=row["name"],
            repos=list(row.get("repos") or []),
            feature_branch=row.get("feature_branch", "") or "",
            status=SagaStatus(row.get("status", "ACTIVE") or "ACTIVE"),
            confidence=row.get("confidence", 0.0) or 0.0,
            created_at=row.get("created_at") or datetime.now(UTC),
            owner_id=row.get("owner_id", "") or "",
        )

    @staticmethod
    def _row_to_phase(row: asyncpg.Record) -> Phase:
        return Phase(
            id=row["id"],
            saga_id=row["saga_id"],
            tracker_id=row["tracker_id"],
            number=row["number"],
            name=row["name"],
            status=PhaseStatus(row.get("status", "PENDING") or "PENDING"),
            confidence=row.get("confidence", 0.0) or 0.0,
        )
