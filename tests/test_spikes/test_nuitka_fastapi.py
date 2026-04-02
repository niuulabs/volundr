"""Tests for the Nuitka + FastAPI validation spike (NIU-398).

Validates REST, SSE, and WebSocket endpoints behave correctly before
compilation — the same assertions can be run against the compiled binary.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient

# Make the spikes package importable from the repo root.
_repo_root = str(Path(__file__).resolve().parents[2])
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from spikes.nuitka_fastapi.app import (  # noqa: E402, I001
    SSE_EVENT_COUNT,
    ReverseRequest,
    ReverseResponse,
    app,
)


# ---------------------------------------------------------------------------
# REST: GET /health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# REST: GET /api/echo
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_echo_default() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/echo")

    assert resp.status_code == 200
    assert resp.json() == {"echo": "hello"}


@pytest.mark.asyncio
async def test_echo_custom_msg() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/echo", params={"msg": "nuitka"})

    assert resp.status_code == 200
    assert resp.json() == {"echo": "nuitka"}


# ---------------------------------------------------------------------------
# REST: POST /api/reverse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reverse() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/reverse", json={"text": "hello"})

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"reversed": "olleh"}


@pytest.mark.asyncio
async def test_reverse_empty_string() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/reverse", json={"text": ""})

    assert resp.status_code == 200
    assert resp.json() == {"reversed": ""}


@pytest.mark.asyncio
async def test_reverse_validation_error() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/reverse", json={})

    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# SSE: GET /api/sse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sse_stream() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sse")

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]

    # Parse SSE frames
    lines = resp.text.strip().split("\n\n")
    events = []
    for line in lines:
        if line.startswith("data: "):
            payload = json.loads(line.removeprefix("data: "))
            events.append(payload)

    assert len(events) == SSE_EVENT_COUNT
    for i, event in enumerate(events):
        assert event["event"] == i
        assert event["total"] == SSE_EVENT_COUNT


@pytest.mark.asyncio
async def test_sse_headers() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sse")

    assert resp.headers.get("cache-control") == "no-cache"
    assert resp.headers.get("x-accel-buffering") == "no"


# ---------------------------------------------------------------------------
# WebSocket: /ws/echo
# ---------------------------------------------------------------------------


def test_websocket_echo() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/echo") as ws:
        ws.send_text("hello")
        data = ws.receive_text()
        assert data == "echo: hello"

        ws.send_text("nuitka works!")
        data = ws.receive_text()
        assert data == "echo: nuitka works!"


def test_websocket_multiple_messages() -> None:
    client = TestClient(app)
    with client.websocket_connect("/ws/echo") as ws:
        messages = ["first", "second", "third"]
        for msg in messages:
            ws.send_text(msg)
            resp = ws.receive_text()
            assert resp == f"echo: {msg}"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


def test_reverse_request_model() -> None:
    req = ReverseRequest(text="abc")
    assert req.text == "abc"


def test_reverse_response_model() -> None:
    resp = ReverseResponse(reversed="cba")
    assert resp.reversed == "cba"


# ---------------------------------------------------------------------------
# Entry point module
# ---------------------------------------------------------------------------


def test_main_module_importable() -> None:
    """Verify __main__.py can be imported without starting the server."""
    from spikes.nuitka_fastapi.__main__ import main  # noqa: F401

    # Just verify it's callable — don't actually start uvicorn
    assert callable(main)
