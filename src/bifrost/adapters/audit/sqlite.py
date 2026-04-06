"""SQLite-backed AuditPort adapter.

Uses the standard-library ``sqlite3`` module via ``asyncio.run_in_executor``
so no extra dependencies are required.

The schema is created automatically on first use (``CREATE TABLE IF NOT EXISTS``).
Old entries can be pruned by calling ``prune(retention_days)`` — this is
intentionally not automatic so callers control when pruning happens.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any

from bifrost.ports.audit import AuditEvent, AuditPort

logger = logging.getLogger(__name__)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS bifrost_audit (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id       TEXT    NOT NULL DEFAULT '',
    agent_id         TEXT    NOT NULL,
    tenant_id        TEXT    NOT NULL,
    session_id       TEXT    NOT NULL DEFAULT '',
    saga_id          TEXT    NOT NULL DEFAULT '',
    model            TEXT    NOT NULL,
    provider         TEXT    NOT NULL DEFAULT '',
    outcome          TEXT    NOT NULL DEFAULT 'success',
    status_code      INTEGER NOT NULL DEFAULT 200,
    rule_name        TEXT    NOT NULL DEFAULT '',
    rule_action      TEXT    NOT NULL DEFAULT '',
    tags             TEXT    NOT NULL DEFAULT '{}',
    error_message    TEXT    NOT NULL DEFAULT '',
    latency_ms       REAL    NOT NULL DEFAULT 0,
    tokens_input     INTEGER NOT NULL DEFAULT 0,
    tokens_output    INTEGER NOT NULL DEFAULT 0,
    cost_usd         REAL    NOT NULL DEFAULT 0,
    cache_hit        INTEGER NOT NULL DEFAULT 0,
    prompt_content   TEXT    NOT NULL DEFAULT '',
    response_content TEXT    NOT NULL DEFAULT '',
    timestamp        TEXT    NOT NULL
);
"""

_CREATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_bfaudit_tenant_ts  ON bifrost_audit(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bfaudit_agent_ts   ON bifrost_audit(agent_id,  timestamp);
CREATE INDEX IF NOT EXISTS idx_bfaudit_outcome    ON bifrost_audit(outcome);
CREATE INDEX IF NOT EXISTS idx_bfaudit_request_id ON bifrost_audit(request_id);
"""

_INSERT = """
INSERT INTO bifrost_audit
    (request_id, agent_id, tenant_id, session_id, saga_id,
     model, provider, outcome, status_code,
     rule_name, rule_action, tags, error_message, latency_ms,
     tokens_input, tokens_output, cost_usd, cache_hit,
     prompt_content, response_content, timestamp)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _row_to_event(row: Any) -> AuditEvent:
    tags: dict[str, str] = json.loads(row[12]) if row[12] else {}
    return AuditEvent(
        request_id=row[1],
        agent_id=row[2],
        tenant_id=row[3],
        session_id=row[4],
        saga_id=row[5],
        model=row[6],
        provider=row[7],
        outcome=row[8],
        status_code=row[9],
        rule_name=row[10],
        rule_action=row[11],
        tags=tags,
        error_message=row[13],
        latency_ms=row[14],
        tokens_input=row[15],
        tokens_output=row[16],
        cost_usd=row[17],
        cache_hit=bool(row[18]),
        prompt_content=row[19],
        response_content=row[20],
        timestamp=datetime.fromisoformat(row[21]).replace(tzinfo=UTC),
    )


def _init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_CREATE_TABLE + _CREATE_INDEXES)
    conn.commit()
    return conn


class SQLiteAuditAdapter(AuditPort):
    """SQLite-backed audit adapter using asyncio.run_in_executor for async I/O.

    Suitable for standalone deployments where PostgreSQL is not available.
    Not suitable for multi-instance deployments.
    """

    def __init__(self, path: str = "./bifrost_audit.db") -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()

    async def _get_conn(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        async with self._lock:
            if self._conn is None:
                loop = asyncio.get_running_loop()
                self._conn = await loop.run_in_executor(None, _init_db, self._path)
        return self._conn

    async def _run(self, fn: Any, *args: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, partial(fn, *args))

    async def log(self, event: AuditEvent) -> None:
        try:
            conn = await self._get_conn()
            params = (
                event.request_id,
                event.agent_id,
                event.tenant_id,
                event.session_id,
                event.saga_id,
                event.model,
                event.provider,
                event.outcome,
                event.status_code,
                event.rule_name,
                event.rule_action,
                json.dumps(event.tags),
                event.error_message,
                event.latency_ms,
                event.tokens_input,
                event.tokens_output,
                event.cost_usd,
                int(event.cache_hit),
                event.prompt_content,
                event.response_content,
                event.timestamp.isoformat(),
            )

            def _insert(c: sqlite3.Connection, p: tuple) -> None:
                c.execute(_INSERT, p)
                c.commit()

            await self._run(_insert, conn, params)
        except Exception:
            logger.exception("SQLiteAuditAdapter.log failed for %s", event.request_id)

    async def query(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        outcome: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 1000,
    ) -> list[AuditEvent]:
        conn = await self._get_conn()
        conditions: list[str] = []
        params: list[Any] = []

        if agent_id is not None:
            conditions.append("agent_id = ?")
            params.append(agent_id)
        if tenant_id is not None:
            conditions.append("tenant_id = ?")
            params.append(tenant_id)
        if model is not None:
            conditions.append("model = ?")
            params.append(model)
        if outcome is not None:
            conditions.append("outcome = ?")
            params.append(outcome)
        if since is not None:
            conditions.append("timestamp >= ?")
            params.append(since.isoformat())
        if until is not None:
            conditions.append("timestamp <= ?")
            params.append(until.isoformat())

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT id, request_id, agent_id, tenant_id, session_id, saga_id,
                   model, provider, outcome, status_code,
                   rule_name, rule_action, tags, error_message, latency_ms,
                   tokens_input, tokens_output, cost_usd, cache_hit,
                   prompt_content, response_content, timestamp
            FROM bifrost_audit {where}
            ORDER BY timestamp DESC
            LIMIT ?
        """
        params.append(limit)

        def _fetch(c: sqlite3.Connection, q: str, p: list) -> list:
            return c.execute(q, p).fetchall()

        rows = await self._run(_fetch, conn, sql, params)
        return [_row_to_event(r) for r in rows]

    async def prune(self, retention_days: int) -> int:
        """Delete records older than *retention_days* days.

        Returns the number of deleted rows.
        """
        if retention_days <= 0:
            return 0
        conn = await self._get_conn()
        cutoff = (datetime.now(UTC) - timedelta(days=retention_days)).isoformat()

        def _delete(c: sqlite3.Connection, cut: str) -> int:
            cur = c.execute("DELETE FROM bifrost_audit WHERE timestamp < ?", (cut,))
            c.commit()
            return cur.rowcount

        return await self._run(_delete, conn, cutoff)

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
