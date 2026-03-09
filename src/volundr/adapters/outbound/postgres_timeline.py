"""PostgreSQL adapter for timeline event repository."""

from __future__ import annotations

from datetime import UTC
from uuid import UUID

import asyncpg

from volundr.domain.models import TimelineEvent, TimelineEventType
from volundr.domain.ports import TimelineRepository


class PostgresTimelineRepository(TimelineRepository):
    """PostgreSQL implementation of TimelineRepository using raw SQL."""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def add_event(self, event: TimelineEvent) -> TimelineEvent:
        """Persist a new timeline event."""
        await self._pool.execute(
            """
            INSERT INTO chronicle_events
                (id, chronicle_id, session_id, t, type, label,
                 tokens, action, ins, del, hash, exit_code, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            """,
            event.id,
            event.chronicle_id,
            event.session_id,
            event.t,
            event.type.value,
            event.label,
            event.tokens,
            event.action,
            event.ins,
            event.del_,
            event.hash,
            event.exit_code,
            event.created_at,
        )
        return event

    async def get_events(self, chronicle_id: UUID) -> list[TimelineEvent]:
        """Retrieve all timeline events for a chronicle, ordered by t."""
        rows = await self._pool.fetch(
            "SELECT * FROM chronicle_events WHERE chronicle_id = $1 ORDER BY t ASC",
            chronicle_id,
        )
        return [self._row_to_event(row) for row in rows]

    async def get_events_by_session(self, session_id: UUID) -> list[TimelineEvent]:
        """Retrieve all timeline events for a session, ordered by t."""
        rows = await self._pool.fetch(
            "SELECT * FROM chronicle_events WHERE session_id = $1 ORDER BY t ASC",
            session_id,
        )
        return [self._row_to_event(row) for row in rows]

    async def delete_by_chronicle(self, chronicle_id: UUID) -> int:
        """Delete all timeline events for a chronicle."""
        result = await self._pool.execute(
            "DELETE FROM chronicle_events WHERE chronicle_id = $1",
            chronicle_id,
        )
        # result is like "DELETE N"
        return int(result.split()[-1])

    def _row_to_event(self, row: asyncpg.Record) -> TimelineEvent:
        """Convert a database row to a TimelineEvent domain model."""
        created_at = row["created_at"]
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)

        return TimelineEvent(
            id=row["id"],
            chronicle_id=row["chronicle_id"],
            session_id=row["session_id"],
            t=row["t"],
            type=TimelineEventType(row["type"]),
            label=row["label"],
            tokens=row["tokens"],
            action=row["action"],
            ins=row["ins"],
            del_=row["del"],
            hash=row["hash"],
            exit_code=row["exit_code"],
            created_at=created_at,
        )
