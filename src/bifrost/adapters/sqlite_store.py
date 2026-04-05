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
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


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
                loop = asyncio.get_running_loop()
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
        loop = asyncio.get_running_loop()
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

    @staticmethod
    def _do_summarise(
        conn: sqlite3.Connection,
        agent_id: str | None,
        tenant_id: str | None,
        model: str | None,
        since: datetime | None,
        until: datetime | None,
    ) -> tuple[int, int, int, float, list[tuple]]:
        """Run SQL aggregation for summarise() — no Python-level looping."""
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

        totals_row = conn.execute(
            f"SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) "
            f"FROM usage_records {where}",
            params,
        ).fetchone()

        model_rows = conn.execute(
            f"SELECT model, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) "
            f"FROM usage_records {where} GROUP BY model",
            params,
        ).fetchall()

        return (
            totals_row[0] or 0,
            totals_row[1] or 0,
            totals_row[2] or 0,
            totals_row[3] or 0.0,
            model_rows,
        )

    @staticmethod
    def _do_tokens_today(conn: sqlite3.Connection, tenant_id: str, since: str) -> int:
        row = conn.execute(
            "SELECT SUM(input_tokens + output_tokens) FROM usage_records "
            "WHERE tenant_id = ? AND timestamp >= ?",
            (tenant_id, since),
        ).fetchone()
        return row[0] or 0

    @staticmethod
    def _do_cost_today(conn: sqlite3.Connection, tenant_id: str, since: str) -> float:
        row = conn.execute(
            "SELECT SUM(cost_usd) FROM usage_records WHERE tenant_id = ? AND timestamp >= ?",
            (tenant_id, since),
        ).fetchone()
        return row[0] or 0.0

    @staticmethod
    def _do_requests_this_hour(conn: sqlite3.Connection, tenant_id: str, since: str) -> int:
        row = conn.execute(
            "SELECT COUNT(*) FROM usage_records WHERE tenant_id = ? AND timestamp >= ?",
            (tenant_id, since),
        ).fetchone()
        return row[0] or 0

    @staticmethod
    def _do_agent_cost_today(conn: sqlite3.Connection, agent_id: str, since: str) -> float:
        row = conn.execute(
            "SELECT SUM(cost_usd) FROM usage_records WHERE agent_id = ? AND timestamp >= ?",
            (agent_id, since),
        ).fetchone()
        return row[0] or 0.0

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
        total_requests, total_input, total_output, total_cost, model_rows = await self._run(
            self._do_summarise, agent_id, tenant_id, model, since, until
        )
        summary = UsageSummary(
            total_requests=total_requests,
            total_input_tokens=total_input,
            total_output_tokens=total_output,
            total_cost_usd=total_cost,
        )
        for m, req_count, in_tok, out_tok, cost in model_rows:
            summary.by_model[m] = {
                "requests": req_count,
                "input_tokens": in_tok or 0,
                "output_tokens": out_tok or 0,
                "cost_usd": cost or 0.0,
            }
        return summary

    async def tokens_today(self, tenant_id: str) -> int:
        since = _ts(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0))
        return await self._run(self._do_tokens_today, tenant_id, since)

    async def cost_today(self, tenant_id: str) -> float:
        since = _ts(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0))
        return await self._run(self._do_cost_today, tenant_id, since)

    async def requests_this_hour(self, tenant_id: str) -> int:
        since = _ts(datetime.now(UTC).replace(minute=0, second=0, microsecond=0))
        return await self._run(self._do_requests_this_hour, tenant_id, since)

    async def agent_cost_today(self, agent_id: str) -> float:
        since = _ts(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0))
        return await self._run(self._do_agent_cost_today, agent_id, since)
