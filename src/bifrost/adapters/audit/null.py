"""No-op AuditPort adapter — discards all audit events.

Used as the default adapter when no audit backend is configured.
"""

from __future__ import annotations

from datetime import datetime

from bifrost.ports.audit import AuditEvent, AuditPort


class NullAuditAdapter(AuditPort):
    """Discards every audit event silently.

    Suitable for development environments or deployments where audit
    logging is handled by the observability stack rather than Bifröst.
    """

    async def log(self, event: AuditEvent) -> None:
        """Discard *event* silently."""

    async def close(self) -> None:
        """No-op — nothing to shut down."""

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
        """Always returns an empty list."""
        return []
