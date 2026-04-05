"""Tests for UsageStore port implementations (memory and SQLite)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from bifrost.adapters.memory_store import MemoryUsageStore
from bifrost.adapters.sqlite_store import SQLiteUsageStore
from bifrost.ports.usage_store import UsageRecord


def _record(
    agent_id: str = "agent-1",
    tenant_id: str = "tenant-1",
    model: str = "claude-sonnet-4-6",
    input_tokens: int = 100,
    output_tokens: int = 50,
    cost_usd: float = 0.001,
    timestamp: datetime | None = None,
    session_id: str = "",
    saga_id: str = "",
    request_id: str = "",
    provider: str = "anthropic",
    latency_ms: float = 0.0,
    streaming: bool = False,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    reasoning_tokens: int = 0,
) -> UsageRecord:
    return UsageRecord(
        request_id=request_id,
        agent_id=agent_id,
        tenant_id=tenant_id,
        session_id=session_id,
        saga_id=saga_id,
        model=model,
        provider=provider,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        reasoning_tokens=reasoning_tokens,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        streaming=streaming,
        timestamp=timestamp or datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Parametrise tests over both implementations
# ---------------------------------------------------------------------------


@pytest.fixture(params=["memory", "sqlite"])
async def store(request):
    if request.param == "memory":
        yield MemoryUsageStore()
    else:
        s = SQLiteUsageStore(":memory:")
        yield s
        await s.close()


# ---------------------------------------------------------------------------
# Basic record / query
# ---------------------------------------------------------------------------


class TestRecordAndQuery:
    async def test_empty_store_returns_nothing(self, store):
        records = await store.query()
        assert records == []

    async def test_record_is_retrievable(self, store):
        r = _record()
        await store.record(r)
        records = await store.query()
        assert len(records) == 1
        assert records[0].agent_id == "agent-1"
        assert records[0].model == "claude-sonnet-4-6"

    async def test_filter_by_agent(self, store):
        await store.record(_record(agent_id="a1"))
        await store.record(_record(agent_id="a2"))
        results = await store.query(agent_id="a1")
        assert len(results) == 1
        assert results[0].agent_id == "a1"

    async def test_filter_by_tenant(self, store):
        await store.record(_record(tenant_id="t1"))
        await store.record(_record(tenant_id="t2"))
        results = await store.query(tenant_id="t2")
        assert len(results) == 1
        assert results[0].tenant_id == "t2"

    async def test_filter_by_model(self, store):
        await store.record(_record(model="claude-sonnet-4-6"))
        await store.record(_record(model="gpt-4o"))
        results = await store.query(model="gpt-4o")
        assert len(results) == 1
        assert results[0].model == "gpt-4o"

    async def test_filter_by_time_range(self, store):
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)
        tomorrow = now + timedelta(days=1)

        await store.record(_record(timestamp=yesterday))
        await store.record(_record(timestamp=now))
        await store.record(_record(timestamp=tomorrow))

        results = await store.query(since=now - timedelta(hours=1), until=now + timedelta(hours=1))
        assert len(results) == 1

    async def test_limit_is_respected(self, store):
        for _ in range(10):
            await store.record(_record())
        results = await store.query(limit=3)
        assert len(results) == 3

    async def test_combined_filters(self, store):
        now = datetime.now(UTC)
        await store.record(_record(agent_id="a", tenant_id="t", model="m1", timestamp=now))
        await store.record(_record(agent_id="a", tenant_id="t", model="m2", timestamp=now))
        await store.record(_record(agent_id="b", tenant_id="t", model="m1", timestamp=now))

        results = await store.query(agent_id="a", model="m1")
        assert len(results) == 1

    async def test_session_and_saga_roundtrip(self, store):
        r = _record(session_id="sess-x", saga_id="saga-y")
        await store.record(r)
        results = await store.query()
        assert results[0].session_id == "sess-x"
        assert results[0].saga_id == "saga-y"

    async def test_new_fields_roundtrip(self, store):
        """All new NIU-483 fields survive a record/query round-trip."""
        r = _record(
            provider="anthropic",
            latency_ms=123.45,
            streaming=True,
            cache_read_tokens=10,
            cache_write_tokens=20,
            reasoning_tokens=5,
        )
        await store.record(r)
        results = await store.query()
        assert len(results) == 1
        rec = results[0]
        assert rec.provider == "anthropic"
        assert abs(rec.latency_ms - 123.45) < 0.01
        assert rec.streaming is True
        assert rec.cache_read_tokens == 10
        assert rec.cache_write_tokens == 20
        assert rec.reasoning_tokens == 5

    async def test_streaming_false_roundtrip(self, store):
        r = _record(streaming=False)
        await store.record(r)
        results = await store.query()
        assert results[0].streaming is False


# ---------------------------------------------------------------------------
# Summarise
# ---------------------------------------------------------------------------


class TestSummarise:
    async def test_empty_summary(self, store):
        summary = await store.summarise()
        assert summary.total_requests == 0
        assert summary.total_cost_usd == 0.0

    async def test_totals_are_correct(self, store):
        await store.record(_record(input_tokens=100, output_tokens=50, cost_usd=0.01))
        await store.record(_record(input_tokens=200, output_tokens=100, cost_usd=0.02))

        summary = await store.summarise()
        assert summary.total_requests == 2
        assert summary.total_input_tokens == 300
        assert summary.total_output_tokens == 150
        assert abs(summary.total_cost_usd - 0.03) < 1e-9

    async def test_per_model_breakdown(self, store):
        await store.record(_record(model="m1", cost_usd=0.01))
        await store.record(_record(model="m1", cost_usd=0.01))
        await store.record(_record(model="m2", cost_usd=0.05))

        summary = await store.summarise()
        assert "m1" in summary.by_model
        assert "m2" in summary.by_model
        assert summary.by_model["m1"]["requests"] == 2
        assert abs(summary.by_model["m2"]["cost_usd"] - 0.05) < 1e-9

    async def test_per_provider_breakdown(self, store):
        await store.record(_record(provider="anthropic", cost_usd=0.01))
        await store.record(_record(provider="openai", cost_usd=0.02))
        await store.record(_record(provider="anthropic", cost_usd=0.03))

        summary = await store.summarise()
        assert "anthropic" in summary.by_provider
        assert "openai" in summary.by_provider
        assert summary.by_provider["anthropic"]["requests"] == 2
        assert abs(summary.by_provider["openai"]["cost_usd"] - 0.02) < 1e-9

    async def test_filter_is_applied_to_summary(self, store):
        await store.record(_record(tenant_id="t1", cost_usd=0.01))
        await store.record(_record(tenant_id="t2", cost_usd=0.50))

        summary = await store.summarise(tenant_id="t1")
        assert summary.total_requests == 1
        assert abs(summary.total_cost_usd - 0.01) < 1e-9


# ---------------------------------------------------------------------------
# Time-series
# ---------------------------------------------------------------------------


class TestTimeSeries:
    async def test_empty_time_series(self, store):
        entries = await store.time_series()
        assert entries == []

    async def test_hour_granularity(self, store):
        now = datetime.now(UTC).replace(minute=30, second=0, microsecond=0)
        two_hours_ago = now - timedelta(hours=2)

        await store.record(_record(timestamp=now, input_tokens=100, output_tokens=50))
        await store.record(_record(timestamp=two_hours_ago, input_tokens=200, output_tokens=100))

        entries = await store.time_series(granularity="hour")
        assert len(entries) == 2
        # Entries must be in chronological order.
        assert entries[0].bucket < entries[1].bucket

    async def test_day_granularity(self, store):
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)

        await store.record(_record(timestamp=now, cost_usd=0.01))
        await store.record(_record(timestamp=now, cost_usd=0.02))
        await store.record(_record(timestamp=yesterday, cost_usd=0.10))

        entries = await store.time_series(granularity="day")
        assert len(entries) == 2
        today_entry = entries[1]  # last bucket = today
        assert today_entry.requests == 2
        assert abs(today_entry.cost_usd - 0.03) < 1e-9

    async def test_time_series_respects_filters(self, store):
        now = datetime.now(UTC)
        await store.record(_record(tenant_id="t1", timestamp=now))
        await store.record(_record(tenant_id="t2", timestamp=now))

        entries = await store.time_series(granularity="hour", tenant_id="t1")
        assert len(entries) == 1
        assert entries[0].requests == 1

    async def test_time_series_bucket_token_aggregation(self, store):
        now = datetime.now(UTC).replace(minute=10, second=0, microsecond=0)

        await store.record(_record(timestamp=now, input_tokens=100, output_tokens=50))
        await store.record(_record(timestamp=now, input_tokens=200, output_tokens=100))

        entries = await store.time_series(granularity="hour")
        assert len(entries) == 1
        assert entries[0].input_tokens == 300
        assert entries[0].output_tokens == 150
        assert entries[0].requests == 2


# ---------------------------------------------------------------------------
# Quota helper methods
# ---------------------------------------------------------------------------


class TestQuotaHelpers:
    async def test_tokens_today_counts_only_today(self, store):
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)

        await store.record(
            _record(tenant_id="t", input_tokens=100, output_tokens=50, timestamp=now)
        )
        await store.record(
            _record(tenant_id="t", input_tokens=999, output_tokens=999, timestamp=yesterday)
        )

        total = await store.tokens_today("t")
        assert total == 150

    async def test_tokens_today_is_per_tenant(self, store):
        now = datetime.now(UTC)
        await store.record(
            _record(tenant_id="t1", input_tokens=100, output_tokens=0, timestamp=now)
        )
        await store.record(
            _record(tenant_id="t2", input_tokens=999, output_tokens=0, timestamp=now)
        )
        assert await store.tokens_today("t1") == 100

    async def test_cost_today(self, store):
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)
        await store.record(_record(tenant_id="t", cost_usd=0.50, timestamp=now))
        await store.record(_record(tenant_id="t", cost_usd=9.99, timestamp=yesterday))

        cost = await store.cost_today("t")
        assert abs(cost - 0.50) < 1e-9

    async def test_requests_this_hour(self, store):
        now = datetime.now(UTC)
        two_hours_ago = now - timedelta(hours=2)

        await store.record(_record(tenant_id="t", timestamp=now))
        await store.record(_record(tenant_id="t", timestamp=now))
        await store.record(_record(tenant_id="t", timestamp=two_hours_ago))

        count = await store.requests_this_hour("t")
        assert count == 2

    async def test_agent_cost_today(self, store):
        now = datetime.now(UTC)
        yesterday = now - timedelta(days=1)
        await store.record(_record(agent_id="a", cost_usd=1.23, timestamp=now))
        await store.record(_record(agent_id="a", cost_usd=9.99, timestamp=yesterday))
        await store.record(_record(agent_id="b", cost_usd=5.00, timestamp=now))

        cost = await store.agent_cost_today("a")
        assert abs(cost - 1.23) < 1e-9

    async def test_zero_for_unknown_tenant(self, store):
        assert await store.tokens_today("no-such-tenant") == 0
        assert await store.cost_today("no-such-tenant") == 0.0
        assert await store.requests_this_hour("no-such-tenant") == 0
