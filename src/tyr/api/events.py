"""SSE event stream for real-time Tyr updates.

GET /api/v1/tyr/events — streams :class:`~tyr.events.TyrEvent` objects as
standard Server-Sent Events.  On connect, the current state snapshot is pushed
immediately so the UI can hydrate without a separate REST call.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from tyr.events import EventBus, TyrEvent

logger = logging.getLogger(__name__)


async def resolve_event_bus() -> EventBus:  # pragma: no cover
    """Dependency stub — always overridden by the app lifespan in main.py."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Event bus not configured",
    )


async def _sse_generator(
    event_bus: EventBus,
    q: asyncio.Queue[TyrEvent],
    keepalive_interval: float,
) -> AsyncGenerator[str, None]:
    """Async generator that streams SSE messages.

    Yields the current state snapshot immediately, then relays events from *q*.
    Sends an SSE comment keepalive after ``keepalive_interval`` idle seconds.
    Calls ``event_bus.unsubscribe(q)`` in a finally block so the queue is
    always cleaned up on disconnect or error.
    """
    try:
        for snapshot_event in event_bus.get_snapshot():
            yield snapshot_event.to_sse()

        while True:
            try:
                event: TyrEvent = await asyncio.wait_for(
                    q.get(), timeout=keepalive_interval
                )
                yield event.to_sse()
            except TimeoutError:
                yield ": keepalive\n\n"
    finally:
        event_bus.unsubscribe(q)
        logger.debug(
            "SSE client disconnected; remaining clients: %d",
            event_bus.client_count,
        )


def create_events_router(keepalive_interval: float = 15.0) -> APIRouter:
    """Return an APIRouter with the ``GET /api/v1/tyr/events`` SSE endpoint.

    Args:
        keepalive_interval: Seconds between SSE keepalive comments when no
            events are queued.  Configurable so tests can use a short value.
    """
    router = APIRouter(prefix="/api/v1/tyr", tags=["Events"])

    @router.get("/events", summary="SSE event stream")
    async def sse_stream(
        request: Request,  # noqa: ARG001
        event_bus: EventBus = Depends(resolve_event_bus),
    ) -> StreamingResponse:
        """Stream all real-time Tyr state changes as Server-Sent Events.

        The client receives a state snapshot immediately on connect, followed
        by live events as they are emitted.  The connection is kept alive with
        SSE comment lines when idle.
        """
        if event_bus.at_capacity:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"SSE client limit reached ({event_bus.client_count})",
            )

        # Subscribe *before* creating the response so that events emitted
        # between "route handler called" and "generator starts" are not lost.
        q = event_bus.subscribe()

        return StreamingResponse(
            _sse_generator(event_bus, q, keepalive_interval),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router
