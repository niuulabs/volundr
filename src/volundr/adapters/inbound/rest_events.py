"""REST adapter for the session event pipeline."""

import logging
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.domain.models import SessionEvent, SessionEventType
from volundr.domain.ports import SessionEventRepository
from volundr.domain.services.event_ingestion import EventIngestionService

logger = logging.getLogger(__name__)


# -- Request / Response models ------------------------------------------------


class EventIngestRequest(BaseModel):
    """Single event submission from a Skuld pod."""

    session_id: UUID
    event_type: str = Field(..., min_length=1)
    timestamp: datetime
    data: dict = Field(default_factory=dict)
    sequence: int = Field(..., ge=0)
    tokens_in: int | None = Field(default=None, ge=0)
    tokens_out: int | None = Field(default=None, ge=0)
    cost: float | None = Field(default=None, ge=0)
    duration_ms: int | None = Field(default=None, ge=0)
    model: str | None = Field(default=None, max_length=100)


class EventBatchRequest(BaseModel):
    """Batch event submission."""

    events: list[EventIngestRequest] = Field(..., min_length=1, max_length=500)


class SessionEventResponse(BaseModel):
    """Response model for a session event."""

    id: UUID
    session_id: UUID
    event_type: str
    timestamp: str
    data: dict
    sequence: int
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost: float | None = None
    duration_ms: int | None = None
    model: str | None = None

    @classmethod
    def from_event(cls, event: SessionEvent) -> "SessionEventResponse":
        return cls(
            id=event.id,
            session_id=event.session_id,
            event_type=event.event_type.value,
            timestamp=event.timestamp.isoformat(),
            data=event.data,
            sequence=event.sequence,
            tokens_in=event.tokens_in,
            tokens_out=event.tokens_out,
            cost=float(event.cost) if event.cost is not None else None,
            duration_ms=event.duration_ms,
            model=event.model,
        )


class SinkHealthResponse(BaseModel):
    """Health status of all event sinks."""

    sinks: dict[str, bool]


# -- Router factory -----------------------------------------------------------


def create_events_router(
    ingestion_service: EventIngestionService,
    event_repository: SessionEventRepository,
) -> APIRouter:
    """Create FastAPI router for event pipeline endpoints."""
    router = APIRouter(prefix="/api/v1/volundr")

    @router.post(
        "/events",
        response_model=SessionEventResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["Events"],
    )
    async def ingest_event(data: EventIngestRequest) -> SessionEventResponse:
        """Ingest a single session event into the pipeline."""
        try:
            event_type = SessionEventType(data.event_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid event_type: {data.event_type}",
            )

        event = SessionEvent(
            id=uuid4(),
            session_id=data.session_id,
            event_type=event_type,
            timestamp=data.timestamp,
            data=data.data,
            sequence=data.sequence,
            tokens_in=data.tokens_in,
            tokens_out=data.tokens_out,
            cost=Decimal(str(data.cost)) if data.cost is not None else None,
            duration_ms=data.duration_ms,
            model=data.model,
        )
        await ingestion_service.ingest(event)
        return SessionEventResponse.from_event(event)

    @router.post(
        "/events/batch",
        response_model=list[SessionEventResponse],
        status_code=status.HTTP_201_CREATED,
        tags=["Events"],
    )
    async def ingest_event_batch(data: EventBatchRequest) -> list[SessionEventResponse]:
        """Ingest a batch of session events into the pipeline."""
        events: list[SessionEvent] = []
        for item in data.events:
            try:
                event_type = SessionEventType(item.event_type)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid event_type: {item.event_type}",
                )
            events.append(
                SessionEvent(
                    id=uuid4(),
                    session_id=item.session_id,
                    event_type=event_type,
                    timestamp=item.timestamp,
                    data=item.data,
                    sequence=item.sequence,
                    tokens_in=item.tokens_in,
                    tokens_out=item.tokens_out,
                    cost=Decimal(str(item.cost)) if item.cost is not None else None,
                    duration_ms=item.duration_ms,
                    model=item.model,
                )
            )
        await ingestion_service.ingest_batch(events)
        return [SessionEventResponse.from_event(e) for e in events]

    @router.get(
        "/sessions/{session_id}/events",
        response_model=list[SessionEventResponse],
        tags=["Events"],
    )
    async def get_session_events(
        session_id: UUID,
        event_type: str | None = Query(default=None),
        after: datetime | None = Query(default=None),
        before: datetime | None = Query(default=None),
        limit: int = Query(default=200, ge=1, le=2000),
        offset: int = Query(default=0, ge=0),
    ) -> list[SessionEventResponse]:
        """Query events for a session."""
        types = None
        if event_type:
            try:
                types = [SessionEventType(event_type)]
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid event_type: {event_type}",
                )
        events = await event_repository.get_events(
            session_id,
            event_types=types,
            after=after,
            before=before,
            limit=limit,
            offset=offset,
        )
        return [SessionEventResponse.from_event(e) for e in events]

    @router.get(
        "/sessions/{session_id}/events/counts",
        response_model=dict[str, int],
        tags=["Events"],
    )
    async def get_event_counts(session_id: UUID) -> dict[str, int]:
        """Get event type counts for a session."""
        return await event_repository.get_event_counts(session_id)

    @router.get(
        "/sessions/{session_id}/events/tokens",
        response_model=list[dict],
        tags=["Events"],
    )
    async def get_token_timeline(
        session_id: UUID,
        bucket_seconds: int = Query(default=300, ge=60, le=3600),
    ) -> list[dict]:
        """Get token burn timeline for a session."""
        return await event_repository.get_token_timeline(session_id, bucket_seconds)

    @router.get("/events/health", response_model=SinkHealthResponse, tags=["Events"])
    async def get_sink_health() -> SinkHealthResponse:
        """Get health status of all event sinks."""
        return SinkHealthResponse(sinks=ingestion_service.sink_health())

    return router
