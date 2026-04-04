"""Integration tests for Volundr SSE event streaming.

Verifies that ``GET /api/v1/volundr/sessions/stream`` delivers real-time
Server-Sent Events when sessions are created or stats are broadcast.

Uses a real HTTP server (uvicorn) because httpx's ``ASGITransport``
buffers the entire response body before returning, which deadlocks with
infinite SSE generators.
"""

from __future__ import annotations

import asyncio
import json
import socket

import httpx
import pytest
import uvicorn

from volundr.domain.models import EventType, RealtimeEvent

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio(loop_scope="session"),
]

API = "/api/v1/volundr"
SSE_URL = f"{API}/sessions/stream"

# Timeout for SSE event collection (seconds)
SSE_TIMEOUT = 5


def _parse_sse_events(raw: str) -> list[dict[str, str]]:
    """Parse raw SSE text into a list of field dicts.

    Each SSE message is separated by a blank line (``\\n\\n``).
    Within a message, lines are ``field: value``.
    """
    events: list[dict[str, str]] = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        fields: dict[str, str] = {}
        for line in block.split("\n"):
            if ": " in line:
                key, value = line.split(": ", 1)
                fields[key] = value
        if fields:
            events.append(fields)
    return events


def _free_port() -> int:
    """Find an available TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _collect_sse(
    base_url: str,
    path: str,
    n: int = 1,
    headers: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    """Connect to a real HTTP SSE endpoint and collect *n* events."""
    collected: list[dict[str, str]] = []

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "GET",
            f"{base_url}{path}",
            headers=headers or {},
            timeout=SSE_TIMEOUT,
        ) as response:
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    raw, buffer = buffer.split("\n\n", 1)
                    parsed = _parse_sse_events(raw + "\n\n")
                    collected.extend(parsed)
                    if len(collected) >= n:
                        return collected
    return collected


async def _start_server(app: object) -> tuple[uvicorn.Server, str]:
    """Start a uvicorn server and return (server, base_url)."""
    port = _free_port()
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    asyncio.create_task(server.serve())

    # Wait for server to start
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)

    return server, f"http://127.0.0.1:{port}"


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


async def test_sse_stream_connects(volundr_app: object) -> None:
    """GET /sessions/stream returns 200 with SSE content-type headers.

    Publishes a heartbeat so the stream has at least one event to yield,
    then verifies response headers and that data is received.
    """
    broadcaster = volundr_app.state.broadcaster  # type: ignore[union-attr]
    server, base_url = await _start_server(volundr_app)

    try:

        async def _publish_heartbeat() -> None:
            await asyncio.sleep(0.3)
            await broadcaster.publish_heartbeat()

        publish_task = asyncio.create_task(_publish_heartbeat())

        events = await asyncio.wait_for(
            _collect_sse(base_url, SSE_URL, n=1),
            timeout=SSE_TIMEOUT,
        )
        await publish_task

        assert len(events) >= 1
        assert events[0]["event"] == EventType.HEARTBEAT.value
    finally:
        server.should_exit = True
        await asyncio.sleep(0.1)


async def test_sse_receives_session_created_event(
    volundr_app: object,
    auth_headers: object,
) -> None:
    """Connect SSE, create a session via POST, verify SESSION_CREATED event."""
    headers = auth_headers("sse-user", "sse@test.com", "default", ["volundr:admin"])  # type: ignore[operator]
    server, base_url = await _start_server(volundr_app)

    try:

        async def _create_session() -> None:
            await asyncio.sleep(0.3)
            payload = {
                "name": "sse-test-session",
                "model": "claude-sonnet-4-6",
                "source": {
                    "type": "git",
                    "repo": "github.com/acme/demo",
                    "branch": "main",
                },
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{base_url}{API}/sessions",
                    json=payload,
                    headers=headers,
                )
                assert resp.status_code == 201, resp.text

        create_task = asyncio.create_task(_create_session())

        events = await asyncio.wait_for(
            _collect_sse(base_url, SSE_URL, n=1),
            timeout=SSE_TIMEOUT,
        )
        await create_task

        assert len(events) >= 1
        session_events = [e for e in events if e["event"] == EventType.SESSION_CREATED.value]
        assert len(session_events) >= 1

        data = json.loads(session_events[0]["data"])
        assert data["name"] == "sse-test-session"
        assert "id" in data
    finally:
        server.should_exit = True
        await asyncio.sleep(0.1)


async def test_sse_receives_stats_update(volundr_app: object) -> None:
    """Publish a stats event through the broadcaster, verify SSE delivers it."""
    from datetime import UTC, datetime

    broadcaster = volundr_app.state.broadcaster  # type: ignore[union-attr]
    server, base_url = await _start_server(volundr_app)

    try:
        stats_event = RealtimeEvent(
            type=EventType.STATS_UPDATED,
            data={
                "active_sessions": 3,
                "total_sessions": 10,
                "tokens_today": 5000,
                "local_tokens": 1000,
                "cloud_tokens": 4000,
                "cost_today": 1.25,
            },
            timestamp=datetime.now(UTC),
        )

        async def _publish_stats() -> None:
            await asyncio.sleep(0.3)
            await broadcaster.publish(stats_event)

        publish_task = asyncio.create_task(_publish_stats())

        events = await asyncio.wait_for(
            _collect_sse(base_url, SSE_URL, n=1),
            timeout=SSE_TIMEOUT,
        )
        await publish_task

        assert len(events) >= 1
        stats_events = [e for e in events if e["event"] == EventType.STATS_UPDATED.value]
        assert len(stats_events) >= 1

        data = json.loads(stats_events[0]["data"])
        assert data["tokens_today"] == 5000
        assert data["active_sessions"] == 3
        assert data["cost_today"] == 1.25
    finally:
        server.should_exit = True
        await asyncio.sleep(0.1)
