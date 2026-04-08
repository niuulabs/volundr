"""Tests for PostgresUsageStore — uses MagicMock to stub asyncpg Pool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bifrost.adapters.postgres_store import PostgresUsageStore
from bifrost.ports.usage_store import UsageRecord


def _record(**kwargs) -> UsageRecord:
    defaults = dict(
        request_id="req-1",
        agent_id="agent-1",
        tenant_id="tenant-1",
        session_id="sess",
        saga_id="saga",
        model="claude-sonnet-4-6",
        provider="anthropic",
        input_tokens=100,
        output_tokens=50,
        cache_read_tokens=0,
        cache_write_tokens=0,
        reasoning_tokens=0,
        cost_usd=0.001,
        latency_ms=42.0,
        streaming=False,
        timestamp=datetime.now(UTC),
    )
    defaults.update(kwargs)
    return UsageRecord(**defaults)


def _make_pool_mock():
    """Return a mocked asyncpg pool that works as an async context manager."""
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)
    conn.fetchrow = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])

    pool = MagicMock()
    pool.acquire = MagicMock(
        return_value=MagicMock(
            __aenter__=AsyncMock(return_value=conn), __aexit__=AsyncMock(return_value=False)
        )
    )
    pool.close = AsyncMock()
    return pool, conn


@pytest.fixture
async def pg_store():
    """PostgresUsageStore with asyncpg.create_pool stubbed out."""
    pool, conn = _make_pool_mock()
    _patch = "bifrost.adapters.postgres_store.asyncpg.create_pool"
    with patch(_patch, new_callable=AsyncMock) as mock_cp:
        mock_cp.return_value = pool
        store = PostgresUsageStore(dsn="postgresql://fake/db")
        # Trigger pool creation (runs CREATE TABLE + CREATE INDEXES).
        await store._get_pool()
        # Reset call counts so tests only see their own calls.
        conn.execute.reset_mock()
        conn.fetch.reset_mock()
        conn.fetchrow.reset_mock()
        yield store, conn
    await store.close()


class TestPostgresUsageStoreRecord:
    async def test_record_calls_execute(self, pg_store):
        store, conn = pg_store
        r = _record()
        await store.record(r)
        conn.execute.assert_called_once()
        call_args = conn.execute.call_args[0]
        # First arg is the INSERT SQL.
        assert "INSERT INTO usage_records" in call_args[0]

    async def test_record_passes_all_fields(self, pg_store):
        store, conn = pg_store
        r = _record(
            provider="openai",
            latency_ms=99.9,
            streaming=True,
            cache_read_tokens=7,
            cache_write_tokens=13,
            reasoning_tokens=3,
        )
        await store.record(r)
        _, *args = conn.execute.call_args[0]
        # Spot-check that provider and streaming are passed.
        assert "openai" in args
        assert True in args  # streaming=True


class TestPostgresUsageStoreQuery:
    async def test_query_returns_empty_list(self, pg_store):
        store, conn = pg_store
        conn.fetch.return_value = []
        results = await store.query()
        assert results == []

    async def test_query_with_filters(self, pg_store):
        store, conn = pg_store
        conn.fetch.return_value = []
        await store.query(agent_id="a", tenant_id="t", model="m")
        conn.fetch.assert_called_once()
        sql = conn.fetch.call_args[0][0]
        assert "agent_id" in sql
        assert "tenant_id" in sql
        assert "model" in sql


class TestPostgresUsageStoreSummarise:
    async def test_summarise_returns_zero_on_empty(self, pg_store):
        store, conn = pg_store
        # fetchrow returns (0, 0, 0, 0)
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 0)
        conn.fetch.return_value = []

        summary = await store.summarise()
        assert summary.total_requests == 0
        assert summary.total_cost_usd == 0.0
        assert summary.by_model == {}
        assert summary.by_provider == {}


class TestPostgresUsageStoreTimeSeries:
    async def test_time_series_empty(self, pg_store):
        store, conn = pg_store
        conn.fetch.return_value = []
        entries = await store.time_series(granularity="hour")
        assert entries == []

    async def test_time_series_uses_date_trunc_hour(self, pg_store):
        store, conn = pg_store
        conn.fetch.return_value = []
        await store.time_series(granularity="hour")
        sql = conn.fetch.call_args[0][0]
        assert "DATE_TRUNC" in sql
        assert "hour" in sql

    async def test_time_series_uses_date_trunc_day(self, pg_store):
        store, conn = pg_store
        conn.fetch.return_value = []
        await store.time_series(granularity="day")
        sql = conn.fetch.call_args[0][0]
        assert "DATE_TRUNC" in sql
        assert "day" in sql


class TestPostgresUsageStoreClose:
    async def test_close_calls_pool_close(self):
        pool, conn = _make_pool_mock()
        _patch = "bifrost.adapters.postgres_store.asyncpg.create_pool"
        with patch(_patch, new_callable=AsyncMock) as mock_cp:
            mock_cp.return_value = pool
            store = PostgresUsageStore(dsn="postgresql://fake/db")
            await store._get_pool()
            await store.close()
        pool.close.assert_called_once()
