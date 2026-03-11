"""WebSocket terminal server - spawns PTY shells per connection with multi-tab support."""

import asyncio
import fcntl
import json
import logging
import os
import pty
import signal
import struct
import termios
import uuid

from aiohttp import web

logger = logging.getLogger("terminal")

DEFAULT_SHELL_PATH = "/usr/local/bin/restricted-shell"
UNRESTRICTED_SHELL_PATH = "/bin/bash"
PTY_READ_TIMEOUT_SECONDS = 1.0
PTY_READ_BUFFER_SIZE = 4096
DEFAULT_ROWS = 24
DEFAULT_COLS = 80


def _set_pty_size(fd: int, rows: int, cols: int) -> None:
    """Set the terminal size on a PTY file descriptor."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


class _PtySession:
    """State for a single PTY session."""

    __slots__ = ("terminal_id", "master_fd", "child_pid", "restricted")

    def __init__(
        self,
        terminal_id: str,
        master_fd: int,
        child_pid: int,
        *,
        restricted: bool,
    ) -> None:
        self.terminal_id = terminal_id
        self.master_fd = master_fd
        self.child_pid = child_pid
        self.restricted = restricted


class TerminalServer:
    """WebSocket-to-PTY server with multi-tab and restricted/unrestricted mode."""

    def __init__(
        self,
        port: int = 7681,
        shell_path: str = DEFAULT_SHELL_PATH,
        workspace_dir: str = "",
    ) -> None:
        self.port = port
        self.shell_path = shell_path
        self.workspace_dir = workspace_dir
        self._restricted = os.environ.get("TERMINAL_RESTRICTED", "false").lower() != "false"
        self._sessions: dict[str, _PtySession] = {}
        self._app = web.Application()
        self._app.router.add_get("/ws", self._handle_ws)
        self._app.router.add_get("/ws/{terminal_id}", self._handle_ws)
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_post("/api/terminal/spawn", self._handle_spawn)
        self._app.router.add_post("/api/terminal/kill", self._handle_kill)
        self._app.router.add_post("/api/terminal/mode", self._handle_mode)
        self._app.router.add_get("/api/terminal/mode", self._handle_get_mode)
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        """Start the terminal WebSocket server."""
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", self.port)
        await site.start()
        logger.info(f"Terminal server listening on 127.0.0.1:{self.port}")

    async def stop(self) -> None:
        """Stop the terminal server and clean up all sessions."""
        for session in list(self._sessions.values()):
            self._cleanup_session(session)
        self._sessions.clear()
        if self._runner:
            await self._runner.cleanup()

    # --- HTTP Handlers ---

    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    async def _handle_spawn(self, request: web.Request) -> web.Response:
        """Spawn a new PTY session and return its terminal ID."""
        body = await request.json() if request.can_read_body else {}
        restricted = body.get("restricted", self._restricted)
        terminal_id = str(uuid.uuid4())
        session = self._create_pty_session(terminal_id, restricted=restricted)
        self._sessions[terminal_id] = session
        return web.json_response(
            {
                "terminalId": terminal_id,
                "restricted": session.restricted,
            }
        )

    async def _handle_kill(self, request: web.Request) -> web.Response:
        """Kill a PTY session by terminal ID."""
        body = await request.json()
        terminal_id = body.get("terminalId", "")
        session = self._sessions.pop(terminal_id, None)
        if not session:
            return web.json_response({"error": "not found"}, status=404)
        self._cleanup_session(session)
        return web.json_response({"ok": True})

    async def _handle_mode(self, request: web.Request) -> web.Response:
        """Switch restricted/unrestricted mode globally."""
        body = await request.json()
        restricted = body.get("restricted", True)
        self._restricted = restricted
        return web.json_response({"restricted": self._restricted})

    async def _handle_get_mode(self, request: web.Request) -> web.Response:
        """Return current terminal restriction mode."""
        return web.json_response({"restricted": self._restricted})

    # --- WebSocket Handler ---

    async def _handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        terminal_id = request.match_info.get("terminal_id")

        # If no terminal_id in the path, create an ad-hoc session (backward compat)
        if not terminal_id:
            terminal_id = str(uuid.uuid4())
            session = self._create_pty_session(terminal_id, restricted=self._restricted)
            self._sessions[terminal_id] = session
            ad_hoc = True
        else:
            session = self._sessions.get(terminal_id)
            ad_hoc = False

        if not session:
            await ws.send_str(
                json.dumps(
                    {
                        "type": "error",
                        "data": f"Terminal session {terminal_id} not found",
                    }
                )
            )
            await ws.close()
            return ws

        logger.info(
            "Terminal WebSocket opened: id=%s restricted=%s",
            terminal_id,
            session.restricted,
        )

        master_fd = session.master_fd
        try:
            _set_pty_size(master_fd, DEFAULT_ROWS, DEFAULT_COLS)

            loop = asyncio.get_running_loop()
            read_task = asyncio.create_task(self._pty_to_ws(loop, master_fd, ws))

            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    msg_type = data.get("type")

                    if msg_type == "input":
                        os.write(master_fd, data["data"].encode())
                    elif msg_type == "resize":
                        cols = data.get("cols", DEFAULT_COLS)
                        rows = data.get("rows", DEFAULT_ROWS)
                        _set_pty_size(master_fd, rows, cols)

                elif msg.type == web.WSMsgType.BINARY:
                    os.write(master_fd, msg.data)

                elif msg.type in (
                    web.WSMsgType.ERROR,
                    web.WSMsgType.CLOSE,
                    web.WSMsgType.CLOSING,
                ):
                    break

            read_task.cancel()

        except Exception:
            logger.exception("Terminal session error: id=%s", terminal_id)
        finally:
            # For ad-hoc sessions, clean up PTY when the WebSocket closes
            if ad_hoc:
                removed = self._sessions.pop(terminal_id, None)
                if removed:
                    self._cleanup_session(removed)
            if not ws.closed:
                await ws.close()
            logger.info("Terminal WebSocket closed: id=%s", terminal_id)

        return ws

    # --- PTY Management ---

    def _create_pty_session(
        self,
        terminal_id: str,
        *,
        restricted: bool,
    ) -> _PtySession:
        """Fork a PTY and return a session object."""
        master_fd, child_pid = self._spawn_shell(restricted=restricted)

        # Make master_fd non-blocking for asyncio
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        return _PtySession(
            terminal_id=terminal_id,
            master_fd=master_fd,
            child_pid=child_pid,
            restricted=restricted,
        )

    def _spawn_shell(self, *, restricted: bool) -> tuple[int, int]:
        """Fork a PTY running the shell. Returns (master_fd, child_pid)."""
        if restricted:
            shell = self.shell_path
        else:
            shell = os.environ.get("SHELL", UNRESTRICTED_SHELL_PATH)

        child_pid, master_fd = pty.fork()
        if child_pid == 0:
            # Child process - exec the shell
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            if self.workspace_dir:
                env["WORKSPACE_DIR"] = self.workspace_dir
                os.chdir(self.workspace_dir)
            os.execve(
                shell,
                [shell],
                env,
            )
        return master_fd, child_pid

    @staticmethod
    def _cleanup_session(session: _PtySession) -> None:
        """Clean up a PTY session's file descriptor and child process."""
        try:
            os.close(session.master_fd)
        except OSError:
            pass
        try:
            os.kill(session.child_pid, signal.SIGTERM)
            os.waitpid(session.child_pid, 0)
        except (ProcessLookupError, ChildProcessError, OSError):
            pass

    async def _pty_to_ws(
        self,
        loop: asyncio.AbstractEventLoop,
        master_fd: int,
        ws: web.WebSocketResponse,
    ) -> None:
        """Read PTY output and send to WebSocket."""
        try:
            while not ws.closed:
                data = await loop.run_in_executor(None, self._blocking_read, master_fd)
                if data is None:
                    continue
                if not data:
                    # EOF - process exited
                    await ws.send_str(json.dumps({"type": "exit", "data": ""}))
                    break
                await ws.send_str(
                    json.dumps(
                        {
                            "type": "output",
                            "data": data.decode("utf-8", errors="replace"),
                        }
                    )
                )
        except (OSError, ConnectionResetError):
            pass
        except asyncio.CancelledError:
            pass

    @staticmethod
    def _blocking_read(fd: int) -> bytes | None:
        """Blocking read from file descriptor (runs in executor).

        Returns data bytes, None on timeout, or b"" on EOF/error.
        """
        import select

        ready, _, _ = select.select([fd], [], [], PTY_READ_TIMEOUT_SECONDS)
        if not ready:
            return None
        try:
            return os.read(fd, PTY_READ_BUFFER_SIZE)
        except OSError:
            return b""
