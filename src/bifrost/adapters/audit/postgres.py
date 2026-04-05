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
from datetime import UTC, datetime

import asyncpg

from bifrost.adapters._pg_base import PostgresBase
from bifrost.adapters._sql_helpers import build_where_with_range, to_utc
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


def _filters(
    agent_id: str | None,
    tenant_id: str | None,
    model: str | None,
    outcome: str | None,
) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if agent_id is not None:
        pairs.append(("agent_id", agent_id))
    if tenant_id is not None:
        pairs.append(("tenant_id", tenant_id))
    if model is not None:
        pairs.append(("model", model))
    if outcome is not None:
        pairs.append(("outcome", outcome))
    return pairs


class PostgresAuditAdapter(PostgresBase, AuditPort):
    """asyncpg-backed PostgreSQL implementation of ``AuditPort``.

    Writes to the ``bifrost_audit`` table.  All writes are intended to
    be scheduled via ``asyncio.create_task`` at the call site so they do
    not add latency to the request path.
    """

    _create_table_sql = _CREATE_TABLE
    _create_indexes_sql = _CREATE_INDEXES

    # ------------------------------------------------------------------
    # Port implementation
    # ------------------------------------------------------------------

    async def log(self, event: AuditEvent) -> None:
        """Append *event* to ``bifrost_audit``.

        Schedule this via ``asyncio.create_task`` to avoid blocking
        the request path.
        """
        try:
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
                    to_utc(event.timestamp),
                )
        except Exception:
            logger.exception("Failed to log audit event %s", event.request_id)

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
        where, params = build_where_with_range(
            _filters(agent_id, tenant_id, model, outcome), since, until,
        )
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
