"""Port (abstract interface) for usage record persistence and quota queries.

All concrete storage adapters — in-memory, SQLite, PostgreSQL — must implement
``UsageStore``.  Business logic in ``app.py`` depends on this port only; it
never imports an adapter directly.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class UsageRecord:
    """A single tracked LLM request with attribution and cost."""

    agent_id: str
    tenant_id: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    timestamp: datetime
    request_id: str = ""
    session_id: str = ""
    saga_id: str = ""
    provider: str = ""
    latency_ms: float = 0.0
    streaming: bool = False
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0


@dataclass
class TimeSeriesEntry:
    """Aggregated usage for a single time bucket."""

    bucket: str
    """ISO-8601 timestamp truncated to the granularity boundary (hour or day)."""
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


@dataclass
class UsageSummary:
    """Aggregated usage statistics for a set of records."""

    total_requests: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    by_model: dict[str, dict] = field(default_factory=dict)
    """Per-model breakdown: model → {requests, input_tokens, output_tokens, cost_usd}."""
    by_provider: dict[str, dict] = field(default_factory=dict)
    """Per-provider breakdown: provider → {requests, input_tokens, output_tokens, cost_usd}."""


class UsageStore(ABC):
    """Port for persisting and querying per-request usage records."""

    @abstractmethod
    async def record(self, usage: UsageRecord) -> None:
        """Persist *usage* immediately."""

    @abstractmethod
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
        """Return records matching all supplied filters (AND logic)."""

    @abstractmethod
    async def summarise(
        self,
        *,
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> UsageSummary:
        """Return aggregated totals for the given filter set."""

    @abstractmethod
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
        """Return per-bucket aggregates grouped by *granularity* ('hour' or 'day').

        Buckets are returned in ascending chronological order.
        """

    @abstractmethod
    async def tokens_today(self, tenant_id: str) -> int:
        """Total tokens (input + output) consumed today by *tenant_id*."""

    @abstractmethod
    async def cost_today(self, tenant_id: str) -> float:
        """Total USD cost today for *tenant_id*."""

    @abstractmethod
    async def requests_this_hour(self, tenant_id: str) -> int:
        """Number of requests made this calendar hour by *tenant_id*."""

    @abstractmethod
    async def agent_cost_today(self, agent_id: str) -> float:
        """Total USD cost today attributed to *agent_id*."""
