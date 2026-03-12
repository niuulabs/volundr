"""Tests for the devrunner terminal server (tmux-based architecture)."""

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
    _AttachHandle,
    _set_pty_size,
    _TmuxSession,
)


class TestTerminalServerInit:
    """Test TerminalServer initialization."""

    def test_default_values(self) -> None:
        server = TerminalServer()
        assert server.port == 7681
        assert server.shell_path == DEFAULT_SHELL_PATH
        assert server.workspace_dir == ""
        assert server._restricted is False
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


class TestTmuxSession:
    """Test _TmuxSession data class."""

    def test_creation(self) -> None:
        session = _TmuxSession(
            terminal_id="test-id",
            label="Test Terminal",
            cli_type="shell",
            window_name="test-id",
        )
        assert session.terminal_id == "test-id"
        assert session.label == "Test Terminal"
        assert session.cli_type == "shell"
        assert session.window_name == "test-id"


class TestAttachHandle:
    """Test _AttachHandle data class."""

    def test_creation(self) -> None:
        handle = _AttachHandle(master_fd=5, child_pid=1234)
        assert handle.master_fd == 5
        assert handle.child_pid == 1234


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


class TestCleanupAttach:
    """Test attach handle cleanup."""

    @patch("terminal.os.waitpid")
    @patch("terminal.os.kill")
    @patch("terminal.os.close")
    def test_cleanup_attach(
        self,
        mock_close: MagicMock,
        mock_kill: MagicMock,
        mock_waitpid: MagicMock,
    ) -> None:
        handle = _AttachHandle(master_fd=5, child_pid=1234)
        TerminalServer._cleanup_attach(handle)
        mock_close.assert_called_once_with(5)
        mock_kill.assert_called_once()
        mock_waitpid.assert_called_once()

    @patch("terminal.os.waitpid", side_effect=ChildProcessError)
    @patch("terminal.os.kill", side_effect=ProcessLookupError)
    @patch("terminal.os.close", side_effect=OSError)
    def test_cleanup_attach_handles_errors(
        self,
        mock_close: MagicMock,
        mock_kill: MagicMock,
        mock_waitpid: MagicMock,
    ) -> None:
        handle = _AttachHandle(master_fd=5, child_pid=1234)
        # Should not raise
        TerminalServer._cleanup_attach(handle)


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
    @patch("terminal._tmux_run")
    async def test_spawn_returns_terminal_id(self, mock_tmux: MagicMock) -> None:
        mock_tmux.return_value = MagicMock(returncode=0, stdout="")
        server = TerminalServer()
        server._tmux_ready = True
        request = MagicMock()
        request.can_read_body = False

        response = await server._handle_spawn(request)
        body = json.loads(response.text)

        assert "terminalId" in body
        assert body["cli_type"] == "zsh"
        assert body["persistent"] is True
        assert body["terminalId"] in server._sessions

    @pytest.mark.asyncio
    @patch("terminal._tmux_run")
    async def test_spawn_with_cli_type(self, mock_tmux: MagicMock) -> None:
        mock_tmux.return_value = MagicMock(returncode=0, stdout="")
        server = TerminalServer()
        server._tmux_ready = True
        request = MagicMock()
        request.can_read_body = True
        request.json = AsyncMock(return_value={"cli_type": "claude"})

        response = await server._handle_spawn(request)
        body = json.loads(response.text)

        assert body["cli_type"] == "claude"

    @pytest.mark.asyncio
    @patch("terminal._tmux_run")
    async def test_spawn_duplicate_returns_409(self, mock_tmux: MagicMock) -> None:
        mock_tmux.return_value = MagicMock(returncode=0, stdout="")
        server = TerminalServer()
        server._tmux_ready = True
        server._sessions["my-session"] = _TmuxSession(
            terminal_id="my-session",
            label="my-session",
            cli_type="shell",
            window_name="my-session",
        )

        request = MagicMock()
        request.can_read_body = True
        request.json = AsyncMock(return_value={"name": "my-session"})

        response = await server._handle_spawn(request)
        assert response.status == 409


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
    @patch("terminal._tmux_run")
    async def test_kill_existing_session(self, mock_tmux: MagicMock) -> None:
        mock_tmux.return_value = MagicMock(returncode=0, stdout="")
        server = TerminalServer()
        session = _TmuxSession(
            terminal_id="test-id",
            label="Test",
            cli_type="shell",
            window_name="test-id",
        )
        server._sessions["test-id"] = session

        request = MagicMock()
        request.json = AsyncMock(return_value={"terminalId": "test-id"})

        response = await server._handle_kill(request)
        body = json.loads(response.text)

        assert body["ok"] is True
        assert "test-id" not in server._sessions


class TestHandleMode:
    """Test the mode toggle endpoint."""

    @pytest.mark.asyncio
    async def test_set_restricted(self) -> None:
        server = TerminalServer()
        assert server._restricted is False

        request = MagicMock()
        request.json = AsyncMock(return_value={"restricted": True})

        response = await server._handle_mode(request)
        body = json.loads(response.text)

        assert body["restricted"] is True
        assert server._restricted is True

    @pytest.mark.asyncio
    async def test_get_mode(self) -> None:
        server = TerminalServer()
        request = MagicMock()

        response = await server._handle_get_mode(request)
        body = json.loads(response.text)

        assert body["restricted"] is False


class TestStop:
    """Test server shutdown."""

    @pytest.mark.asyncio
    async def test_stop_clears_sessions(self) -> None:
        server = TerminalServer()
        server._sessions["test"] = _TmuxSession(
            terminal_id="test",
            label="Test",
            cli_type="shell",
            window_name="test",
        )
        server._runner = MagicMock()
        server._runner.cleanup = AsyncMock()

        await server.stop()

        assert len(server._sessions) == 0
        server._runner.cleanup.assert_called_once()
