"""Port (abstract interface) for LLM request accounting.

Re-exports the canonical ``UsageStore`` types under accounting-specific
names so that callers can ``from bifrost.ports.accounting import AccountingPort``
without duplicating the identical interface.

Write path is always fire-and-forget (callers use ``asyncio.create_task``);
the port interface remains ``async`` so implementations can propagate errors
through the task if needed.
"""

from __future__ import annotations

from bifrost.ports.usage_store import TimeSeriesEntry as AccountingTimeSeries
from bifrost.ports.usage_store import UsageRecord as RequestRecord
from bifrost.ports.usage_store import UsageStore as AccountingPort
from bifrost.ports.usage_store import UsageSummary as AccountingSummary

__all__ = [
    "AccountingPort",
    "AccountingSummary",
    "AccountingTimeSeries",
    "RequestRecord",
]
