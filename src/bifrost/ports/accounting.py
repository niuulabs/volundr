"""Port (abstract interface) for LLM request accounting.

All per-request cost and token data is written to and read from
``AccountingPort`` implementations.  The PostgreSQL adapter uses the
``bifrost_requests`` table; in-memory and SQLite adapters are available
for tests and local development.

Write path is always fire-and-forget (callers use ``asyncio.create_task``);
the port interface remains ``async`` so implementations can propagate errors
through the task if needed.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class RequestRecord:
    """One row of accounting data, written per LLM request."""

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
class AccountingSummary:
    """Aggregated totals for a set of request records."""

    total_requests: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    by_model: dict[str, dict] = field(default_factory=dict)
    """Per-model breakdown: model → {requests, input_tokens, output_tokens, cost_usd}."""
    by_provider: dict[str, dict] = field(default_factory=dict)
    """Per-provider breakdown: provider → {requests, input_tokens, output_tokens, cost_usd}."""


@dataclass
class AccountingTimeSeries:
    """Aggregated usage for one time bucket."""

    bucket: str
    """ISO-8601 timestamp truncated to the granularity boundary (hour or day)."""
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class AccountingPort(ABC):
    """Port for persisting and querying per-request accounting records."""

    @abstractmethod
    async def record(self, record: RequestRecord) -> None:
        """Persist *record*.

        Callers schedule this via ``asyncio.create_task`` so it does not
        block request processing.
        """

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
    ) -> list[RequestRecord]:
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
    ) -> AccountingSummary:
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
    ) -> list[AccountingTimeSeries]:
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
