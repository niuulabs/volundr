"""SQLite-backed UsageStore adapter.

Uses the standard-library ``sqlite3`` module via ``asyncio``
``run_in_executor`` so no extra dependencies are required.

The schema is created automatically on first use (``CREATE TABLE IF NOT EXISTS``).
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from functools import partial
from typing import Any

from bifrost.ports.usage_store import UsageRecord, UsageStore, UsageSummary

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS usage_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id    TEXT    NOT NULL DEFAULT '',
    agent_id      TEXT    NOT NULL,
    tenant_id     TEXT    NOT NULL,
    session_id    TEXT    NOT NULL DEFAULT '',
    saga_id       TEXT    NOT NULL DEFAULT '',
    model         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0.0,
    timestamp     TEXT    NOT NULL
);
"""

_CREATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_usage_tenant_ts  ON usage_records(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_agent_ts   ON usage_records(agent_id,  timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_model      ON usage_records(model);
"""

_INSERT = """
INSERT INTO usage_records
    (request_id, agent_id, tenant_id, session_id, saga_id,
     model, input_tokens, output_tokens, cost_usd, timestamp)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _ts(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def _row_to_record(row: tuple) -> UsageRecord:
    (
        _id,
        request_id,
        agent_id,
        tenant_id,
        session_id,
        saga_id,
        model,
        input_tokens,
        output_tokens,
        cost_usd,
        timestamp,
    ) = row
    return UsageRecord(
        request_id=request_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        session_id=session_id,
        saga_id=saga_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        timestamp=_parse_ts(timestamp),
    )


class SQLiteUsageStore(UsageStore):
    """Persistent SQLite implementation of ``UsageStore``."""

    def __init__(self, path: str = ":memory:") -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def _open(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(_CREATE_TABLE + _CREATE_INDEXES)
        conn.commit()
        return conn

    async def _get_conn(self) -> sqlite3.Connection:
        async with self._lock:
            if self._conn is None:
                loop = asyncio.get_event_loop()
                self._conn = await loop.run_in_executor(None, self._open)
        return self._conn

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _run(self, fn: Callable[..., Any], *args: Any) -> Any:
        conn = await self._get_conn()
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(fn, conn, *args))

    @staticmethod
    def _do_insert(conn: sqlite3.Connection, record: UsageRecord) -> None:
        conn.execute(
            _INSERT,
            (
                record.request_id,
                record.agent_id,
                record.tenant_id,
                record.session_id,
                record.saga_id,
                record.model,
                record.input_tokens,
                record.output_tokens,
                record.cost_usd,
                _ts(record.timestamp),
            ),
        )
        conn.commit()

    @staticmethod
    def _do_query(
        conn: sqlite3.Connection,
        agent_id: str | None,
        tenant_id: str | None,
        model: str | None,
        since: datetime | None,
        until: datetime | None,
        limit: int,
    ) -> list[tuple]:
        clauses = []
        params: list[Any] = []
        if agent_id is not None:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if tenant_id is not None:
            clauses.append("tenant_id = ?")
            params.append(tenant_id)
        if model is not None:
            clauses.append("model = ?")
            params.append(model)
        if since is not None:
            clauses.append("timestamp >= ?")
            params.append(_ts(since))
        if until is not None:
            clauses.append("timestamp <= ?")
            params.append(_ts(until))
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = f"""
            SELECT id, request_id, agent_id, tenant_id, session_id, saga_id,
                   model, input_tokens, output_tokens, cost_usd, timestamp
            FROM usage_records {where}
            ORDER BY timestamp DESC
            LIMIT ?
        """
        params.append(limit)
        cur = conn.execute(sql, params)
        return cur.fetchall()

    # ------------------------------------------------------------------
    # Port implementation
    # ------------------------------------------------------------------

    async def record(self, usage: UsageRecord) -> None:
        await self._run(self._do_insert, usage)

    async def query(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 1000,
    ) -> list[UsageRecord]:
        rows = await self._run(self._do_query, agent_id, tenant_id, model, since, until, limit)
        return [_row_to_record(r) for r in rows]

    async def summarise(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> UsageSummary:
        records = await self.query(
            agent_id=agent_id,
            tenant_id=tenant_id,
            model=model,
            since=since,
            until=until,
            limit=1_000_000,
        )
        summary = UsageSummary()
        summary.total_requests = len(records)
        for r in records:
            summary.total_input_tokens += r.input_tokens
            summary.total_output_tokens += r.output_tokens
            summary.total_cost_usd += r.cost_usd
            entry = summary.by_model.setdefault(
                r.model,
                {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            )
            entry["requests"] += 1
            entry["input_tokens"] += r.input_tokens
            entry["output_tokens"] += r.output_tokens
            entry["cost_usd"] += r.cost_usd
        return summary

    async def tokens_today(self, tenant_id: str) -> int:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        records = await self.query(tenant_id=tenant_id, since=since, limit=1_000_000)
        return sum(r.input_tokens + r.output_tokens for r in records)

    async def cost_today(self, tenant_id: str) -> float:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        records = await self.query(tenant_id=tenant_id, since=since, limit=1_000_000)
        return sum(r.cost_usd for r in records)

    async def requests_this_hour(self, tenant_id: str) -> int:
        since = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        records = await self.query(tenant_id=tenant_id, since=since, limit=1_000_000)
        return len(records)

    async def agent_cost_today(self, agent_id: str) -> float:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        records = await self.query(agent_id=agent_id, since=since, limit=1_000_000)
        return sum(r.cost_usd for r in records)
