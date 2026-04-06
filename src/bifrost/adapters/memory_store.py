"""In-memory UsageStore adapter.

Suitable for testing and standalone single-process deployments where
persistence across restarts is not required.
"""

from __future__ import annotations

from datetime import UTC, datetime

from bifrost.ports.usage_store import (
    TimeSeriesEntry,
    UsageRecord,
    UsageStore,
    UsageSummary,
)


def _today_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _hour_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(minute=0, second=0, microsecond=0)


def _bucket_key(ts: datetime, granularity: str) -> str:
    """Return an ISO-8601 bucket key truncated to the given granularity."""
    if granularity == "day":
        return ts.astimezone(UTC).strftime("%Y-%m-%dT00:00:00+00:00")
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:00:00+00:00")


class MemoryUsageStore(UsageStore):
    """Thread-safe (GIL) in-memory implementation of ``UsageStore``."""

    def __init__(self) -> None:
        self._records: list[UsageRecord] = []

    async def record(self, usage: UsageRecord) -> None:
        self._records.append(usage)

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
        results = self._records
        if agent_id is not None:
            results = [r for r in results if r.agent_id == agent_id]
        if tenant_id is not None:
            results = [r for r in results if r.tenant_id == tenant_id]
        if model is not None:
            results = [r for r in results if r.model == model]
        if since is not None:
            results = [r for r in results if r.timestamp >= since]
        if until is not None:
            results = [r for r in results if r.timestamp <= until]
        return results[-limit:]

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

            prov = r.provider or "unknown"
            p_entry = summary.by_provider.setdefault(
                prov,
                {"requests": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            )
            p_entry["requests"] += 1
            p_entry["input_tokens"] += r.input_tokens
            p_entry["output_tokens"] += r.output_tokens
            p_entry["cost_usd"] += r.cost_usd

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
    ) -> list[TimeSeriesEntry]:
        records = self._records
        if agent_id is not None:
            records = [r for r in records if r.agent_id == agent_id]
        if tenant_id is not None:
            records = [r for r in records if r.tenant_id == tenant_id]
        if model is not None:
            records = [r for r in records if r.model == model]
        if since is not None:
            records = [r for r in records if r.timestamp >= since]
        if until is not None:
            records = [r for r in records if r.timestamp <= until]
        buckets: dict[str, TimeSeriesEntry] = {}
        for r in records:
            key = _bucket_key(r.timestamp, granularity)
            entry = buckets.setdefault(key, TimeSeriesEntry(bucket=key))
            entry.requests += 1
            entry.input_tokens += r.input_tokens
            entry.output_tokens += r.output_tokens
            entry.cost_usd += r.cost_usd
        return sorted(buckets.values(), key=lambda e: e.bucket)

    async def tokens_today(self, tenant_id: str) -> int:
        since = _today_start()
        records = [r for r in self._records if r.tenant_id == tenant_id and r.timestamp >= since]
        return sum(r.input_tokens + r.output_tokens for r in records)

    async def cost_today(self, tenant_id: str) -> float:
        since = _today_start()
        return sum(
            r.cost_usd for r in self._records if r.tenant_id == tenant_id and r.timestamp >= since
        )

    async def requests_this_hour(self, tenant_id: str) -> int:
        since = _hour_start()
        return sum(1 for r in self._records if r.tenant_id == tenant_id and r.timestamp >= since)

    async def agent_cost_today(self, agent_id: str) -> float:
        since = _today_start()
        return sum(
            r.cost_usd for r in self._records if r.agent_id == agent_id and r.timestamp >= since
        )
