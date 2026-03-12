"""WebSocket terminal server - tmux-backed persistent PTY sessions.

Every terminal tab is a tmux window inside a single headless tmux server.
Sessions survive WebSocket disconnects — reconnecting reattaches to the
same tmux window with full scrollback preserved.

Also supports launching specific CLI tools (claude, codex, aider, shell)
via the REST API.
"""

import asyncio
import fcntl
import json
import logging
import os
import pty
import shutil
import signal
import struct
import subprocess
import termios

from aiohttp import web

logger = logging.getLogger("terminal")

DEFAULT_SHELL_PATH = "/usr/local/bin/restricted-shell"
UNRESTRICTED_SHELL_PATH = "/bin/bash"
PTY_READ_TIMEOUT_SECONDS = 1.0
PTY_READ_BUFFER_SIZE = 4096
DEFAULT_ROWS = 24
DEFAULT_COLS = 80

TMUX_SERVER_NAME = "volundr"
TMUX_SOCKET_DIR = "/tmp/volundr-tmux"
TMUX_SCROLLBACK = 50000

PERSISTENT_HOME = "/volundr/home"
PREFS_FILENAME = ".volundr-prefs"
SKEL_DIR = "/etc/skel"

# CLI tool -> command mapping
CLI_COMMANDS: dict[str, str] = {
    "claude": "claude",
    "codex": "codex",
    "aider": "aider",
    "shell": "/bin/bash",
    "bash": "/bin/bash",
    "zsh": "/bin/zsh",
    "fish": "/usr/bin/fish",
}

# Dotfiles that are managed (relative to home directory)
MANAGED_DOTFILES = [
    ".bashrc",
    ".zshrc",
    ".config/fish/config.fish",
    ".gitconfig",
    ".vimrc",
]


def _set_pty_size(fd: int, rows: int, cols: int) -> None:
    """Set the terminal size on a PTY file descriptor."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def _tmux_bin() -> str:
    return shutil.which("tmux") or "tmux"


def _tmux_cmd(*args: str) -> list[str]:
    return [_tmux_bin(), "-S", f"{TMUX_SOCKET_DIR}/default", *args]


def _tmux_run(*args: str) -> subprocess.CompletedProcess[str]:
    """Run a tmux command synchronously, return CompletedProcess."""
    return subprocess.run(
        _tmux_cmd(*args),
        capture_output=True,
        text=True,
    )


class _TmuxSession:
    """Metadata for a single tmux-backed terminal session."""

    __slots__ = ("terminal_id", "label", "cli_type", "window_name")

    def __init__(
        self,
        terminal_id: str,
        label: str,
        cli_type: str,
        window_name: str,
    ) -> None:
        self.terminal_id = terminal_id
        self.label = label
        self.cli_type = cli_type
        self.window_name = window_name


class _AttachHandle:
    """State for a single WebSocket-to-tmux-attach bridge."""

    __slots__ = ("master_fd", "child_pid")

    def __init__(self, master_fd: int, child_pid: int) -> None:
        self.master_fd = master_fd
        self.child_pid = child_pid


class TerminalServer:
    """WebSocket-to-tmux server with persistent multi-tab sessions."""

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
        self._sessions: dict[str, _TmuxSession] = {}
        self._session_counter = 0
        self._tmux_ready = False
        self._app = web.Application()
        self._app.router.add_get("/ws", self._handle_ws)
        self._app.router.add_get("/ws/{terminal_id}", self._handle_ws)
        self._app.router.add_get("/health", self._handle_health)
        self._app.router.add_post("/api/terminal/spawn", self._handle_spawn)
        self._app.router.add_post("/api/terminal/kill", self._handle_kill)
        self._app.router.add_post("/api/terminal/mode", self._handle_mode)
        self._app.router.add_get("/api/terminal/mode", self._handle_get_mode)
        self._app.router.add_get("/api/terminal/sessions", self._handle_list_sessions)
        self._app.router.add_get("/api/terminal/dotfiles", self._handle_list_dotfiles)
        self._app.router.add_post("/api/terminal/dotfiles", self._handle_upload_dotfile)
        self._app.router.add_delete(
            "/api/terminal/dotfiles/{filename:.+}", self._handle_delete_dotfile
        )
        self._app.router.add_get("/api/terminal/preferences", self._handle_get_preferences)
        self._app.router.add_post("/api/terminal/preferences", self._handle_set_preferences)
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        """Start the terminal WebSocket server and tmux."""
        self._ensure_tmux_server()
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", self.port)
        await site.start()
        logger.info(f"Terminal server listening on 127.0.0.1:{self.port}")

    async def stop(self) -> None:
        """Stop the terminal server. tmux sessions are left alive for reconnect."""
        self._sessions.clear()
        if self._runner:
            await self._runner.cleanup()

    # --- tmux Management ---

    def _ensure_tmux_server(self) -> None:
        """Start the headless tmux server if not running."""
        if self._tmux_ready:
            return

        os.makedirs(TMUX_SOCKET_DIR, exist_ok=True)

        result = _tmux_run("has-session", "-t", TMUX_SERVER_NAME)
        if result.returncode == 0:
            logger.info("tmux server '%s' already running, reloading sessions", TMUX_SERVER_NAME)
            self._reload_sessions()
            self._tmux_ready = True
            return

        # Create detached session with placeholder window
        _tmux_run(
            "new-session",
            "-d",
            "-s",
            TMUX_SERVER_NAME,
            "-n",
            "__init__",
            "-x",
            "200",
            "-y",
            "50",
        )
        self._apply_headless_config()
        self._tmux_ready = True
        logger.info("tmux server '%s' started (headless)", TMUX_SERVER_NAME)

    def _apply_headless_config(self) -> None:
        """Make tmux invisible — no status bar, no prefix key."""
        for args in [
            ("set-option", "-t", TMUX_SERVER_NAME, "-g", "status", "off"),
            ("set-option", "-t", TMUX_SERVER_NAME, "-g", "prefix", "None"),
            ("set-option", "-t", TMUX_SERVER_NAME, "-g", "history-limit", str(TMUX_SCROLLBACK)),
            ("set-option", "-t", TMUX_SERVER_NAME, "-g", "mouse", "on"),
            ("unbind-key", "-a"),
        ]:
            _tmux_run(*args)

    def _reload_sessions(self) -> None:
        """Reload session metadata from a running tmux server."""
        result = _tmux_run("list-windows", "-t", TMUX_SERVER_NAME, "-F", "#{window_name}")
        if result.returncode != 0:
            return

        for line in result.stdout.strip().split("\n"):
            name = line.strip()
            if not name or name == "__init__":
                continue
            if name not in self._sessions:
                self._session_counter += 1
                self._sessions[name] = _TmuxSession(
                    terminal_id=name,
                    label=name,
                    cli_type="shell",
                    window_name=name,
                )
        logger.info("Reloaded %d sessions from tmux", len(self._sessions))

    def _create_tmux_window(
        self,
        terminal_id: str,
        *,
        label: str,
        cli_type: str = "shell",
        command: str | None = None,
    ) -> _TmuxSession:
        """Create a new tmux window and track it."""
        self._ensure_tmux_server()

        if command is None:
            if self._restricted:
                command = self.shell_path
            else:
                command = os.environ.get("SHELL", UNRESTRICTED_SHELL_PATH)

        # Ensure HOME is set in tmux's environment so shells find
        # dotfiles in the persistent home directory, not /home/devrunner
        home_dir = os.environ.get("HOME", PERSISTENT_HOME)
        _tmux_run("set-environment", "-t", TMUX_SERVER_NAME, "HOME", home_dir)

        # Seed default dotfiles on first launch
        self._init_home(home_dir)

        # Build the full command with workspace cd
        if self.workspace_dir:
            full_cmd = f"cd {self.workspace_dir} && {command}"
        else:
            full_cmd = command

        # Use terminal_id as the tmux window name for easy lookup
        _tmux_run(
            "new-window",
            "-t",
            TMUX_SERVER_NAME,
            "-n",
            terminal_id,
            full_cmd,
        )

        session = _TmuxSession(
            terminal_id=terminal_id,
            label=label,
            cli_type=cli_type,
            window_name=terminal_id,
        )
        self._sessions[terminal_id] = session
        logger.info("Created tmux window: id=%s label=%s cli_type=%s", terminal_id, label, cli_type)
        return session

    def _attach_pty(self, window_name: str) -> _AttachHandle:
        """Fork a PTY running ``tmux attach`` targeting a specific window.

        Returns an AttachHandle with master_fd and child_pid. The caller
        bridges the master fd to a WebSocket. When the WebSocket disconnects,
        close the master fd and wait for the child — tmux keeps the window alive.
        """
        child_pid, master_fd = pty.fork()
        if child_pid == 0:
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            tmux = _tmux_bin()
            os.execve(
                tmux,
                _tmux_cmd(
                    "attach-session",
                    "-t",
                    f"{TMUX_SERVER_NAME}:{window_name}",
                ),
                env,
            )

        # Make master non-blocking for asyncio
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        return _AttachHandle(master_fd=master_fd, child_pid=child_pid)

    @staticmethod
    def _cleanup_attach(handle: _AttachHandle) -> None:
        """Clean up an attach handle (close fd, reap child). tmux window stays alive."""
        try:
            os.close(handle.master_fd)
        except OSError:
            pass
        try:
            os.kill(handle.child_pid, signal.SIGTERM)
            os.waitpid(handle.child_pid, 0)
        except (ProcessLookupError, ChildProcessError, OSError):
            pass

    def _kill_session(self, terminal_id: str) -> bool:
        """Kill a tmux window by terminal ID."""
        session = self._sessions.pop(terminal_id, None)
        if not session:
            return False
        _tmux_run("kill-window", "-t", f"{TMUX_SERVER_NAME}:{session.window_name}")
        logger.info("Killed tmux window: id=%s", terminal_id)
        return True

    def _window_alive(self, window_name: str) -> bool:
        """Check if a tmux window still exists."""
        result = _tmux_run("has-session", "-t", f"{TMUX_SERVER_NAME}:{window_name}")
        return result.returncode == 0

    # --- HTTP Handlers ---

    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({"status": "ok", "tmux": self._tmux_ready})

    async def _handle_spawn(self, request: web.Request) -> web.Response:
        """Spawn a new persistent terminal session and return its ID."""
        body = await request.json() if request.can_read_body else {}
        cli_type = body.get("cli_type", "shell")
        name = body.get("name")

        # "shell" means "use the user's preferred shell"
        if cli_type == "shell":
            cli_type = self._get_preferred_shell()

        # Resolve command for the CLI type
        if cli_type in CLI_COMMANDS:
            command = CLI_COMMANDS[cli_type]
        else:
            cli_type = "bash"
            command = CLI_COMMANDS["bash"]

        self._session_counter += 1
        terminal_id = name or f"{cli_type}-{self._session_counter}"
        # Sanitise for tmux window name
        terminal_id = "".join(c if c.isalnum() or c in "-_" else "-" for c in terminal_id)

        # Check for duplicate
        if terminal_id in self._sessions:
            return web.json_response(
                {"error": f"Session '{terminal_id}' already exists"}, status=409
            )

        label = body.get("label", terminal_id)
        session = self._create_tmux_window(
            terminal_id, label=label, cli_type=cli_type, command=command
        )

        return web.json_response(
            {
                "terminalId": session.terminal_id,
                "label": session.label,
                "cli_type": session.cli_type,
                "persistent": True,
            }
        )

    async def _handle_kill(self, request: web.Request) -> web.Response:
        """Kill a terminal session by ID."""
        body = await request.json()
        terminal_id = body.get("terminalId", "")
        if not self._kill_session(terminal_id):
            return web.json_response({"error": "not found"}, status=404)
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

    async def _handle_list_sessions(self, request: web.Request) -> web.Response:
        """List all persistent terminal sessions."""
        sessions = []
        for s in self._sessions.values():
            alive = self._window_alive(s.window_name)
            sessions.append(
                {
                    "terminalId": s.terminal_id,
                    "label": s.label,
                    "cli_type": s.cli_type,
                    "status": "running" if alive else "exited",
                }
            )
        return web.json_response(
            {
                "sessions": sessions,
                "tmux": self._tmux_ready,
            }
        )

    # --- Home Directory & Preferences ---

    @staticmethod
    def _get_home_dir() -> str:
        return os.environ.get("HOME", PERSISTENT_HOME)

    def _init_home(self, home_dir: str) -> None:
        """Seed default dotfiles from /etc/skel if they don't exist."""
        if not os.path.isdir(SKEL_DIR):
            return
        for root, _dirs, files in os.walk(SKEL_DIR):
            for fname in files:
                src = os.path.join(root, fname)
                rel = os.path.relpath(src, SKEL_DIR)
                dest = os.path.join(home_dir, rel)
                if not os.path.exists(dest):
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    try:
                        shutil.copy2(src, dest)
                        logger.info("Seeded dotfile: %s", rel)
                    except OSError:
                        logger.warning("Failed to seed dotfile: %s", rel)

        # Seed oh-my-zsh if installed system-wide
        omz_src = "/usr/share/oh-my-zsh"
        omz_dest = os.path.join(home_dir, ".oh-my-zsh")
        if os.path.isdir(omz_src) and not os.path.isdir(omz_dest):
            try:
                shutil.copytree(omz_src, omz_dest)
                logger.info("Seeded oh-my-zsh to %s", omz_dest)
            except OSError:
                logger.warning("Failed to seed oh-my-zsh")

    def _get_preferred_shell(self) -> str:
        """Read the user's preferred shell from their prefs file."""
        home_dir = self._get_home_dir()
        prefs_path = os.path.join(home_dir, PREFS_FILENAME)
        try:
            with open(prefs_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("default_shell="):
                        shell = line.split("=", 1)[1].strip()
                        if shell in CLI_COMMANDS:
                            return shell
        except FileNotFoundError:
            pass
        return "zsh"

    @staticmethod
    def _set_preferred_shell(shell: str) -> None:
        """Write the user's preferred shell to their prefs file."""
        home_dir = os.environ.get("HOME", PERSISTENT_HOME)
        prefs_path = os.path.join(home_dir, PREFS_FILENAME)
        os.makedirs(os.path.dirname(prefs_path) or ".", exist_ok=True)
        with open(prefs_path, "w") as f:
            f.write(f"default_shell={shell}\n")

    # --- Dotfile Handlers ---

    async def _handle_list_dotfiles(self, request: web.Request) -> web.Response:
        """List dotfiles in the user's home directory."""
        home_dir = self._get_home_dir()
        dotfiles = []
        for rel_path in MANAGED_DOTFILES:
            full_path = os.path.join(home_dir, rel_path)
            exists = os.path.isfile(full_path)
            has_default = os.path.isfile(os.path.join(SKEL_DIR, rel_path))
            entry: dict[str, str | bool | int] = {
                "name": rel_path,
                "exists": exists,
                "hasDefault": has_default,
            }
            if exists:
                try:
                    stat = os.stat(full_path)
                    entry["size"] = stat.st_size
                except OSError:
                    pass
            dotfiles.append(entry)
        return web.json_response({"dotfiles": dotfiles, "homeDir": home_dir})

    async def _handle_upload_dotfile(self, request: web.Request) -> web.Response:
        """Upload a dotfile to the user's home directory."""
        home_dir = self._get_home_dir()

        body = await request.json()
        filename = body.get("filename", "")
        content = body.get("content", "")

        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)

        # Security: prevent path traversal
        norm = os.path.normpath(filename)
        if norm.startswith("/") or ".." in norm.split(os.sep):
            return web.json_response({"error": "invalid filename"}, status=400)

        dest = os.path.join(home_dir, norm)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            with open(dest, "w") as f:
                f.write(content)
        except OSError as e:
            return web.json_response({"error": str(e)}, status=500)

        logger.info("Uploaded dotfile: %s", norm)
        return web.json_response({"ok": True, "filename": norm})

    async def _handle_delete_dotfile(self, request: web.Request) -> web.Response:
        """Delete a user dotfile. Defaults will be restored on next shell start."""
        home_dir = self._get_home_dir()
        filename = request.match_info["filename"]

        # Security: prevent path traversal
        norm = os.path.normpath(filename)
        if norm.startswith("/") or ".." in norm.split(os.sep):
            return web.json_response({"error": "invalid filename"}, status=400)

        full_path = os.path.join(home_dir, norm)
        if not os.path.isfile(full_path):
            return web.json_response({"error": "not found"}, status=404)

        try:
            os.remove(full_path)
        except OSError as e:
            return web.json_response({"error": str(e)}, status=500)

        logger.info("Deleted dotfile: %s", norm)
        return web.json_response({"ok": True, "filename": norm})

    # --- Preference Handlers ---

    async def _handle_get_preferences(self, request: web.Request) -> web.Response:
        """Get user terminal preferences."""
        shell = self._get_preferred_shell()
        return web.json_response({"default_shell": shell})

    async def _handle_set_preferences(self, request: web.Request) -> web.Response:
        """Set user terminal preferences."""
        body = await request.json()
        shell = body.get("default_shell", "")

        if shell not in ("bash", "zsh", "fish"):
            return web.json_response(
                {"error": f"Invalid shell: {shell}. Must be bash, zsh, or fish."},
                status=400,
            )

        self._set_preferred_shell(shell)
        logger.info("Set preferred shell: %s", shell)
        return web.json_response({"ok": True, "default_shell": shell})

    # --- WebSocket Handler ---

    async def _handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        terminal_id = request.match_info.get("terminal_id")

        # If no terminal_id, create a default shell session
        if not terminal_id:
            self._session_counter += 1
            terminal_id = f"term-{self._session_counter}"
            self._create_tmux_window(terminal_id, label=terminal_id, cli_type="shell")

        session = self._sessions.get(terminal_id)
        if not session:
            # Maybe the session exists in tmux but we don't have metadata
            # (e.g. after restart). Try to attach anyway.
            if not self._window_alive(terminal_id):
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
            # Re-register it
            session = _TmuxSession(
                terminal_id=terminal_id,
                label=terminal_id,
                cli_type="shell",
                window_name=terminal_id,
            )
            self._sessions[terminal_id] = session

        logger.info("Terminal WebSocket opened: id=%s cli_type=%s", terminal_id, session.cli_type)

        handle = self._attach_pty(session.window_name)
        try:
            _set_pty_size(handle.master_fd, DEFAULT_ROWS, DEFAULT_COLS)

            loop = asyncio.get_running_loop()
            read_task = asyncio.create_task(self._pty_to_ws(loop, handle.master_fd, ws))

            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    msg_type = data.get("type")

                    if msg_type == "input":
                        os.write(handle.master_fd, data["data"].encode())
                    elif msg_type == "resize":
                        cols = data.get("cols", DEFAULT_COLS)
                        rows = data.get("rows", DEFAULT_ROWS)
                        _set_pty_size(handle.master_fd, rows, cols)

                elif msg.type == web.WSMsgType.BINARY:
                    os.write(handle.master_fd, msg.data)

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
            # Clean up the attach handle — tmux window stays alive
            self._cleanup_attach(handle)
            if not ws.closed:
                await ws.close()
            logger.info("Terminal WebSocket closed: id=%s (tmux window preserved)", terminal_id)

        return ws

    # --- PTY I/O ---

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
        """Blocking read from file descriptor (runs in executor)."""
        import select

        ready, _, _ = select.select([fd], [], [], PTY_READ_TIMEOUT_SECONDS)
        if not ready:
            return None
        try:
            return os.read(fd, PTY_READ_BUFFER_SIZE)
        except OSError:
            return b""
