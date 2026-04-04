"""Integration tests for Volundr SSE event streaming.

Verifies that ``GET /api/v1/volundr/sessions/stream`` delivers real-time
Server-Sent Events when sessions are created or stats are broadcast.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

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


async def _collect_sse(
    app: object,
    n: int = 1,
    timeout: float = SSE_TIMEOUT,
) -> list[dict[str, str]]:
    """Open a fresh SSE connection and collect *n* events.

    Uses a dedicated ``httpx.AsyncClient`` to avoid interfering with the
    session-scoped client used by other tests.
    """
    collected: list[dict[str, str]] = []
    transport = httpx.ASGITransport(app=app)  # type: ignore[arg-type]

    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        async with client.stream("GET", SSE_URL) as response:
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


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


async def test_sse_stream_connects(volundr_app: object) -> None:
    """GET /sessions/stream returns 200 with SSE content-type headers.

    Publishes a heartbeat so the stream has at least one event to yield,
    then verifies response headers and that data is received.
    """
    broadcaster = volundr_app.state.broadcaster  # type: ignore[union-attr]

    async def _publish_heartbeat() -> None:
        # Small delay so the subscriber is registered before we publish
        await asyncio.sleep(0.1)
        await broadcaster.publish_heartbeat()

    publish_task = asyncio.create_task(_publish_heartbeat())

    events = await asyncio.wait_for(_collect_sse(volundr_app, n=1), timeout=SSE_TIMEOUT)
    await publish_task

    assert len(events) >= 1
    assert events[0]["event"] == EventType.HEARTBEAT.value


async def test_sse_receives_session_created_event(
    volundr_app: object,
    volundr_client: httpx.AsyncClient,
    auth_headers: object,
) -> None:
    """Connect SSE, create a session via POST, verify SESSION_CREATED event."""
    headers = auth_headers("sse-user", "sse@test.com", "default", ["volundr:admin"])  # type: ignore[operator]

    async def _create_session() -> None:
        await asyncio.sleep(0.15)
        payload = {
            "name": "sse-test-session",
            "model": "claude-sonnet-4-6",
            "source": {"type": "git", "repo": "github.com/acme/demo", "branch": "main"},
        }
        resp = await volundr_client.post(f"{API}/sessions", json=payload, headers=headers)
        assert resp.status_code == 201, resp.text

    create_task = asyncio.create_task(_create_session())

    events = await asyncio.wait_for(_collect_sse(volundr_app, n=1), timeout=SSE_TIMEOUT)
    await create_task

    assert len(events) >= 1
    session_events = [e for e in events if e["event"] == EventType.SESSION_CREATED.value]
    assert len(session_events) >= 1

    data = json.loads(session_events[0]["data"])
    assert data["name"] == "sse-test-session"
    assert "id" in data


async def test_sse_receives_stats_update(volundr_app: object) -> None:
    """Publish a stats event through the broadcaster, verify SSE delivers it."""
    from datetime import datetime

    broadcaster = volundr_app.state.broadcaster  # type: ignore[union-attr]

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
        timestamp=datetime.utcnow(),
    )

    async def _publish_stats() -> None:
        await asyncio.sleep(0.1)
        await broadcaster.publish(stats_event)

    publish_task = asyncio.create_task(_publish_stats())

    events = await asyncio.wait_for(_collect_sse(volundr_app, n=1), timeout=SSE_TIMEOUT)
    await publish_task

    assert len(events) >= 1
    stats_events = [e for e in events if e["event"] == EventType.STATS_UPDATED.value]
    assert len(stats_events) >= 1

    data = json.loads(stats_events[0]["data"])
    assert data["tokens_today"] == 5000
    assert data["active_sessions"] == 3
    assert data["cost_today"] == 1.25
