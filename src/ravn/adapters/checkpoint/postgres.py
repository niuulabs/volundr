"""PostgreSQL checkpoint adapter — infra / Kubernetes mode.

Schema (auto-created on first save):

    CREATE TABLE IF NOT EXISTS ravn_checkpoints (
        task_id              TEXT PRIMARY KEY,
        user_input           TEXT NOT NULL DEFAULT '',
        messages             JSONB NOT NULL DEFAULT '[]',
        todos                JSONB NOT NULL DEFAULT '[]',
        budget_consumed      INTEGER NOT NULL DEFAULT 0,
        budget_total         INTEGER NOT NULL DEFAULT 0,
        last_tool_call       JSONB,
        last_tool_result     JSONB,
        partial_response     TEXT NOT NULL DEFAULT '',
        interrupted_by       TEXT,
        created_at           TIMESTAMPTZ NOT NULL
    );

Raw SQL with asyncpg — no ORM.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from ravn.domain.checkpoint import Checkpoint, InterruptReason
from ravn.ports.checkpoint import CheckpointPort

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ravn_checkpoints (
    task_id              TEXT PRIMARY KEY,
    user_input           TEXT NOT NULL DEFAULT '',
    messages             JSONB NOT NULL DEFAULT '[]',
    todos                JSONB NOT NULL DEFAULT '[]',
    budget_consumed      INTEGER NOT NULL DEFAULT 0,
    budget_total         INTEGER NOT NULL DEFAULT 0,
    last_tool_call       JSONB,
    last_tool_result     JSONB,
    partial_response     TEXT NOT NULL DEFAULT '',
    interrupted_by       TEXT,
    created_at           TIMESTAMPTZ NOT NULL
);
"""

_UPSERT_SQL = """
INSERT INTO ravn_checkpoints (
    task_id, user_input, messages, todos,
    budget_consumed, budget_total,
    last_tool_call, last_tool_result,
    partial_response, interrupted_by, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (task_id) DO UPDATE SET
    user_input       = EXCLUDED.user_input,
    messages         = EXCLUDED.messages,
    todos            = EXCLUDED.todos,
    budget_consumed  = EXCLUDED.budget_consumed,
    budget_total     = EXCLUDED.budget_total,
    last_tool_call   = EXCLUDED.last_tool_call,
    last_tool_result = EXCLUDED.last_tool_result,
    partial_response = EXCLUDED.partial_response,
    interrupted_by   = EXCLUDED.interrupted_by,
    created_at       = EXCLUDED.created_at;
"""

_SELECT_SQL = """
SELECT task_id, user_input, messages, todos,
       budget_consumed, budget_total,
       last_tool_call, last_tool_result,
       partial_response, interrupted_by, created_at
FROM ravn_checkpoints
WHERE task_id = $1;
"""

_DELETE_SQL = "DELETE FROM ravn_checkpoints WHERE task_id = $1;"

_LIST_SQL = "SELECT task_id FROM ravn_checkpoints ORDER BY created_at DESC;"


class PostgresCheckpointAdapter(CheckpointPort):
    """Checkpoint adapter backed by PostgreSQL.

    Parameters
    ----------
    dsn:
        asyncpg-compatible DSN string, e.g.
        ``postgresql://user:pass@host/db``.
    """

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: object | None = None

    async def _ensure_pool(self) -> object:
        if self._pool is not None:
            return self._pool
        import asyncpg  # type: ignore[import]

        self._pool = await asyncpg.create_pool(self._dsn)
        async with self._pool.acquire() as conn:
            await conn.execute(_CREATE_TABLE_SQL)
        return self._pool

    async def save(self, checkpoint: Checkpoint) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                _UPSERT_SQL,
                checkpoint.task_id,
                checkpoint.user_input,
                json.dumps(checkpoint.messages),
                json.dumps(checkpoint.todos),
                checkpoint.iteration_budget_consumed,
                checkpoint.iteration_budget_total,
                json.dumps(checkpoint.last_tool_call) if checkpoint.last_tool_call else None,
                json.dumps(checkpoint.last_tool_result) if checkpoint.last_tool_result else None,
                checkpoint.partial_response,
                checkpoint.interrupted_by,
                checkpoint.created_at,
            )
        logger.debug("Checkpoint saved to postgres: %s", checkpoint.task_id)

    async def load(self, task_id: str) -> Checkpoint | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(_SELECT_SQL, task_id)
        if row is None:
            return None
        return _row_to_checkpoint(row)

    async def delete(self, task_id: str) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(_DELETE_SQL, task_id)

    async def list_task_ids(self) -> list[str]:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(_LIST_SQL)
        return [r["task_id"] for r in rows]


def _row_to_checkpoint(row: object) -> Checkpoint:
    interrupted_by_raw = row["interrupted_by"]
    interrupted_by = InterruptReason(interrupted_by_raw) if interrupted_by_raw else None

    def _parse_json(val: str | None) -> object:
        if val is None:
            return None
        if isinstance(val, str):
            return json.loads(val)
        return val  # asyncpg may return already-decoded JSONB

    created_at: datetime = row["created_at"]
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)

    return Checkpoint(
        task_id=row["task_id"],
        user_input=row["user_input"] or "",
        messages=_parse_json(row["messages"]) or [],
        todos=_parse_json(row["todos"]) or [],
        iteration_budget_consumed=row["budget_consumed"],
        iteration_budget_total=row["budget_total"],
        last_tool_call=_parse_json(row["last_tool_call"]),
        last_tool_result=_parse_json(row["last_tool_result"]),
        partial_response=row["partial_response"] or "",
        interrupted_by=interrupted_by,
        created_at=created_at,
    )
