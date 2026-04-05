"""PostgreSQL-backed AccountingPort adapter.

Uses ``asyncpg`` for async I/O against the ``bifrost_requests`` table.

Write path is fire-and-forget: callers wrap ``record()`` in
``asyncio.create_task()`` so DB latency never blocks the response.

Connection string is resolved in priority order:
  1. The ``dsn`` constructor argument (explicit).
  2. The environment variable named by ``dsn_env`` (default: ``DATABASE_URL``).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import asyncpg

from bifrost.adapters._pg_base import PostgresBase
from bifrost.adapters._sql_helpers import build_where_with_range, to_utc
from bifrost.ports.accounting import (
    AccountingPort,
    AccountingSummary,
    AccountingTimeSeries,
    RequestRecord,
)

logger = logging.getLogger(__name__)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS bifrost_requests (
    id                 BIGSERIAL PRIMARY KEY,
    request_id         TEXT        NOT NULL DEFAULT '',
    agent_id           TEXT        NOT NULL,
    tenant_id          TEXT        NOT NULL,
    session_id         TEXT        NOT NULL DEFAULT '',
    saga_id            TEXT        NOT NULL DEFAULT '',
    model              TEXT        NOT NULL,
    provider           TEXT        NOT NULL DEFAULT '',
    input_tokens       INTEGER     NOT NULL DEFAULT 0,
    output_tokens      INTEGER     NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER     NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER     NOT NULL DEFAULT 0,
    reasoning_tokens   INTEGER     NOT NULL DEFAULT 0,
    cost_usd           NUMERIC     NOT NULL DEFAULT 0,
    latency_ms         REAL        NOT NULL DEFAULT 0,
    streaming          BOOLEAN     NOT NULL DEFAULT FALSE,
    timestamp          TIMESTAMPTZ NOT NULL
);
"""

_CREATE_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_bifrost_req_tenant_ts  ON bifrost_requests(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_req_agent_ts   ON bifrost_requests(agent_id,  timestamp);
CREATE INDEX IF NOT EXISTS idx_bifrost_req_model      ON bifrost_requests(model);
CREATE INDEX IF NOT EXISTS idx_bifrost_req_provider   ON bifrost_requests(provider);
"""

_INSERT = """
INSERT INTO bifrost_requests
    (request_id, agent_id, tenant_id, session_id, saga_id,
     model, provider,
     input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
     cost_usd, latency_ms, streaming, timestamp)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
"""


def _row_to_record(row: asyncpg.Record) -> RequestRecord:
    return RequestRecord(
        request_id=row["request_id"],
        agent_id=row["agent_id"],
        tenant_id=row["tenant_id"],
        session_id=row["session_id"],
        saga_id=row["saga_id"],
        model=row["model"],
        provider=row["provider"],
        input_tokens=row["input_tokens"],
        output_tokens=row["output_tokens"],
        cache_read_tokens=row["cache_read_tokens"],
        cache_write_tokens=row["cache_write_tokens"],
        reasoning_tokens=row["reasoning_tokens"],
        cost_usd=float(row["cost_usd"]),
        latency_ms=row["latency_ms"],
        streaming=row["streaming"],
        timestamp=row["timestamp"].replace(tzinfo=UTC),
    )


def _filters(
    agent_id: str | None,
    tenant_id: str | None,
    model: str | None,
) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if agent_id is not None:
        pairs.append(("agent_id", agent_id))
    if tenant_id is not None:
        pairs.append(("tenant_id", tenant_id))
    if model is not None:
        pairs.append(("model", model))
    return pairs


class PostgresAccountingAdapter(PostgresBase, AccountingPort):
    """asyncpg-backed PostgreSQL implementation of ``AccountingPort``.

    Writes to the ``bifrost_requests`` table.  All writes are intended to
    be scheduled via ``asyncio.create_task`` at the call site so they do
    not add latency to the request path.
    """

    _create_table_sql = _CREATE_TABLE
    _create_indexes_sql = _CREATE_INDEXES

    # ------------------------------------------------------------------
    # Port implementation
    # ------------------------------------------------------------------

    async def record(self, usage: RequestRecord) -> None:
        """Persist *usage* to ``bifrost_requests``.

        Schedule this via ``asyncio.create_task`` to avoid blocking
        the request path.
        """
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    _INSERT,
                    usage.request_id,
                    usage.agent_id,
                    usage.tenant_id,
                    usage.session_id,
                    usage.saga_id,
                    usage.model,
                    usage.provider,
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_read_tokens,
                    usage.cache_write_tokens,
                    usage.reasoning_tokens,
                    usage.cost_usd,
                    usage.latency_ms,
                    usage.streaming,
                    to_utc(usage.timestamp),
                )
        except Exception:
            logger.exception("Failed to record accounting entry %s", usage.request_id)

    async def query(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 1000,
    ) -> list[RequestRecord]:
        where, params = build_where_with_range(
            _filters(agent_id, tenant_id, model), since, until,
        )
        limit_idx = len(params) + 1
        sql = f"""
            SELECT request_id, agent_id, tenant_id, session_id, saga_id,
                   model, provider,
                   input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                   reasoning_tokens, cost_usd, latency_ms, streaming, timestamp
            FROM bifrost_requests {where}
            ORDER BY timestamp DESC
            LIMIT ${limit_idx}
        """
        params.append(limit)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
        return [_row_to_record(r) for r in rows]

    async def summarise(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> AccountingSummary:
        where, params = build_where_with_range(
            _filters(agent_id, tenant_id, model), since, until,
        )
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            totals, model_rows, provider_rows = await asyncio.gather(
                conn.fetchrow(
                    f"SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) "
                    f"FROM bifrost_requests {where}",
                    *params,
                ),
                conn.fetch(
                    f"SELECT model, COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cost_usd) "
                    f"FROM bifrost_requests {where} GROUP BY model",
                    *params,
                ),
                conn.fetch(
                    f"SELECT provider, COUNT(*), SUM(input_tokens),"
                    f" SUM(output_tokens), SUM(cost_usd) "
                    f"FROM bifrost_requests {where} GROUP BY provider",
                    *params,
                ),
            )

        summary = AccountingSummary(
            total_requests=totals[0] or 0,
            total_input_tokens=totals[1] or 0,
            total_output_tokens=totals[2] or 0,
            total_cost_usd=float(totals[3] or 0),
        )
        for row in model_rows:
            summary.by_model[row[0]] = {
                "requests": row[1] or 0,
                "input_tokens": row[2] or 0,
                "output_tokens": row[3] or 0,
                "cost_usd": float(row[4] or 0),
            }
        for row in provider_rows:
            summary.by_provider[row[0] or "unknown"] = {
                "requests": row[1] or 0,
                "input_tokens": row[2] or 0,
                "output_tokens": row[3] or 0,
                "cost_usd": float(row[4] or 0),
            }
        return summary

    async def time_series(
        self,
        *,
        granularity: str = "hour",
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[AccountingTimeSeries]:
        where, params = build_where_with_range(
            _filters(agent_id, tenant_id, model), since, until,
        )
        trunc = "hour" if granularity != "day" else "day"
        sql = f"""
            SELECT
                DATE_TRUNC('{trunc}', timestamp) AS bucket,
                COUNT(*) AS requests,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(cost_usd) AS cost_usd
            FROM bifrost_requests {where}
            GROUP BY bucket
            ORDER BY bucket ASC
        """
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
        return [
            AccountingTimeSeries(
                bucket=row["bucket"].replace(tzinfo=UTC).isoformat(),
                requests=row["requests"] or 0,
                input_tokens=row["input_tokens"] or 0,
                output_tokens=row["output_tokens"] or 0,
                cost_usd=float(row["cost_usd"] or 0),
            )
            for row in rows
        ]

    async def tokens_today(self, tenant_id: str) -> int:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT SUM(input_tokens + output_tokens) FROM bifrost_requests "
                "WHERE tenant_id = $1 AND timestamp >= $2",
                tenant_id,
                since,
            )
        return int(row[0] or 0)

    async def cost_today(self, tenant_id: str) -> float:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT SUM(cost_usd) FROM bifrost_requests "
                "WHERE tenant_id = $1 AND timestamp >= $2",
                tenant_id,
                since,
            )
        return float(row[0] or 0)

    async def requests_this_hour(self, tenant_id: str) -> int:
        since = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT COUNT(*) FROM bifrost_requests WHERE tenant_id = $1 AND timestamp >= $2",
                tenant_id,
                since,
            )
        return int(row[0] or 0)

    async def agent_cost_today(self, agent_id: str) -> float:
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT SUM(cost_usd) FROM bifrost_requests "
                "WHERE agent_id = $1 AND timestamp >= $2",
                agent_id,
                since,
            )
        return float(row[0] or 0)
