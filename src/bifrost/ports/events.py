"""Port (abstract interface) for cost event emission.

Adapters publish cost events to downstream consumers (Valkyries) via
the Sleipnir event backbone (RabbitMQ) or a null sink for local/Pi mode.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass
class RequestCompletedEvent:
    """Emitted after every LLM request completes."""

    agent_id: str
    session_id: str
    cost_usd: float
    tokens_used: int
    budget_pct_remaining: float
    model: str
    timestamp: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    type: str = "bifrost.cost.request_completed"


@dataclass
class BudgetWarningEvent:
    """Emitted when an agent's remaining daily budget falls below the warning threshold."""

    agent_id: str
    budget_pct_remaining: float
    daily_limit_usd: float
    spent_usd: float
    type: str = "bifrost.cost.budget_warning"


@dataclass
class BudgetDegradedEvent:
    """Emitted when a request is routed to a cheaper model due to budget pressure."""

    agent_id: str
    session_id: str
    original_model: str
    degraded_model: str
    budget_pct_consumed: float
    daily_limit_usd: float
    spent_usd: float
    type: str = "bifrost.budget.degraded"


class CostEventEmitter(ABC):
    """Port for publishing cost events to downstream consumers."""

    @abstractmethod
    async def emit_request_completed(self, event: RequestCompletedEvent) -> None:
        """Publish a request-completed cost event."""

    @abstractmethod
    async def emit_budget_warning(self, event: BudgetWarningEvent) -> None:
        """Publish a budget-warning event."""

    @abstractmethod
    async def emit_budget_degraded(self, event: BudgetDegradedEvent) -> None:
        """Publish a budget-degraded event when a request is downgraded to a cheaper model."""

    async def close(self) -> None:
        """Release resources held by this emitter."""
