"""No-op audit adapter.

Used when ``audit.adapter`` is ``'null'`` (the default). All log calls are
silently discarded and queries always return an empty list.
"""

from __future__ import annotations

from datetime import datetime

from bifrost.ports.audit import AuditEvent, AuditPort


class NullAuditAdapter(AuditPort):
    """Discard all audit events. Used when audit logging is disabled."""

    async def log(self, event: AuditEvent) -> None:
        pass

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
        return []
