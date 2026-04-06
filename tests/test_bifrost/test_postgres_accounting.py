"""Tests for PostgresAccountingAdapter — uses MagicMock to stub asyncpg Pool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bifrost.adapters.accounting.postgres import PostgresAccountingAdapter
from bifrost.ports.accounting import RequestRecord
from tests.test_bifrost.conftest import make_pool_mock


def _record(**kwargs) -> RequestRecord:
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
    return RequestRecord(**defaults)


_PATCH_PATH = "bifrost.adapters._pg_base.asyncpg.create_pool"


@pytest.fixture
async def pg_accounting():
    """PostgresAccountingAdapter with asyncpg.create_pool stubbed out."""
    pool, conn = make_pool_mock()
    with patch(_PATCH_PATH, new_callable=AsyncMock) as mock_cp:
        mock_cp.return_value = pool
        adapter = PostgresAccountingAdapter(dsn="postgresql://fake/db")
        await adapter._get_pool()
        conn.execute.reset_mock()
        conn.fetch.reset_mock()
        conn.fetchrow.reset_mock()
        yield adapter, conn
    await adapter.close()


class TestPostgresAccountingRecord:
    async def test_record_calls_execute(self, pg_accounting):
        adapter, conn = pg_accounting
        await adapter.record(_record())
        conn.execute.assert_called_once()
        sql = conn.execute.call_args[0][0]
        assert "INSERT INTO bifrost_requests" in sql

    async def test_record_passes_all_fields(self, pg_accounting):
        adapter, conn = pg_accounting
        r = _record(
            provider="openai",
            latency_ms=99.9,
            streaming=True,
            cache_read_tokens=7,
            cache_write_tokens=13,
            reasoning_tokens=3,
        )
        await adapter.record(r)
        _, *args = conn.execute.call_args[0]
        assert "openai" in args
        assert True in args  # streaming=True

    async def test_record_uses_bifrost_requests_table(self, pg_accounting):
        adapter, conn = pg_accounting
        await adapter.record(_record())
        sql = conn.execute.call_args[0][0]
        assert "bifrost_requests" in sql
        assert "usage_records" not in sql


class TestPostgresAccountingQuery:
    async def test_query_returns_empty_list(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        results = await adapter.query()
        assert results == []

    async def test_query_with_filters(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        await adapter.query(agent_id="a", tenant_id="t", model="m")
        conn.fetch.assert_called_once()
        sql = conn.fetch.call_args[0][0]
        assert "agent_id" in sql
        assert "tenant_id" in sql
        assert "model" in sql

    async def test_query_uses_bifrost_requests_table(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        await adapter.query()
        sql = conn.fetch.call_args[0][0]
        assert "bifrost_requests" in sql


class TestPostgresAccountingSummarise:
    async def test_summarise_returns_zero_on_empty(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 0)
        conn.fetch.return_value = []

        summary = await adapter.summarise()
        assert summary.total_requests == 0
        assert summary.total_cost_usd == 0.0
        assert summary.by_model == {}
        assert summary.by_provider == {}

    async def test_summarise_with_tenant_filter(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 0)
        conn.fetch.return_value = []

        await adapter.summarise(tenant_id="t1")
        sql = conn.fetchrow.call_args[0][0]
        assert "tenant_id" in sql


class TestPostgresAccountingTimeSeries:
    async def test_time_series_empty(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        entries = await adapter.time_series(granularity="hour")
        assert entries == []

    async def test_time_series_uses_date_trunc_hour(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        await adapter.time_series(granularity="hour")
        sql = conn.fetch.call_args[0][0]
        assert "DATE_TRUNC" in sql
        assert "hour" in sql

    async def test_time_series_uses_date_trunc_day(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        await adapter.time_series(granularity="day")
        sql = conn.fetch.call_args[0][0]
        assert "DATE_TRUNC" in sql
        assert "day" in sql

    async def test_time_series_uses_bifrost_requests_table(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetch.return_value = []
        await adapter.time_series()
        sql = conn.fetch.call_args[0][0]
        assert "bifrost_requests" in sql


class TestPostgresAccountingQuotaHelpers:
    async def test_tokens_today(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 150)
        result = await adapter.tokens_today("tenant-1")
        assert result == 150
        sql = conn.fetchrow.call_args[0][0]
        assert "bifrost_requests" in sql
        assert "input_tokens + output_tokens" in sql

    async def test_tokens_today_none_returns_zero(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: None)
        result = await adapter.tokens_today("tenant-1")
        assert result == 0

    async def test_cost_today(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 0.05)
        result = await adapter.cost_today("tenant-1")
        assert result == pytest.approx(0.05)

    async def test_cost_today_none_returns_zero(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: None)
        result = await adapter.cost_today("tenant-1")
        assert result == 0.0

    async def test_requests_this_hour(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 42)
        result = await adapter.requests_this_hour("tenant-1")
        assert result == 42

    async def test_agent_cost_today(self, pg_accounting):
        adapter, conn = pg_accounting
        conn.fetchrow.return_value = MagicMock(__getitem__=lambda self, i: 1.23)
        result = await adapter.agent_cost_today("agent-1")
        assert result == pytest.approx(1.23)


class TestPostgresAccountingClose:
    async def test_close_calls_pool_close(self):
        pool, conn = make_pool_mock()
        with patch(_PATCH_PATH, new_callable=AsyncMock) as mock_cp:
            mock_cp.return_value = pool
            adapter = PostgresAccountingAdapter(dsn="postgresql://fake/db")
            await adapter._get_pool()
            await adapter.close()
        pool.close.assert_called_once()

    async def test_close_is_idempotent(self):
        pool, conn = make_pool_mock()
        with patch(_PATCH_PATH, new_callable=AsyncMock) as mock_cp:
            mock_cp.return_value = pool
            adapter = PostgresAccountingAdapter(dsn="postgresql://fake/db")
            await adapter._get_pool()
            await adapter.close()
            await adapter.close()  # second close should be a no-op
        pool.close.assert_called_once()


class TestPostgresAccountingDsnEnv:
    def test_dsn_env_fallback(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://env-host/db")
        adapter = PostgresAccountingAdapter()
        assert adapter._dsn == "postgresql://env-host/db"

    def test_explicit_dsn_takes_precedence(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://env-host/db")
        adapter = PostgresAccountingAdapter(dsn="postgresql://explicit/db")
        assert adapter._dsn == "postgresql://explicit/db"

    def test_custom_dsn_env(self, monkeypatch):
        monkeypatch.setenv("MY_DB_URL", "postgresql://custom/db")
        adapter = PostgresAccountingAdapter(dsn_env="MY_DB_URL")
        assert adapter._dsn == "postgresql://custom/db"
