"""PostgreSQL thread adapter — persists RavnThread records to ravn_threads.

Raw SQL with asyncpg — no ORM.

Table schema is in migrations/000032_ravn_threads.up.sql.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from ravn.domain.thread import RavnThread, ThreadStatus
from ravn.ports.thread import ThreadPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DDL (dev / test bootstrap — production uses the migrate tool)
# ---------------------------------------------------------------------------

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ravn_threads (
    thread_id        TEXT PRIMARY KEY,
    page_path        TEXT NOT NULL,
    title            TEXT NOT NULL DEFAULT '',
    weight           DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    next_action      TEXT NOT NULL DEFAULT '',
    tags             JSONB NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'open',
    created_at       TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ravn_threads_page_path
    ON ravn_threads (page_path)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_ravn_threads_weight
    ON ravn_threads (weight DESC)
    WHERE status = 'open';
"""

# ---------------------------------------------------------------------------
# DML
# ---------------------------------------------------------------------------

_UPSERT_SQL = """
INSERT INTO ravn_threads (
    thread_id, page_path, title, weight, next_action,
    tags, status, created_at, last_seen_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (thread_id) DO UPDATE SET
    page_path    = EXCLUDED.page_path,
    title        = EXCLUDED.title,
    weight       = EXCLUDED.weight,
    next_action  = EXCLUDED.next_action,
    tags         = EXCLUDED.tags,
    status       = EXCLUDED.status,
    last_seen_at = EXCLUDED.last_seen_at;
"""

_SELECT_BY_ID_SQL = """
SELECT thread_id, page_path, title, weight, next_action,
       tags, status, created_at, last_seen_at
FROM ravn_threads
WHERE thread_id = $1;
"""

_SELECT_BY_PATH_SQL = """
SELECT thread_id, page_path, title, weight, next_action,
       tags, status, created_at, last_seen_at
FROM ravn_threads
WHERE page_path = $1 AND status = 'open'
LIMIT 1;
"""

_PEEK_QUEUE_SQL = """
SELECT thread_id, page_path, title, weight, next_action,
       tags, status, created_at, last_seen_at
FROM ravn_threads
WHERE status = 'open'
ORDER BY weight DESC
LIMIT $1;
"""

_LIST_OPEN_SQL = """
SELECT thread_id, page_path, title, weight, next_action,
       tags, status, created_at, last_seen_at
FROM ravn_threads
WHERE status = 'open'
ORDER BY created_at DESC
LIMIT $1;
"""

_CLOSE_SQL = """
UPDATE ravn_threads
SET status = 'closed', last_seen_at = $2
WHERE thread_id = $1;
"""

_UPDATE_WEIGHT_SQL = """
UPDATE ravn_threads
SET weight = $2, last_seen_at = $3
WHERE thread_id = $1;
"""


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class PostgresThreadAdapter(ThreadPort):
    """Thread adapter backed by PostgreSQL.

    Parameters
    ----------
    dsn:
        asyncpg-compatible connection string,
        e.g. ``postgresql://user:pass@host/db``.
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

    async def upsert(self, thread: RavnThread) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                _UPSERT_SQL,
                thread.thread_id,
                thread.page_path,
                thread.title,
                thread.weight,
                thread.next_action,
                json.dumps(thread.tags),
                thread.status.value,
                thread.created_at,
                thread.last_seen_at,
            )
        logger.debug("Thread upserted: %s (%s)", thread.thread_id, thread.page_path)

    async def get(self, thread_id: str) -> RavnThread | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(_SELECT_BY_ID_SQL, thread_id)
        if row is None:
            return None
        return _row_to_thread(row)

    async def get_by_path(self, page_path: str) -> RavnThread | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(_SELECT_BY_PATH_SQL, page_path)
        if row is None:
            return None
        return _row_to_thread(row)

    async def peek_queue(self, *, limit: int = 10) -> list[RavnThread]:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(_PEEK_QUEUE_SQL, limit)
        return [_row_to_thread(r) for r in rows]

    async def list_open(self, *, limit: int = 100) -> list[RavnThread]:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(_LIST_OPEN_SQL, limit)
        return [_row_to_thread(r) for r in rows]

    async def close(self, thread_id: str) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(_CLOSE_SQL, thread_id, datetime.now(UTC))
        logger.debug("Thread closed: %s", thread_id)

    async def update_weight(self, thread_id: str, weight: float) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(_UPDATE_WEIGHT_SQL, thread_id, weight, datetime.now(UTC))
        logger.debug("Thread weight updated: %s → %.4f", thread_id, weight)


# ---------------------------------------------------------------------------
# Row deserialisation
# ---------------------------------------------------------------------------


def _parse_ts(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts


def _parse_tags(val: object) -> list[str]:
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        return json.loads(val)
    return []


def _row_to_thread(row: object) -> RavnThread:
    return RavnThread(
        thread_id=row["thread_id"],
        page_path=row["page_path"],
        title=row["title"] or "",
        weight=float(row["weight"]),
        next_action=row["next_action"] or "",
        tags=_parse_tags(row["tags"]),
        status=ThreadStatus(row["status"]),
        created_at=_parse_ts(row["created_at"]),
        last_seen_at=_parse_ts(row["last_seen_at"]),
    )
