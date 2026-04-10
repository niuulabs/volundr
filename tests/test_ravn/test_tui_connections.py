"""Unit tests for Ravn TUI connections — FlokkManager and RavnConnection."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.tui.connections import FlokkManager, RavnConnection, _parse_sse_block

# ---------------------------------------------------------------------------
# RavnConnection
# ---------------------------------------------------------------------------


def test_ravn_connection_defaults() -> None:
    conn = RavnConnection(name="test", host="localhost", port=7477)
    assert conn.status == "disconnected"
    assert conn.ghost is False
    assert conn.last_event is None


def test_ravn_connection_base_url() -> None:
    conn = RavnConnection(name="t1", host="myhost", port=8080)
    assert conn.base_url == "http://myhost:8080"


def test_ravn_connection_ws_url() -> None:
    conn = RavnConnection(name="t1", host="myhost", port=8080)
    assert conn.ws_url == "ws://myhost:8080/ws"


def test_ravn_connection_sse_url() -> None:
    conn = RavnConnection(name="t1", host="myhost", port=8080)
    assert conn.sse_url == "http://myhost:8080/events"


def test_ravn_connection_to_dict() -> None:
    conn = RavnConnection(name="test", host="localhost", port=7477, ghost=True)
    d = conn.to_dict()
    assert d["name"] == "test"
    assert d["host"] == "localhost"
    assert d["port"] == 7477
    assert d["ghost"] is True


def test_ravn_connection_event_callback() -> None:
    conn = RavnConnection(name="test", host="localhost", port=7477)
    received = []
    conn.on_event(lambda c, e: received.append((c, e)))
    conn._emit_event({"event": "thought", "data": {"text": "hello"}})
    assert len(received) == 1
    assert received[0][0] is conn


def test_ravn_connection_message_callback() -> None:
    conn = RavnConnection(name="test", host="localhost", port=7477)
    received = []
    conn.on_message(lambda c, m: received.append(m))
    conn._emit_message({"type": "response", "content": "hi"})
    assert len(received) == 1


def test_ravn_connection_callback_error_doesnt_crash() -> None:
    conn = RavnConnection(name="test", host="localhost", port=7477)

    def bad_cb(c: object, e: object) -> None:
        raise ValueError("test error")

    conn.on_event(bad_cb)
    # Should not raise
    conn._emit_event({"event": "test"})


# ---------------------------------------------------------------------------
# _parse_sse_block
# ---------------------------------------------------------------------------


def test_parse_sse_block_simple() -> None:
    block = 'event: thought\ndata: {"text": "hello"}'
    result = _parse_sse_block(block)
    assert result is not None
    assert result["event"] == "thought"
    assert result["data"] == {"text": "hello"}


def test_parse_sse_block_data_only() -> None:
    block = 'data: {"key": "value"}'
    result = _parse_sse_block(block)
    assert result is not None
    assert result["data"] == {"key": "value"}


def test_parse_sse_block_plain_data() -> None:
    block = "data: hello world"
    result = _parse_sse_block(block)
    assert result is not None
    assert result["data"] == "hello world"


def test_parse_sse_block_empty() -> None:
    result = _parse_sse_block("")
    assert result is None


def test_parse_sse_block_comment_only() -> None:
    result = _parse_sse_block(": keep-alive")
    assert result is None


# ---------------------------------------------------------------------------
# FlokkManager
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flokka_manager_connect_returns_connection() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        conn = await manager.connect("localhost", 7477)

    assert conn.host == "localhost"
    assert conn.port == 7477
    assert conn.name == "localhost:7477"


@pytest.mark.asyncio
async def test_flokka_manager_connect_idempotent() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        conn1 = await manager.connect("localhost", 7477)
        conn2 = await manager.connect("localhost", 7477)

    assert conn1 is conn2


@pytest.mark.asyncio
async def test_flokka_manager_disconnect_removes_connection() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        await manager.connect("localhost", 7477)

    assert len(manager.connections()) == 1

    await manager.disconnect("localhost:7477")
    assert len(manager.connections()) == 0


@pytest.mark.asyncio
async def test_flokka_manager_disconnect_nonexistent_is_noop() -> None:
    manager = FlokkManager()
    await manager.disconnect("not-there")  # should not raise


@pytest.mark.asyncio
async def test_flokka_manager_get() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        conn = await manager.connect("myhost", 9999)

    found = manager.get("myhost:9999")
    assert found is conn
    assert manager.get("no-such") is None


@pytest.mark.asyncio
async def test_flokka_manager_connections_snapshot() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        await manager.connect("host1", 7477)
        await manager.connect("host2", 7477)

    conns = manager.connections()
    assert len(conns) == 2
    names = {c.name for c in conns}
    assert "host1:7477" in names
    assert "host2:7477" in names


@pytest.mark.asyncio
async def test_flokka_manager_ghost_mode() -> None:
    manager = FlokkManager()

    # Ghost mode should NOT call _fetch_info
    fetch_info = AsyncMock()
    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=fetch_info),
    ):
        conn = await manager.connect("localhost", 7477, ghost=True)

    assert conn.ghost is True
    fetch_info.assert_not_called()


@pytest.mark.asyncio
async def test_flokka_manager_global_event_callback() -> None:
    manager = FlokkManager()
    received = []
    manager.on_event(lambda c, e: received.append(e))

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        conn = await manager.connect("localhost", 7477)

    # Manually trigger the event through the connection
    conn._emit_event({"event": "thought", "data": {}})
    assert len(received) == 1


@pytest.mark.asyncio
async def test_flokka_manager_broadcast_no_connections() -> None:
    manager = FlokkManager()
    results = await manager.broadcast("hello")
    assert results == {}


@pytest.mark.asyncio
async def test_flokka_manager_broadcast_skips_ghost() -> None:
    manager = FlokkManager()

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        conn = await manager.connect("localhost", 7477, ghost=True)
        conn.status = "connected"

    with patch.object(manager, "_send_message", new=AsyncMock(return_value="task-1")) as mock_send:
        results = await manager.broadcast("hello")

    # Ghost connections should be skipped
    mock_send.assert_not_called()
    assert results == {}


# ---------------------------------------------------------------------------
# FlokkManager internal methods
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_info_success() -> None:
    """_fetch_info sets ravn_info and status=connected on 200."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"persona": "thor", "uptime": "5m"}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("ravn.tui.connections.httpx") as mock_httpx:
        mock_httpx.AsyncClient.return_value = mock_client
        await manager._fetch_info(conn)

    assert conn.status == "connected"
    assert conn.ravn_info["persona"] == "thor"


@pytest.mark.asyncio
async def test_fetch_info_non_200_doesnt_set_info() -> None:
    """_fetch_info with non-200 response doesn't set ravn_info."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    mock_resp = MagicMock()
    mock_resp.status_code = 404

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("ravn.tui.connections.httpx") as mock_httpx:
        mock_httpx.AsyncClient.return_value = mock_client
        await manager._fetch_info(conn)

    assert conn.ravn_info == {}
    assert conn.status == "error"


@pytest.mark.asyncio
async def test_fetch_info_exception_sets_error() -> None:
    """_fetch_info exception sets status=error."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    with patch("ravn.tui.connections.httpx") as mock_httpx:
        mock_httpx.AsyncClient.side_effect = Exception("network error")
        await manager._fetch_info(conn)

    assert conn.status == "error"


@pytest.mark.asyncio
async def test_maintain_sse_cancelled() -> None:
    """_maintain_sse exits cleanly on CancelledError."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    async def cancel_immediately(c: RavnConnection) -> None:
        raise asyncio.CancelledError()

    with patch.object(manager, "_sse_loop", side_effect=cancel_immediately):
        await manager._maintain_sse(conn)

    assert conn.status == "connecting"


@pytest.mark.asyncio
async def test_maintain_sse_reconnects_on_error() -> None:
    """_maintain_sse reconnects after a non-cancellation exception."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    call_count = 0

    async def fail_then_cancel(c: RavnConnection) -> None:
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise ConnectionError("network error")
        raise asyncio.CancelledError()

    with (
        patch.object(manager, "_sse_loop", side_effect=fail_then_cancel),
        patch("ravn.tui.connections.asyncio.sleep", new=AsyncMock()),
    ):
        await manager._maintain_sse(conn)

    assert call_count == 2


@pytest.mark.asyncio
async def test_sse_loop_processes_events() -> None:
    """_sse_loop calls _emit_event for valid SSE blocks."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)
    received = []
    conn.on_event(lambda c, e: received.append(e))

    chunks = [
        'event: thought\ndata: {"text": "hello"}\n\n',
        'event: response\ndata: {"text": "world"}\n\n',
    ]

    async def aiter_chunks(chunks: list[str]):
        for chunk in chunks:
            yield chunk

    mock_response = MagicMock()
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=None)
    mock_response.aiter_text = lambda: aiter_chunks(chunks)

    mock_client = MagicMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.stream = MagicMock(return_value=mock_response)

    with patch("ravn.tui.connections.httpx") as mock_httpx:
        mock_httpx.AsyncClient.return_value = mock_client
        await manager._sse_loop(conn)

    assert len(received) == 2
    assert received[0]["event"] == "thought"
    assert received[1]["event"] == "response"


@pytest.mark.asyncio
async def test_send_message_success() -> None:
    """_send_message returns task_id from WebSocket response."""
    import json

    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    mock_ws = AsyncMock()
    mock_ws.send = AsyncMock()
    mock_ws.recv = AsyncMock(return_value=json.dumps({"task_id": "task-123"}))
    mock_ws.__aenter__ = AsyncMock(return_value=mock_ws)
    mock_ws.__aexit__ = AsyncMock(return_value=None)

    with patch("ravn.tui.connections.websockets") as mock_ws_module:
        mock_ws_module.connect.return_value = mock_ws
        result = await manager._send_message(conn, "hello")

    assert result == "task-123"


@pytest.mark.asyncio
async def test_send_message_exception_returns_empty() -> None:
    """_send_message returns empty string on exception."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    with patch("ravn.tui.connections.websockets") as mock_ws_module:
        mock_ws_module.connect.side_effect = Exception("connection refused")
        result = await manager._send_message(conn, "hello")

    assert result == ""


@pytest.mark.asyncio
async def test_global_event_callback_error_doesnt_crash() -> None:
    """Global event callback errors are swallowed."""
    manager = FlokkManager()
    conn = RavnConnection(name="test", host="localhost", port=7477)

    def bad_global_cb(c: object, e: object) -> None:
        raise RuntimeError("boom")

    manager.on_event(bad_global_cb)

    with (
        patch.object(manager, "_maintain_sse", new=AsyncMock()),
        patch.object(manager, "_fetch_info", new=AsyncMock()),
    ):
        await manager.connect("localhost", 7477)

    # Should not raise
    conn._emit_event({"event": "thought"})
    manager._global_event_handler(conn, {"event": "test"})
