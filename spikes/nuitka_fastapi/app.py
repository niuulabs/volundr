"""Minimal FastAPI app for validating Nuitka --onefile compilation.

Endpoints:
  GET  /health          — liveness probe
  GET  /api/echo?msg=x  — echo query param
  POST /api/reverse     — reverse a JSON string
  GET  /api/sse         — SSE stream of numbered events
  WS   /ws/echo         — WebSocket echo server
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="nuitka-fastapi-spike", version="0.1.0")

SSE_EVENT_COUNT = 5
SSE_DELAY_SECONDS = 0.1


class ReverseRequest(BaseModel):
    text: str


class ReverseResponse(BaseModel):
    reversed: str


# -- REST endpoints -----------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/echo")
async def echo(msg: str = Query(default="hello")) -> dict[str, str]:
    return {"echo": msg}


@app.post("/api/reverse", response_model=ReverseResponse)
async def reverse(body: ReverseRequest) -> ReverseResponse:
    return ReverseResponse(reversed=body.text[::-1])


# -- SSE endpoint -------------------------------------------------------------


async def _sse_generator(count: int, delay: float) -> AsyncGenerator[str, None]:
    for i in range(count):
        payload = json.dumps({"event": i, "total": count})
        yield f"data: {payload}\n\n"
        if i < count - 1:
            await asyncio.sleep(delay)


@app.get("/api/sse")
async def sse_stream() -> StreamingResponse:
    return StreamingResponse(
        _sse_generator(SSE_EVENT_COUNT, SSE_DELAY_SECONDS),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# -- WebSocket endpoint -------------------------------------------------------


@app.websocket("/ws/echo")
async def ws_echo(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"echo: {data}")
    except WebSocketDisconnect:
        pass
