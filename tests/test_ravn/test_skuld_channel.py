"""Tests for SkuldChannel — WebSocket delivery channel."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from ravn.adapters.channels.skuld_channel import SkuldChannel
from ravn.domain.events import RavnEvent, RavnEventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_channel(broker_url: str = "ws://localhost:9000/ws/ravn/test") -> SkuldChannel:
    return SkuldChannel(
        broker_url=broker_url,
        session_id="test-session",
        reconnect_delay=0.0,
        max_reconnect_attempts=1,
    )


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------


def test_serialise_response_event():
    ch = _make_channel()
    event = RavnEvent.response("Hello!")
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "response"
    assert data["data"] == "Hello!"
    assert data["session_id"] == "test-session"
    assert "metadata" in data


def test_serialise_tool_start_event():
    ch = _make_channel()
    event = RavnEvent.tool_start("BashTool", {"command": "ls"})
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "tool_start"
    assert data["data"] == "BashTool"
    assert data["metadata"]["input"] == {"command": "ls"}


def test_serialise_error_event():
    ch = _make_channel()
    event = RavnEvent.error("boom")
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "error"
    assert data["data"] == "boom"


def test_serialise_ends_with_newline():
    ch = _make_channel()
    line = ch._serialise(RavnEvent.response("hi"))
    assert line.endswith("\n")


# ---------------------------------------------------------------------------
# emit — happy path with mocked WebSocket
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_emit_sends_serialised_payload():
    ch = _make_channel()
    mock_ws = AsyncMock()
    mock_ws.closed = False
    ch._ws = mock_ws

    await ch.emit(RavnEvent.response("test response"))

    mock_ws.send.assert_awaited_once()
    sent = mock_ws.send.call_args[0][0]
    data = json.loads(sent.strip())
    assert data["data"] == "test response"


@pytest.mark.asyncio
async def test_emit_buffers_event_on_failure():
    ch = _make_channel()

    # Make _send raise to trigger buffering.
    async def _fail(payload: str) -> None:
        raise RuntimeError("connection refused")

    ch._send = _fail  # type: ignore[method-assign]

    await ch.emit(RavnEvent.thought("thinking"))

    assert len(ch._buffer) == 1
    assert ch._buffer[0].type == RavnEventType.THOUGHT


# ---------------------------------------------------------------------------
# flush_buffer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flush_buffer_sends_buffered_events():
    ch = _make_channel()
    ch._buffer = [RavnEvent.response("buffered")]

    mock_ws = AsyncMock()
    mock_ws.closed = False
    ch._ws = mock_ws

    await ch.flush_buffer()

    assert ch._buffer == []
    mock_ws.send.assert_awaited_once()


@pytest.mark.asyncio
async def test_flush_buffer_noop_when_empty():
    ch = _make_channel()
    mock_ws = AsyncMock()
    ch._ws = mock_ws

    await ch.flush_buffer()

    mock_ws.send.assert_not_awaited()


# ---------------------------------------------------------------------------
# disconnect
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disconnect_closes_websocket():
    ch = _make_channel()
    mock_ws = AsyncMock()
    ch._ws = mock_ws

    await ch.disconnect()

    mock_ws.close.assert_awaited_once()
    assert ch._ws is None


@pytest.mark.asyncio
async def test_disconnect_noop_when_not_connected():
    ch = _make_channel()
    assert ch._ws is None
    await ch.disconnect()  # Should not raise


# ---------------------------------------------------------------------------
# connect — exhausts retries gracefully
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_connect_logs_and_gives_up_after_max_retries():
    ch = _make_channel()

    with patch("ravn.adapters.channels.skuld_channel.websockets.connect") as mock_conn:
        mock_conn.side_effect = OSError("refused")
        await ch.connect()

    # After exhausting retries, ws remains None.
    assert ch._ws is None
