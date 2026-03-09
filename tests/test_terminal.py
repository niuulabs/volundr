"""Tests for the devrunner terminal server."""

from __future__ import annotations

import json
import os
import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# aiohttp is not in the main package deps — stub it before importing terminal
_mock_aiohttp = types.ModuleType("aiohttp")
_mock_web = types.ModuleType("aiohttp.web")

# Minimal web stubs needed by the terminal module
_mock_web.Application = MagicMock
_mock_web.AppRunner = MagicMock
_mock_web.TCPSite = MagicMock
_mock_web.Request = MagicMock
_mock_web.Response = MagicMock
_mock_web.WebSocketResponse = MagicMock


class _FakeJsonResponse:
    """Minimal json_response stub that stores status and body text."""

    def __init__(self, data: dict, *, status: int = 200) -> None:
        self.text = json.dumps(data)
        self.status = status


_mock_web.json_response = _FakeJsonResponse

# WebSocket message types
_mock_web.WSMsgType = MagicMock()
_mock_web.WSMsgType.TEXT = 1
_mock_web.WSMsgType.BINARY = 2
_mock_web.WSMsgType.ERROR = 8
_mock_web.WSMsgType.CLOSE = 256
_mock_web.WSMsgType.CLOSING = 512

_mock_aiohttp.web = _mock_web
sys.modules["aiohttp"] = _mock_aiohttp
sys.modules["aiohttp.web"] = _mock_web

# Add the devrunner directory to the path
sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "containers",
        "devrunner",
    ),
)

from terminal import (  # noqa: E402
    DEFAULT_COLS,
    DEFAULT_ROWS,
    DEFAULT_SHELL_PATH,
    PTY_READ_BUFFER_SIZE,
    PTY_READ_TIMEOUT_SECONDS,
    UNRESTRICTED_SHELL_PATH,
    TerminalServer,
    _PtySession,
    _set_pty_size,
)


class TestTerminalServerInit:
    """Test TerminalServer initialization."""

    def test_default_values(self) -> None:
        server = TerminalServer()
        assert server.port == 7681
        assert server.shell_path == DEFAULT_SHELL_PATH
        assert server.workspace_dir == ""
        assert server._restricted is True
        assert server._sessions == {}

    def test_custom_values(self) -> None:
        server = TerminalServer(
            port=8080,
            shell_path="/bin/bash",
            workspace_dir="/workspace",
        )
        assert server.port == 8080
        assert server.shell_path == "/bin/bash"
        assert server.workspace_dir == "/workspace"

    @patch.dict(os.environ, {"TERMINAL_RESTRICTED": "false"})
    def test_unrestricted_mode_from_env(self) -> None:
        server = TerminalServer()
        assert server._restricted is False

    @patch.dict(os.environ, {"TERMINAL_RESTRICTED": "true"})
    def test_restricted_mode_from_env(self) -> None:
        server = TerminalServer()
        assert server._restricted is True

    @patch.dict(os.environ, {"TERMINAL_RESTRICTED": "FALSE"})
    def test_unrestricted_mode_case_insensitive(self) -> None:
        server = TerminalServer()
        assert server._restricted is False


class TestPtySession:
    """Test _PtySession data class."""

    def test_creation(self) -> None:
        session = _PtySession(
            terminal_id="test-id",
            master_fd=5,
            child_pid=1234,
            restricted=True,
        )
        assert session.terminal_id == "test-id"
        assert session.master_fd == 5
        assert session.child_pid == 1234
        assert session.restricted is True


class TestConstants:
    """Test that constants have sensible values."""

    def test_default_shell_path(self) -> None:
        assert DEFAULT_SHELL_PATH == "/usr/local/bin/restricted-shell"

    def test_unrestricted_shell_path(self) -> None:
        assert UNRESTRICTED_SHELL_PATH == "/bin/bash"

    def test_pty_read_timeout(self) -> None:
        assert PTY_READ_TIMEOUT_SECONDS == 1.0

    def test_pty_read_buffer_size(self) -> None:
        assert PTY_READ_BUFFER_SIZE == 4096

    def test_default_dimensions(self) -> None:
        assert DEFAULT_ROWS == 24
        assert DEFAULT_COLS == 80


class TestSetPtySize:
    """Test _set_pty_size helper."""

    @patch("terminal.fcntl.ioctl")
    @patch("terminal.struct.pack")
    def test_set_pty_size(self, mock_pack: MagicMock, mock_ioctl: MagicMock) -> None:
        mock_pack.return_value = b"\x00" * 8
        _set_pty_size(5, 24, 80)
        mock_pack.assert_called_once_with("HHHH", 24, 80, 0, 0)
        mock_ioctl.assert_called_once()


class TestSpawnShell:
    """Test shell spawning logic."""

    @patch("terminal.pty.fork", return_value=(1234, 5))
    @patch("terminal.fcntl.fcntl")
    def test_spawn_restricted_shell(self, mock_fcntl: MagicMock, mock_fork: MagicMock) -> None:
        server = TerminalServer(shell_path="/usr/local/bin/restricted-shell")
        session = server._create_pty_session("test-id", restricted=True)
        assert session.terminal_id == "test-id"
        assert session.child_pid == 1234
        assert session.master_fd == 5
        assert session.restricted is True

    @patch("terminal.pty.fork", return_value=(1234, 5))
    @patch("terminal.fcntl.fcntl")
    def test_spawn_unrestricted_shell(self, mock_fcntl: MagicMock, mock_fork: MagicMock) -> None:
        server = TerminalServer()
        session = server._create_pty_session("test-id", restricted=False)
        assert session.restricted is False


class TestCleanupSession:
    """Test session cleanup."""

    @patch("terminal.os.waitpid")
    @patch("terminal.os.kill")
    @patch("terminal.os.close")
    def test_cleanup_session(
        self,
        mock_close: MagicMock,
        mock_kill: MagicMock,
        mock_waitpid: MagicMock,
    ) -> None:
        session = _PtySession(
            terminal_id="test",
            master_fd=5,
            child_pid=1234,
            restricted=True,
        )
        TerminalServer._cleanup_session(session)
        mock_close.assert_called_once_with(5)
        mock_kill.assert_called_once()
        mock_waitpid.assert_called_once()

    @patch("terminal.os.waitpid", side_effect=ChildProcessError)
    @patch("terminal.os.kill", side_effect=ProcessLookupError)
    @patch("terminal.os.close", side_effect=OSError)
    def test_cleanup_session_handles_errors(
        self,
        mock_close: MagicMock,
        mock_kill: MagicMock,
        mock_waitpid: MagicMock,
    ) -> None:
        session = _PtySession(
            terminal_id="test",
            master_fd=5,
            child_pid=1234,
            restricted=True,
        )
        # Should not raise
        TerminalServer._cleanup_session(session)


class TestBlockingRead:
    """Test the blocking read helper."""

    @patch("select.select", return_value=([], [], []))
    def test_returns_none_on_timeout(self, mock_select: MagicMock) -> None:
        result = TerminalServer._blocking_read(5)
        assert result is None

    @patch("terminal.os.read", return_value=b"hello")
    @patch("select.select", return_value=([5], [], []))
    def test_returns_data(self, mock_select: MagicMock, mock_read: MagicMock) -> None:
        result = TerminalServer._blocking_read(5)
        assert result == b"hello"

    @patch("terminal.os.read", side_effect=OSError)
    @patch("select.select", return_value=([5], [], []))
    def test_returns_empty_on_error(self, mock_select: MagicMock, mock_read: MagicMock) -> None:
        result = TerminalServer._blocking_read(5)
        assert result == b""


class TestHandleSpawn:
    """Test the spawn endpoint."""

    @pytest.mark.asyncio
    @patch("terminal.pty.fork", return_value=(1234, 5))
    @patch("terminal.fcntl.fcntl")
    async def test_spawn_returns_terminal_id(
        self, mock_fcntl: MagicMock, mock_fork: MagicMock
    ) -> None:
        server = TerminalServer()
        request = MagicMock()
        request.can_read_body = False

        response = await server._handle_spawn(request)
        body = json.loads(response.text)

        assert "terminalId" in body
        assert body["restricted"] is True
        assert body["terminalId"] in server._sessions


class TestHandleKill:
    """Test the kill endpoint."""

    @pytest.mark.asyncio
    async def test_kill_nonexistent_returns_404(self) -> None:
        server = TerminalServer()
        request = MagicMock()
        request.json = AsyncMock(return_value={"terminalId": "nonexistent"})

        response = await server._handle_kill(request)
        assert response.status == 404

    @pytest.mark.asyncio
    @patch.object(TerminalServer, "_cleanup_session")
    async def test_kill_existing_session(self, mock_cleanup: MagicMock) -> None:
        server = TerminalServer()
        session = _PtySession(
            terminal_id="test-id",
            master_fd=5,
            child_pid=1234,
            restricted=True,
        )
        server._sessions["test-id"] = session

        request = MagicMock()
        request.json = AsyncMock(return_value={"terminalId": "test-id"})

        response = await server._handle_kill(request)
        body = json.loads(response.text)

        assert body["ok"] is True
        assert "test-id" not in server._sessions
        mock_cleanup.assert_called_once_with(session)


class TestHandleMode:
    """Test the mode toggle endpoint."""

    @pytest.mark.asyncio
    async def test_set_unrestricted(self) -> None:
        server = TerminalServer()
        assert server._restricted is True

        request = MagicMock()
        request.json = AsyncMock(return_value={"restricted": False})

        response = await server._handle_mode(request)
        body = json.loads(response.text)

        assert body["restricted"] is False
        assert server._restricted is False

    @pytest.mark.asyncio
    async def test_get_mode(self) -> None:
        server = TerminalServer()
        request = MagicMock()

        response = await server._handle_get_mode(request)
        body = json.loads(response.text)

        assert body["restricted"] is True


class TestStop:
    """Test server shutdown."""

    @pytest.mark.asyncio
    @patch.object(TerminalServer, "_cleanup_session")
    async def test_stop_cleans_up_sessions(self, mock_cleanup: MagicMock) -> None:
        server = TerminalServer()
        session = _PtySession(
            terminal_id="test",
            master_fd=5,
            child_pid=1234,
            restricted=True,
        )
        server._sessions["test"] = session
        server._runner = MagicMock()
        server._runner.cleanup = AsyncMock()

        await server.stop()

        mock_cleanup.assert_called_once_with(session)
        assert len(server._sessions) == 0
        server._runner.cleanup.assert_called_once()
