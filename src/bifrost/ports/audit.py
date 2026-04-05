"""Port (abstract interface) for request audit logging.

Audit events capture security-relevant request metadata: who called,
what model was requested, which rules fired, and what the outcome was.
Audit records are append-only; there is no mutation or deletion path.

Write path is fire-and-forget (callers use ``asyncio.create_task``).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AuditEvent:
    """One audit log entry, written per LLM request attempt."""

    request_id: str
    agent_id: str
    tenant_id: str
    model: str
    timestamp: datetime
    provider: str = ""
    session_id: str = ""
    saga_id: str = ""
    outcome: str = "success"
    """Request outcome: 'success', 'rejected', 'quota_exceeded', 'error'."""
    status_code: int = 200
    """HTTP status code returned to the caller."""
    rule_name: str = ""
    """Name of the routing rule that matched (empty if none)."""
    rule_action: str = ""
    """Action taken by the matched rule: 'route_to', 'reject', 'tag', etc."""
    tags: dict[str, str] = field(default_factory=dict)
    """Arbitrary key-value metadata attached by 'tag' rules."""
    error_message: str = ""
    """Error detail when outcome is 'error' or 'rejected'."""
    latency_ms: float = 0.0


class AuditPort(ABC):
    """Port for appending and querying audit log entries."""

    @abstractmethod
    async def log(self, event: AuditEvent) -> None:
        """Append *event* to the audit log.

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
        outcome: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 1000,
    ) -> list[AuditEvent]:
        """Return audit events matching all supplied filters (AND logic)."""
