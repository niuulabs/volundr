"""Tests for SkuldChannel — WebSocket delivery channel."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from ravn.adapters.channels.skuld_channel import SkuldChannel
from ravn.domain.events import RavnEvent, RavnEventType

_SRC = "ravn-test"
_CID = "corr-1"
_SID = "sess-1"

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
    event = RavnEvent.response(_SRC, "Hello!", _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "response"
    assert data["data"] == "Hello!"
    assert data["session_id"] == "test-session"
    assert "metadata" in data


def test_serialise_tool_start_event():
    ch = _make_channel()
    event = RavnEvent.tool_start(_SRC, "BashTool", {"command": "ls"}, _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "tool_start"
    assert data["data"] == "BashTool"
    assert data["metadata"]["input"] == {"command": "ls"}


def test_serialise_error_event():
    ch = _make_channel()
    event = RavnEvent.error(_SRC, "boom", _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "error"
    assert data["data"] == "boom"


def test_serialise_thought_event():
    ch = _make_channel()
    event = RavnEvent.thought(_SRC, "thinking...", _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "thought"
    assert data["data"] == "thinking..."
    assert data["metadata"] == {}


def test_serialise_thinking_event():
    ch = _make_channel()
    event = RavnEvent.thinking(_SRC, "deep thought", _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "thought"
    assert data["data"] == "deep thought"
    assert data["metadata"]["thinking"] is True


def test_serialise_tool_result_event():
    ch = _make_channel()
    event = RavnEvent.tool_result(_SRC, "echo", "output", _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "tool_result"
    assert data["data"] == "output"
    assert data["metadata"]["tool_name"] == "echo"
    assert data["metadata"]["is_error"] is False


def test_serialise_tool_start_with_diff():
    ch = _make_channel()
    event = RavnEvent.tool_start(_SRC, "Edit", {"file": "a.py"}, _CID, _SID, diff="- old\n+ new")
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["metadata"]["diff"] == "- old\n+ new"


def test_serialise_ends_with_newline():
    ch = _make_channel()
    line = ch._serialise(RavnEvent.response(_SRC, "hi", _CID, _SID))
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

    await ch.emit(RavnEvent.response(_SRC, "test response", _CID, _SID))

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

    await ch.emit(RavnEvent.thought(_SRC, "thinking", _CID, _SID))

    assert len(ch._buffer) == 1
    assert ch._buffer[0].type == RavnEventType.THOUGHT


# ---------------------------------------------------------------------------
# flush_buffer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flush_buffer_sends_buffered_events():
    ch = _make_channel()
    ch._buffer = [RavnEvent.response(_SRC, "buffered", _CID, _SID)]

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


# ---------------------------------------------------------------------------
# source / persona fields (NIU-602)
# ---------------------------------------------------------------------------


def test_serialise_includes_source_when_peer_id_provided():
    ch = SkuldChannel(
        broker_url="ws://localhost:9000/ws/ravn/p1",
        session_id="sess-1",
        peer_id="ravn-agent-1",
    )
    line = ch._serialise(RavnEvent.response(_SRC, "Hello", _CID, _SID))
    data = json.loads(line.strip())
    assert data["source"] == "ravn-agent-1"


def test_serialise_includes_persona_when_provided():
    ch = SkuldChannel(
        broker_url="ws://localhost:9000/ws/ravn/p1",
        session_id="sess-1",
        peer_id="ravn-agent-1",
        persona="Aria",
    )
    line = ch._serialise(RavnEvent.response(_SRC, "Hello", _CID, _SID))
    data = json.loads(line.strip())
    assert data["persona"] == "Aria"


def test_serialise_omits_source_when_peer_id_not_provided():
    ch = _make_channel()  # no peer_id
    line = ch._serialise(RavnEvent.response(_SRC, "Hello", _CID, _SID))
    data = json.loads(line.strip())
    assert "source" not in data


def test_serialise_omits_persona_when_not_provided():
    ch = _make_channel()  # no persona
    line = ch._serialise(RavnEvent.response(_SRC, "Hello", _CID, _SID))
    data = json.loads(line.strip())
    assert "persona" not in data


def test_serialise_with_peer_id_preserves_existing_fields():
    ch = SkuldChannel(
        broker_url="ws://localhost:9000/ws/ravn/p1",
        session_id="sess-2",
        peer_id="agent-x",
        persona="Ravn",
    )
    event = RavnEvent.tool_start(_SRC, "BashTool", {"command": "ls"}, _CID, _SID)
    line = ch._serialise(event)
    data = json.loads(line.strip())
    assert data["type"] == "tool_start"
    assert data["data"] == "BashTool"
    assert data["session_id"] == "sess-2"
    assert data["source"] == "agent-x"
    assert data["persona"] == "Ravn"
