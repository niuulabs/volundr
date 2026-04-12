"""Null cost event emitter — drops all events silently.

Used in Pi / local mode where no event backbone is available.
"""

from __future__ import annotations

from bifrost.ports.events import (
    BudgetDegradedEvent,
    BudgetWarningEvent,
    CostEventEmitter,
    RequestCompletedEvent,
)


class NullEventEmitter(CostEventEmitter):
    """Silently discards all cost events."""

    async def emit_request_completed(self, event: RequestCompletedEvent) -> None:
        pass

    async def emit_budget_warning(self, event: BudgetWarningEvent) -> None:
        pass

    async def emit_budget_degraded(self, event: BudgetDegradedEvent) -> None:
        pass
