"""Tests for the HTTP gateway adapter."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from ravn.adapters.channels.gateway import RavnGateway
from ravn.adapters.channels.gateway_http import ChatRequest, HttpGateway
from ravn.config import HttpChannelConfig
from ravn.domain.events import RavnEvent

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_http_config(host: str = "127.0.0.1", port: int = 7477) -> HttpChannelConfig:
    return HttpChannelConfig(enabled=True, host=host, port=port)


def _make_gateway_mock(response: str = "agent reply") -> RavnGateway:
    """Return a mock RavnGateway that returns a canned response."""
    gw = MagicMock(spec=RavnGateway)
    gw.session_ids.return_value = ["http:default"]

    async def handle_stream(session_id: str, message: str) -> AsyncIterator[RavnEvent]:
        yield RavnEvent.thought("thinking...")
        yield RavnEvent.response(response)

    gw.handle_message_stream = handle_stream

    async def broadcast_stream():
        yield RavnEvent.response("broadcast")

    q: asyncio.Queue = asyncio.Queue()
    gw.subscribe.return_value = q
    gw.unsubscribe = MagicMock()
    return gw


def _make_http_gateway(gw: RavnGateway | None = None) -> HttpGateway:
    if gw is None:
        gw = _make_gateway_mock()
    return HttpGateway(_make_http_config(), gw)


def _get_test_client(gateway: HttpGateway | None = None) -> TestClient:
    gw_obj = _make_http_gateway(gateway)
    return TestClient(gw_obj.app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------


def test_status_endpoint_returns_session_info():
    client = _get_test_client()
    resp = client.get("/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "session_count" in data
    assert "active_sessions" in data
    assert data["session_count"] == 1


def test_status_endpoint_no_sessions():
    gw = MagicMock(spec=RavnGateway)
    gw.session_ids.return_value = []
    ht = HttpGateway(_make_http_config(), gw)
    client = TestClient(ht.app)
    resp = client.get("/status")
    assert resp.status_code == 200
    assert resp.json()["session_count"] == 0


# ---------------------------------------------------------------------------
# POST /chat
# ---------------------------------------------------------------------------


def test_chat_endpoint_returns_sse_stream():
    client = _get_test_client()
    resp = client.post(
        "/chat",
        json={"message": "hello", "session_id": "http:default"},
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_chat_endpoint_streams_events():
    client = _get_test_client()
    resp = client.post(
        "/chat",
        json={"message": "hello"},
    )
    body = resp.text
    # Should contain SSE data lines
    assert "data: " in body
    lines = [ln for ln in body.splitlines() if ln.startswith("data: ")]
    assert len(lines) >= 1

    # Each line must be valid JSON
    for line in lines:
        payload = json.loads(line[len("data: ") :])
        assert "type" in payload
        assert "data" in payload


def test_chat_endpoint_includes_thought_and_response():
    client = _get_test_client()
    resp = client.post("/chat", json={"message": "hi"})

    lines = [ln for ln in resp.text.splitlines() if ln.startswith("data: ")]
    types = [json.loads(ln[len("data: ") :])["type"] for ln in lines]

    assert "thought" in types
    assert "response" in types


def test_chat_endpoint_default_session_id():
    """Omitting session_id uses 'http:default'."""
    gw = MagicMock(spec=RavnGateway)
    gw.session_ids.return_value = []

    async def handle_stream(session_id: str, message: str) -> AsyncIterator[RavnEvent]:
        assert session_id == "http:default"
        yield RavnEvent.response("ok")

    gw.handle_message_stream = handle_stream

    ht = HttpGateway(_make_http_config(), gw)
    client = TestClient(ht.app)
    resp = client.post("/chat", json={"message": "hi"})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /events
# ---------------------------------------------------------------------------


def test_events_endpoint_returns_sse():
    """GET /events returns text/event-stream with correct SSE framing."""
    gw = MagicMock(spec=RavnGateway)

    ht = HttpGateway(_make_http_config(), gw)

    # Patch _broadcast_stream to yield one event and return so the
    # TestClient receives a finite response instead of blocking forever.
    async def finite_broadcast():
        payload = '{"type": "response", "data": "hi", "metadata": {}}'
        yield f"data: {payload}\n\n"

    ht._broadcast_stream = finite_broadcast

    client = TestClient(ht.app)
    resp = client.get("/events")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    assert "data: " in resp.text


# ---------------------------------------------------------------------------
# HttpGateway.app property
# ---------------------------------------------------------------------------


def test_app_property_returns_fastapi_app():
    from fastapi import FastAPI

    ht = _make_http_gateway()
    assert isinstance(ht.app, FastAPI)


# ---------------------------------------------------------------------------
# ChatRequest schema
# ---------------------------------------------------------------------------


def test_chat_request_default_session_id():
    req = ChatRequest(message="hi")
    assert req.session_id == "http:default"


def test_chat_request_custom_session_id():
    req = ChatRequest(message="hi", session_id="my-session")
    assert req.session_id == "my-session"


# ---------------------------------------------------------------------------
# SSE format helpers
# ---------------------------------------------------------------------------


def test_sse_payload_contains_metadata():
    """Verify metadata field is present in streamed events."""
    client = _get_test_client()
    resp = client.post("/chat", json={"message": "hi"})

    lines = [ln for ln in resp.text.splitlines() if ln.startswith("data: ")]
    for line in lines:
        payload = json.loads(line[len("data: ") :])
        assert "metadata" in payload
