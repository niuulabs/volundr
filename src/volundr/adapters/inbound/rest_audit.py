"""REST adapter for the Sleipnir audit log (read-only query API).

Exposes a single endpoint::

    GET /audit/events
        ?event_type=ravn.*
        &from=2026-04-01T00:00:00Z
        &to=2026-04-02T00:00:00Z
        &correlation_id=abc-123
        &source=ravn:agent
        &limit=100

Used by the Hliðskjálf timeline view and incident investigation tooling.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from sleipnir.domain.events import SleipnirEvent
from sleipnir.ports.audit import AuditQuery, AuditRepository

logger = logging.getLogger(__name__)

_DEFAULT_LIMIT = 100
_MAX_LIMIT = 1000


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


class AuditEventResponse(BaseModel):
    """A single audit log entry."""

    event_id: str = Field(description="Unique event identifier")
    event_type: str = Field(description="Hierarchical dot-separated event type")
    source: str = Field(description="Publisher identity")
    summary: str = Field(description="Human-readable one-liner")
    urgency: float = Field(description="Priority hint 0.0–1.0")
    domain: str = Field(description="High-level domain tag")
    correlation_id: str | None = Field(default=None, description="Correlation group")
    causation_id: str | None = Field(default=None, description="Causing event ID")
    tenant_id: str | None = Field(default=None, description="Tenant scope")
    payload: dict = Field(description="Event-specific data")
    timestamp: str = Field(description="ISO 8601 event timestamp")
    ttl: int | None = Field(default=None, description="Seconds until expiry")

    @classmethod
    def from_event(cls, event: SleipnirEvent) -> AuditEventResponse:
        return cls(
            event_id=event.event_id,
            event_type=event.event_type,
            source=event.source,
            summary=event.summary,
            urgency=event.urgency,
            domain=event.domain,
            correlation_id=event.correlation_id,
            causation_id=event.causation_id,
            tenant_id=event.tenant_id,
            payload=event.payload,
            timestamp=event.timestamp.isoformat(),
            ttl=event.ttl,
        )


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_audit_router(repository: AuditRepository) -> APIRouter:
    """Create the FastAPI router for audit log queries.

    :param repository: The :class:`~sleipnir.ports.audit.AuditRepository`
        implementation to query.
    """
    router = APIRouter(prefix="/audit", tags=["Audit"])

    @router.get("/events", response_model=list[AuditEventResponse])
    async def query_audit_events(
        event_type: str | None = Query(
            default=None,
            description=(
                "Glob pattern for event type (e.g. ``ravn.*``, ``tyr.task.*``). "
                "Omit to match all event types."
            ),
            examples=["ravn.*"],
        ),
        from_: datetime | None = Query(
            default=None,
            alias="from",
            description="Return events at or after this ISO 8601 timestamp.",
            examples=["2026-04-01T00:00:00Z"],
        ),
        to: datetime | None = Query(
            default=None,
            description="Return events at or before this ISO 8601 timestamp.",
            examples=["2026-04-02T00:00:00Z"],
        ),
        correlation_id: str | None = Query(
            default=None,
            description="Filter to events with this exact correlation ID.",
        ),
        source: str | None = Query(
            default=None,
            description="Filter to events from this exact source (e.g. ``ravn:agent``).",
        ),
        limit: int = Query(
            default=_DEFAULT_LIMIT,
            ge=1,
            le=_MAX_LIMIT,
            description=f"Maximum events to return (1–{_MAX_LIMIT}).",
        ),
    ) -> list[AuditEventResponse]:
        """Query the audit log.

        Returns events in reverse-chronological order (newest first).
        Supports glob-style ``event_type`` patterns such as ``ravn.*`` or
        ``tyr.task.*``.
        """
        q = AuditQuery(
            event_type_pattern=event_type,
            from_ts=from_,
            to_ts=to,
            correlation_id=correlation_id,
            source=source,
            limit=limit,
        )
        events = await repository.query(q)
        return [AuditEventResponse.from_event(e) for e in events]

    return router
