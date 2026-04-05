"""PostgreSQL-backed AuditPort adapter.

Uses ``asyncpg`` for async I/O against the ``bifrost_audit`` table.

Write path is fire-and-forget: callers wrap ``log()`` in
``asyncio.create_task()`` so DB latency never blocks the response.

Connection string is resolved in priority order:
  1. The ``dsn`` constructor argument (explicit).
  2. The environment variable named by ``dsn_env`` (default: ``DATABASE_URL``).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any

import asyncpg

from bifrost.ports.audit import AuditEvent, AuditPort

logger = logging.getLogger(__name__)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS bifrost_audit (
    id            BIGSERIAL PRIMARY KEY,
    request_id    TEXT        NOT NULL DEFAULT '',
    agent_id      TEXT        NOT NULL,
    tenant_id     TEXT        NOT NULL,
    session_id    TEXT        NOT NULL DEFAULT '',
    saga_id       TEXT        NOT NULL DEFAULT '',
    model         TEXT        NOT NULL,
    provider      TEXT        NOT NULL DEFAULT '',
    outcome       TEXT        NOT NULL DEFAULT 'success',
    status_code   INTEGER     NOT NULL DEFAULT 200,
    rule_name     TEXT        NOT NULL DEFAULT '',
    rule_action   TEXT        NOT NULL DEFAULT '',
    tags          JSONB       NOT NULL DEFAULT '{}',
    error_message TEXT        NOT NULL DEFAULT '',
    latency_ms    REAL        NOT NULL DEFAULT 0,
    timestamp     TIMESTAMPTZ NOT NULL
);
"""

_CREATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_tenant_ts  ON bifrost_audit(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_agent_ts   ON bifrost_audit(agent_id,  timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_outcome    ON bifrost_audit(outcome);
CREATE INDEX IF NOT EXISTS idx_bifrost_audit_request_id ON bifrost_audit(request_id);
"""

_INSERT = """
INSERT INTO bifrost_audit
    (request_id, agent_id, tenant_id, session_id, saga_id,
     model, provider, outcome, status_code,
     rule_name, rule_action, tags, error_message, latency_ms, timestamp)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
"""


def _ts(dt: datetime) -> datetime:
    return dt.astimezone(UTC)


def _row_to_event(row: asyncpg.Record) -> AuditEvent:
    raw_tags = row["tags"]
    tags: dict[str, str] = json.loads(raw_tags) if isinstance(raw_tags, str) else dict(raw_tags)
    return AuditEvent(
        request_id=row["request_id"],
        agent_id=row["agent_id"],
        tenant_id=row["tenant_id"],
        session_id=row["session_id"],
        saga_id=row["saga_id"],
        model=row["model"],
        provider=row["provider"],
        outcome=row["outcome"],
        status_code=row["status_code"],
        rule_name=row["rule_name"],
        rule_action=row["rule_action"],
        tags=tags,
        error_message=row["error_message"],
        latency_ms=row["latency_ms"],
        timestamp=row["timestamp"].replace(tzinfo=UTC),
    )


def _build_where(
    agent_id: str | None,
    tenant_id: str | None,
    model: str | None,
    outcome: str | None,
    since: datetime | None,
    until: datetime | None,
    start_idx: int = 1,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    idx = start_idx

    if agent_id is not None:
        clauses.append(f"agent_id = ${idx}")
        params.append(agent_id)
        idx += 1
    if tenant_id is not None:
        clauses.append(f"tenant_id = ${idx}")
        params.append(tenant_id)
        idx += 1
    if model is not None:
        clauses.append(f"model = ${idx}")
        params.append(model)
        idx += 1
    if outcome is not None:
        clauses.append(f"outcome = ${idx}")
        params.append(outcome)
        idx += 1
    if since is not None:
        clauses.append(f"timestamp >= ${idx}")
        params.append(_ts(since))
        idx += 1
    if until is not None:
        clauses.append(f"timestamp <= ${idx}")
        params.append(_ts(until))

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


class PostgresAuditAdapter(AuditPort):
    """asyncpg-backed PostgreSQL implementation of ``AuditPort``.

    Writes to the ``bifrost_audit`` table.  All writes are intended to
    be scheduled via ``asyncio.create_task`` at the call site so they do
    not add latency to the request path.

    Args:
        dsn:     PostgreSQL connection string.  When blank, falls back to
                 the environment variable named by *dsn_env*.
        dsn_env: Environment variable holding the DSN (default: ``DATABASE_URL``).
        min_size: Minimum connection pool size.
        max_size: Maximum connection pool size.
    """

    def __init__(
        self,
        dsn: str = "",
        dsn_env: str = "DATABASE_URL",
        min_size: int = 1,
        max_size: int = 10,
    ) -> None:
        self._dsn = dsn or os.environ.get(dsn_env, "")
        self._min_size = min_size
        self._max_size = max_size
        self._pool: asyncpg.Pool | None = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self._dsn,
                min_size=self._min_size,
                max_size=self._max_size,
            )
            async with self._pool.acquire() as conn:
                await conn.execute(_CREATE_TABLE)
                await conn.execute(_CREATE_INDEXES)
        return self._pool

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    # ------------------------------------------------------------------
    # Port implementation
    # ------------------------------------------------------------------

    async def log(self, event: AuditEvent) -> None:
        """Append *event* to ``bifrost_audit``.

        Schedule this via ``asyncio.create_task`` to avoid blocking
        the request path::

            asyncio.create_task(audit.log(event))
        """
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                _INSERT,
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
                _ts(event.timestamp),
            )

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
        where, params = _build_where(agent_id, tenant_id, model, outcome, since, until, start_idx=1)
        limit_idx = len(params) + 1
        sql = f"""
            SELECT request_id, agent_id, tenant_id, session_id, saga_id,
                   model, provider, outcome, status_code,
                   rule_name, rule_action, tags, error_message, latency_ms, timestamp
            FROM bifrost_audit {where}
            ORDER BY timestamp DESC
            LIMIT ${limit_idx}
        """
        params.append(limit)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
        return [_row_to_event(r) for r in rows]
