"""Observatory FastAPI app and route handlers."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, FastAPI
from fastapi.responses import StreamingResponse

from observatory.data import get_events, get_registry, get_topology_snapshot

KEEPALIVE_INTERVAL = 15.0


def _to_sse(payload: object, *, event: str | None = None) -> str:
    """Serialize a payload as one SSE frame."""
    lines: list[str] = []
    if event:
        lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(payload, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


async def _topology_stream() -> AsyncGenerator[str, None]:
    """Yield an initial topology snapshot followed by keepalive comments."""
    yield _to_sse(get_topology_snapshot(), event="topology.snapshot")
    while True:
        await asyncio.sleep(KEEPALIVE_INTERVAL)
        yield ": keepalive\n\n"


async def _events_stream() -> AsyncGenerator[str, None]:
    """Replay recent events once per subscriber, then keep the stream open."""
    for item in get_events():
        yield _to_sse(item, event="observatory.event")
    while True:
        await asyncio.sleep(KEEPALIVE_INTERVAL)
        yield ": keepalive\n\n"


def create_router() -> APIRouter:
    """Create the Observatory API router."""
    router = APIRouter(prefix="/api/v1/observatory", tags=["Observatory"])

    @router.get("/registry", summary="Get the observatory type registry")
    async def registry() -> dict[str, object]:
        return get_registry()

    @router.get("/topology", summary="Stream live topology snapshots")
    @router.get("/topology/stream", summary="Stream live topology snapshots")
    async def topology() -> StreamingResponse:
        return StreamingResponse(
            _topology_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.get("/events", summary="Stream observatory events")
    @router.get("/events/stream", summary="Stream observatory events")
    async def events() -> StreamingResponse:
        return StreamingResponse(
            _events_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router


def create_app() -> FastAPI:
    """Create the Observatory ASGI app."""
    app = FastAPI(title="Observatory API")
    app.include_router(create_router())
    return app

