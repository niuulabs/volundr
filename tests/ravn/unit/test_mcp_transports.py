"""Additional transport and manager tests to push coverage above 85%."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.mcp.manager import MCPManager, _build_transport
from ravn.adapters.mcp.transport import MCPTransportError
from ravn.config import MCPServerConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cfg(transport: str = "stdio", **kwargs: Any) -> MCPServerConfig:
    defaults: dict[str, Any] = {
        "name": "test",
        "transport": transport,
        "command": "npx",
        "args": [],
        "env": {},
        "url": "http://localhost:3000",
    }
    defaults.update(kwargs)
    return MCPServerConfig(**defaults)


# ---------------------------------------------------------------------------
# _build_transport factory
# ---------------------------------------------------------------------------


class TestBuildTransport:
    def test_stdio_returns_stdio_transport(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        t = _build_transport(_cfg("stdio", command="echo", args=["hello"]))
        assert isinstance(t, StdioTransport)

    def test_http_returns_http_transport(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        t = _build_transport(_cfg("http", url="http://localhost:9999"))
        assert isinstance(t, HTTPTransport)

    def test_sse_returns_sse_transport(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = _build_transport(_cfg("sse", url="http://localhost:9999"))
        assert isinstance(t, SSETransport)


# ---------------------------------------------------------------------------
# StdioTransport with mocked subprocess
# ---------------------------------------------------------------------------


def _make_mock_process(
    stdout_data: bytes = b'{"jsonrpc":"2.0","id":1,"result":{}}\n',
    returncode: int | None = None,
) -> MagicMock:
    """Create a mock asyncio subprocess with async methods as coroutine functions."""

    async def _drain() -> None:
        pass

    async def _readline() -> bytes:
        return stdout_data

    async def _wait() -> int:
        return 0

    proc = MagicMock()
    proc.pid = 12345
    proc.returncode = returncode
    proc.stdin = MagicMock()
    proc.stdin.write = MagicMock()
    proc.stdin.drain = _drain
    proc.stdin.close = MagicMock()
    proc.stdout = MagicMock()
    proc.stdout.readline = _readline
    proc.wait = _wait
    proc.kill = MagicMock()
    return proc


class TestStdioTransportFull:
    """Test full stdio transport lifecycle using a mocked subprocess."""

    @pytest.mark.asyncio
    async def test_start_and_is_alive(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        mock_proc = _make_mock_process()
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as m:
            t = StdioTransport("echo", ["hello"])
            await t.start()
            assert t.is_alive
            m.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_after_start(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        mock_proc = _make_mock_process()
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            await t.send({"jsonrpc": "2.0", "id": 1, "method": "ping"})
            mock_proc.stdin.write.assert_called_once()

    @pytest.mark.asyncio
    async def test_receive_after_start(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        msg = {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}
        mock_proc = _make_mock_process(stdout_data=(json.dumps(msg) + "\n").encode())
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            result = await t.receive()
            assert result == msg

    @pytest.mark.asyncio
    async def test_receive_eof_raises(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        mock_proc = _make_mock_process(stdout_data=b"")  # EOF
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            with pytest.raises(MCPTransportError, match="closed stdout"):
                await t.receive()

    @pytest.mark.asyncio
    async def test_receive_invalid_json_raises(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        mock_proc = _make_mock_process(stdout_data=b"not json\n")
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            with pytest.raises(MCPTransportError, match="Invalid JSON"):
                await t.receive()

    @pytest.mark.asyncio
    async def test_receive_timeout_raises(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        async def _slow_readline() -> bytes:
            await asyncio.sleep(10)
            return b""

        mock_proc = _make_mock_process()
        mock_proc.stdout.readline = _slow_readline

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [], read_timeout=0.01)
            await t.start()
            with pytest.raises(MCPTransportError, match="Timed out"):
                await t.receive()

    @pytest.mark.asyncio
    async def test_send_raises_when_process_exited(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        # Process exited (returncode=0) — send should fail immediately
        mock_proc = _make_mock_process(returncode=0)
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            with pytest.raises(MCPTransportError, match="process has exited"):
                await t.send({"jsonrpc": "2.0"})

    @pytest.mark.asyncio
    async def test_close_kills_process_on_timeout(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        killed: list[bool] = []

        async def slow_wait() -> int:
            await asyncio.sleep(10)
            return 0

        mock_proc = _make_mock_process()
        mock_proc.wait = slow_wait
        mock_proc.kill = MagicMock(side_effect=lambda: killed.append(True))

        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            with patch("ravn.adapters.mcp.stdio_transport._PROCESS_WAIT_TIMEOUT_SECONDS", 0.01):
                t = StdioTransport("echo", [])
                t._process = mock_proc
                await t.close()
                assert killed  # kill() was called

    @pytest.mark.asyncio
    async def test_close_after_start(self) -> None:
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        mock_proc = _make_mock_process()
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            t = StdioTransport("echo", [])
            await t.start()
            await t.close()
            assert not t.is_alive


# ---------------------------------------------------------------------------
# HTTPTransport with mocked httpx
# ---------------------------------------------------------------------------


class TestHTTPTransportFull:
    @pytest.mark.asyncio
    async def test_send_and_receive(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        expected = {"jsonrpc": "2.0", "id": 1, "result": {"data": "ok"}}
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json = MagicMock(return_value=expected)

        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.aclose = AsyncMock()

        with patch("httpx.AsyncClient", return_value=mock_client):
            t = HTTPTransport("http://localhost:9999")
            await t.start()
            await t.send({"jsonrpc": "2.0", "id": 1, "method": "ping"})
            result = await t.receive()
            assert result == expected

    @pytest.mark.asyncio
    async def test_receive_without_pending_message_raises(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        mock_client = MagicMock()
        mock_client.aclose = AsyncMock()

        with patch("httpx.AsyncClient", return_value=mock_client):
            t = HTTPTransport("http://localhost:9999")
            await t.start()
            # No send() before receive()
            with pytest.raises(MCPTransportError, match="No pending message"):
                await t.receive()

    @pytest.mark.asyncio
    async def test_http_error_propagated(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        mock_client = MagicMock()
        mock_client.post = AsyncMock(side_effect=Exception("connection refused"))
        mock_client.aclose = AsyncMock()

        with patch("httpx.AsyncClient", return_value=mock_client):
            t = HTTPTransport("http://localhost:9999")
            await t.start()
            await t.send({"jsonrpc": "2.0", "id": 1, "method": "ping"})
            with pytest.raises(MCPTransportError, match="HTTP request failed"):
                await t.receive()

    @pytest.mark.asyncio
    async def test_close_resets_state(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        mock_client = MagicMock()
        mock_client.aclose = AsyncMock()

        with patch("httpx.AsyncClient", return_value=mock_client):
            t = HTTPTransport("http://localhost:9999")
            await t.start()
            assert t.is_alive
            await t.close()
            assert not t.is_alive

    @pytest.mark.asyncio
    async def test_start_without_httpx_raises(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        t = HTTPTransport("http://localhost:9999")
        with patch.dict("sys.modules", {"httpx": None}):
            with pytest.raises(MCPTransportError, match="httpx is required"):
                await t.start()


# ---------------------------------------------------------------------------
# SSETransport error paths
# ---------------------------------------------------------------------------


class TestSSETransportErrors:
    @pytest.mark.asyncio
    async def test_send_before_start_raises(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = SSETransport("http://localhost:9999")
        with pytest.raises(MCPTransportError, match="not started"):
            await t.send({"jsonrpc": "2.0"})

    @pytest.mark.asyncio
    async def test_receive_before_start_raises(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = SSETransport("http://localhost:9999")
        with pytest.raises(MCPTransportError, match="not started"):
            await t.receive()

    @pytest.mark.asyncio
    async def test_is_alive_false_before_start(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = SSETransport("http://localhost:9999")
        assert not t.is_alive

    @pytest.mark.asyncio
    async def test_start_without_httpx_raises(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = SSETransport("http://localhost:9999")
        with patch.dict("sys.modules", {"httpx": None}):
            with pytest.raises(MCPTransportError, match="httpx is required"):
                await t.start()

    @pytest.mark.asyncio
    async def test_start_timeout_raises(self) -> None:
        """SSETransport.start() raises MCPTransportError when endpoint event times out."""
        from ravn.adapters.mcp.sse_transport import SSETransport

        mock_client = MagicMock()
        mock_client.aclose = AsyncMock()

        # stream() returns a context manager that yields lines slowly (never sends endpoint)
        async def _slow_stream(*args: Any, **kwargs: Any) -> None:
            await asyncio.sleep(10)
            yield ""

        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_stream_ctx.aiter_lines = MagicMock(return_value=_slow_stream())
        mock_client.stream = MagicMock(return_value=mock_stream_ctx)

        with patch("httpx.AsyncClient", return_value=mock_client):
            t = SSETransport("http://localhost:9999")
            with patch("ravn.adapters.mcp.sse_transport._CONNECT_TIMEOUT_SECONDS", 0.01):
                with pytest.raises(MCPTransportError, match="Timed out"):
                    await t.start()

    @pytest.mark.asyncio
    async def test_close_before_start_is_safe(self) -> None:
        from ravn.adapters.mcp.sse_transport import SSETransport

        t = SSETransport("http://localhost:9999")
        await t.close()  # Should not raise

    @pytest.mark.asyncio
    async def test_receive_timeout_raises(self) -> None:
        """Receiving when queue is empty and timeout fires raises MCPTransportError."""
        from ravn.adapters.mcp.sse_transport import SSETransport

        # Use a very short timeout; the empty queue will cause wait_for to fire
        t = SSETransport("http://localhost:9999", timeout=0.01)
        t._started = True  # Force into started state without full SSE setup
        with pytest.raises(MCPTransportError, match="Timed out"):
            await t.receive()


# ---------------------------------------------------------------------------
# MCPManager._build_transport integration with SSE/HTTP configs
# ---------------------------------------------------------------------------


class TestManagerTransportSelection:
    @pytest.mark.asyncio
    async def test_manager_uses_http_transport_for_http_config(self) -> None:
        from ravn.adapters.mcp.sse_transport import HTTPTransport

        cfg = MCPServerConfig(
            name="api",
            transport="http",
            url="http://localhost:9999",
        )
        transport = _build_transport(cfg)
        assert isinstance(transport, HTTPTransport)

    @pytest.mark.asyncio
    async def test_manager_uses_sse_transport_for_sse_config(self) -> None:
        from ravn.adapters.mcp.manager import _build_transport as bt
        from ravn.adapters.mcp.sse_transport import SSETransport

        cfg = MCPServerConfig(
            name="streaming",
            transport="sse",
            url="http://localhost:9999",
        )
        transport = bt(cfg)
        assert isinstance(transport, SSETransport)

    @pytest.mark.asyncio
    async def test_manager_all_servers_fail_returns_empty_tools(self) -> None:
        from ravn.adapters.mcp.transport import MCPTransportError

        cfgs = [
            MCPServerConfig(name="s1", transport="stdio", command="bad1"),
            MCPServerConfig(name="s2", transport="stdio", command="bad2"),
        ]

        # Both transports fail to start
        from ravn.adapters.mcp.stdio_transport import StdioTransport

        with patch.object(StdioTransport, "start", side_effect=MCPTransportError("fail")):
            mgr = MCPManager(configs=cfgs)
            tools = await mgr.start()
            assert tools == []
            for state in mgr.server_states.values():
                from ravn.adapters.mcp.lifecycle import MCPServerState

                assert state == MCPServerState.ERROR
