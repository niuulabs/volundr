"""Local process adapter for pod management.

Runs Claude Code as a local subprocess instead of Kubernetes pods.
Implements PodManager so Volundr's SessionService, REST endpoints,
and event pipeline work unchanged — only the pod manager swaps from
K8s to local process.

Constructor accepts plain kwargs (dynamic adapter pattern):
    adapter: "volundr.adapters.outbound.local_process.LocalProcessPodManager"
    workspaces_dir: "~/.niuu/workspaces"
    claude_binary: "claude"
    max_concurrent: 4
    sdk_port_start: 9100
    stop_timeout: 10
    state_file: "~/.niuu/forge-state.json"
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import signal
import socket
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from volundr.domain.models import (
    GitSource,
    LocalMountSource,
    Session,
    SessionSpec,
    SessionStatus,
)
from volundr.domain.ports import PodManager, PodStartResult

logger = logging.getLogger(__name__)

# Default configuration values
DEFAULT_WORKSPACES_DIR = "~/.niuu/workspaces"
DEFAULT_CLAUDE_BINARY = "claude"
DEFAULT_MAX_CONCURRENT = 4
DEFAULT_SDK_PORT_START = 9100
DEFAULT_STOP_TIMEOUT = 10
DEFAULT_STATE_FILE = "~/.niuu/forge-state.json"
DEFAULT_ALLOWED_MOUNT_PREFIXES: list[str] = []

# Poll interval for wait_for_ready
READY_POLL_INTERVAL = 0.5


class ProcessState(StrEnum):
    """State of a managed Claude process."""

    STARTING = "starting"
    RUNNING = "running"
    STOPPED = "stopped"
    FAILED = "failed"


@dataclass
class ProcessInfo:
    """Tracked state for a managed Claude process."""

    session_id: str
    pid: int | None = None
    port: int | None = None
    workspace: str = ""
    state: ProcessState = ProcessState.STARTING
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to JSON-safe dict."""
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> ProcessInfo:
        """Deserialize from dict."""
        return ProcessInfo(
            session_id=data["session_id"],
            pid=data.get("pid"),
            port=data.get("port"),
            workspace=data.get("workspace", ""),
            state=ProcessState(data.get("state", "stopped")),
            error=data.get("error"),
        )


class SdkPortAllocator:
    """Allocates SDK ports from a configurable range.

    Tracks allocated ports and verifies availability via socket bind test.
    """

    def __init__(self, start_port: int = DEFAULT_SDK_PORT_START):
        self._start_port = start_port
        self._allocated: set[int] = set()
        self._next_port = start_port

    @property
    def allocated(self) -> set[int]:
        """Currently allocated ports."""
        return set(self._allocated)

    def allocate(self) -> int:
        """Allocate the next free port.

        Returns:
            An available port number.

        Raises:
            RuntimeError: If no free port can be found after scanning a range.
        """
        scanned = 0
        max_scan = 1000
        while scanned < max_scan:
            port = self._next_port
            self._next_port += 1
            scanned += 1

            if port in self._allocated:
                continue

            if not self._is_port_free(port):
                continue

            self._allocated.add(port)
            return port

        raise RuntimeError(
            f"No free SDK port found after scanning {max_scan} ports from {self._start_port}"
        )

    def release(self, port: int) -> None:
        """Return a port to the pool."""
        self._allocated.discard(port)

    @staticmethod
    def _is_port_free(port: int) -> bool:
        """Check if a port is free by attempting to bind to it."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", port))
                return True
        except OSError:
            return False


def _inject_token_into_url(repo_url: str, token: str) -> str:
    """Rewrite a git URL to include an access token for cloning.

    Supports https://github.com/... and https://gitlab.com/... patterns.
    """
    if not token:
        return repo_url

    pattern = r"^https://(github\.com|gitlab\.com)/"
    if re.match(pattern, repo_url):
        return re.sub(
            r"^https://",
            f"https://x-access-token:{token}@",
            repo_url,
        )

    return repo_url


class LocalProcessPodManager(PodManager):
    """Manages Claude Code as local subprocesses.

    Implements PodManager so Volundr's existing SessionService, REST
    endpoints, and event pipeline work unchanged.
    """

    def __init__(
        self,
        *,
        workspaces_dir: str = DEFAULT_WORKSPACES_DIR,
        claude_binary: str = DEFAULT_CLAUDE_BINARY,
        max_concurrent: int = DEFAULT_MAX_CONCURRENT,
        sdk_port_start: int = DEFAULT_SDK_PORT_START,
        stop_timeout: int = DEFAULT_STOP_TIMEOUT,
        state_file: str = DEFAULT_STATE_FILE,
        allowed_mount_prefixes: list[str] | None = None,
        **_extra: object,
    ):
        self._workspaces_dir = Path(workspaces_dir).expanduser()
        self._claude_binary = claude_binary
        self._max_concurrent = max_concurrent
        self._stop_timeout = stop_timeout
        self._state_file = Path(state_file).expanduser()
        self._allowed_mount_prefixes = allowed_mount_prefixes or DEFAULT_ALLOWED_MOUNT_PREFIXES

        self._port_allocator = SdkPortAllocator(start_port=sdk_port_start)
        self._processes: dict[str, ProcessInfo] = {}
        self._monitors: dict[str, asyncio.Task] = {}

        self._load_state()

    # ------------------------------------------------------------------
    # PodManager interface
    # ------------------------------------------------------------------

    async def start(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> PodStartResult:
        """Provision workspace, spawn Claude process, return endpoints."""
        session_id = str(session.id)

        if len(self._active_sessions()) >= self._max_concurrent:
            raise RuntimeError(f"Max concurrent sessions ({self._max_concurrent}) reached")

        workspace = await self._provision_workspace(session, spec)
        port = self._port_allocator.allocate()

        info = ProcessInfo(
            session_id=session_id,
            port=port,
            workspace=str(workspace),
            state=ProcessState.STARTING,
        )
        self._processes[session_id] = info
        self._persist_state()

        try:
            pid = await self._spawn_claude(session, spec, workspace, port)
            info.pid = pid
            info.state = ProcessState.RUNNING
            self._persist_state()

            monitor = asyncio.create_task(
                self._monitor_process(session_id, pid),
                name=f"monitor-{session_id}",
            )
            self._monitors[session_id] = monitor

        except Exception:
            info.state = ProcessState.FAILED
            self._port_allocator.release(port)
            self._persist_state()
            raise

        chat_endpoint = f"ws://127.0.0.1:{port}/ws/cli/{session_id}"
        code_endpoint = f"file://{workspace}"
        pod_name = f"local-{session_id[:8]}"

        return PodStartResult(
            chat_endpoint=chat_endpoint,
            code_endpoint=code_endpoint,
            pod_name=pod_name,
        )

    async def stop(self, session: Session) -> bool:
        """Stop the Claude process for a session."""
        session_id = str(session.id)
        info = self._processes.get(session_id)

        if info is None:
            return False

        if info.state not in (ProcessState.RUNNING, ProcessState.STARTING):
            return True

        monitor = self._monitors.pop(session_id, None)
        if monitor and not monitor.done():
            monitor.cancel()

        if info.pid is not None:
            await self._terminate_process(info.pid)

        if info.port is not None:
            self._port_allocator.release(info.port)

        info.state = ProcessState.STOPPED
        self._persist_state()
        return True

    async def status(self, session: Session) -> SessionStatus:
        """Get the current status of the local Claude process."""
        session_id = str(session.id)
        info = self._processes.get(session_id)

        if info is None:
            return SessionStatus.STOPPED

        match info.state:
            case ProcessState.STARTING:
                return SessionStatus.PROVISIONING
            case ProcessState.RUNNING:
                return SessionStatus.RUNNING
            case ProcessState.STOPPED:
                return SessionStatus.STOPPED
            case ProcessState.FAILED:
                return SessionStatus.FAILED

    async def wait_for_ready(self, session: Session, timeout: float) -> SessionStatus:
        """Wait until the Claude process is running or fails."""
        session_id = str(session.id)
        elapsed = 0.0

        while elapsed < timeout:
            info = self._processes.get(session_id)

            if info is None:
                return SessionStatus.FAILED

            if info.state == ProcessState.RUNNING:
                return SessionStatus.RUNNING

            if info.state == ProcessState.FAILED:
                return SessionStatus.FAILED

            if info.state == ProcessState.STOPPED:
                return SessionStatus.STOPPED

            await asyncio.sleep(READY_POLL_INTERVAL)
            elapsed += READY_POLL_INTERVAL

        return SessionStatus.FAILED

    # ------------------------------------------------------------------
    # Workspace provisioning
    # ------------------------------------------------------------------

    async def _provision_workspace(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> Path:
        """Create workspace directory and set up source code."""
        workspace = self._workspaces_dir / str(session.id)
        workspace.mkdir(parents=True, exist_ok=True)

        if isinstance(session.source, GitSource) and session.source.repo:
            await self._clone_repo(session.source, workspace, spec)
        elif isinstance(session.source, LocalMountSource):
            self._setup_local_mounts(session.source, workspace)

        self._write_claude_md(workspace, spec)
        return workspace

    async def _clone_repo(
        self,
        source: GitSource,
        workspace: Path,
        spec: SessionSpec,
    ) -> None:
        """Clone a git repository into the workspace."""
        token = spec.values.get("git_token", "")
        clone_url = _inject_token_into_url(source.repo, token)

        proc = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--depth",
            "1",
            clone_url,
            str(workspace / "repo"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"Git clone failed: {stderr.decode(errors='replace')}")

        repo_dir = workspace / "repo"
        branch = source.branch
        base_branch = source.base_branch

        if branch:
            checkout_ok = await self._checkout_branch(repo_dir, branch)
            if not checkout_ok and base_branch:
                await self._checkout_branch(repo_dir, base_branch)

    async def _checkout_branch(self, repo_dir: Path, branch: str) -> bool:
        """Attempt to checkout a branch. Returns True on success."""
        proc = await asyncio.create_subprocess_exec(
            "git",
            "-C",
            str(repo_dir),
            "checkout",
            branch,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        return proc.returncode == 0

    def _setup_local_mounts(
        self,
        source: LocalMountSource,
        workspace: Path,
    ) -> None:
        """Create symlinks for local mount sources."""
        for mapping in source.paths:
            host = Path(mapping.host_path)

            if not self._is_allowed_mount(host):
                logger.warning("Skipping mount %s: not in allowed prefixes", host)
                continue

            if not host.exists():
                logger.warning("Skipping mount %s: path does not exist", host)
                continue

            link_name = workspace / host.name
            if link_name.exists():
                continue

            link_name.symlink_to(host)

    def _is_allowed_mount(self, path: Path) -> bool:
        """Check if a path is under one of the allowed mount prefixes."""
        if not self._allowed_mount_prefixes:
            return True

        resolved = path.resolve()
        return any(
            str(resolved).startswith(str(Path(prefix).resolve()))
            for prefix in self._allowed_mount_prefixes
        )

    @staticmethod
    def _write_claude_md(workspace: Path, spec: SessionSpec) -> None:
        """Write CLAUDE.md with system prompt and session config."""
        system_prompt = spec.values.get("system_prompt", "")
        initial_prompt = spec.values.get("initial_prompt", "")

        parts: list[str] = []
        if system_prompt:
            parts.append(system_prompt)
        if initial_prompt:
            parts.append(f"\n## Initial Task\n\n{initial_prompt}")

        if parts:
            claude_md = workspace / "CLAUDE.md"
            claude_md.write_text("\n".join(parts), encoding="utf-8")

    # ------------------------------------------------------------------
    # Process spawning & monitoring
    # ------------------------------------------------------------------

    async def _spawn_claude(
        self,
        session: Session,
        spec: SessionSpec,
        workspace: Path,
        port: int,
    ) -> int:
        """Spawn a Claude Code subprocess.

        Returns:
            The PID of the spawned process.
        """
        binary = self._resolve_claude_binary()
        session_id = str(session.id)

        args = [
            binary,
            "--sdk-url",
            f"ws://127.0.0.1:{port}/ws/cli/{session_id}",
        ]

        env = self._build_env(spec, workspace)
        log_path = workspace / ".forge-claude.log"

        log_file = log_path.open("w", encoding="utf-8")

        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=log_file,
            stderr=log_file,
            cwd=str(workspace),
            env=env,
        )

        logger.info(
            "Spawned Claude process pid=%d port=%d session=%s",
            process.pid,
            port,
            session_id,
        )
        return process.pid

    def _resolve_claude_binary(self) -> str:
        """Resolve the path to the claude binary."""
        if os.path.isabs(self._claude_binary):
            if os.path.isfile(self._claude_binary):
                return self._claude_binary
            raise FileNotFoundError(f"Claude binary not found: {self._claude_binary}")

        found = shutil.which(self._claude_binary)
        if found:
            return found

        raise FileNotFoundError(f"Claude binary '{self._claude_binary}' not found in PATH")

    @staticmethod
    def _build_env(spec: SessionSpec, workspace: Path) -> dict[str, str]:
        """Build environment variables for the Claude process."""
        env = dict(os.environ)
        env["WORKSPACE_DIR"] = str(workspace)

        api_key = spec.values.get("anthropic_api_key", "")
        if api_key:
            env["ANTHROPIC_API_KEY"] = api_key

        git_token = spec.values.get("git_token", "")
        if git_token:
            env["GIT_TOKEN"] = git_token

        extra_env = spec.values.get("env", {})
        if isinstance(extra_env, dict):
            for key, value in extra_env.items():
                env[str(key)] = str(value)

        return env

    async def _monitor_process(self, session_id: str, pid: int) -> None:
        """Monitor a Claude process and update state on exit."""
        try:
            while True:
                try:
                    os.kill(pid, 0)
                except OSError:
                    break
                await asyncio.sleep(READY_POLL_INTERVAL)

            info = self._processes.get(session_id)
            if info and info.state == ProcessState.RUNNING:
                info.state = ProcessState.STOPPED
                if info.port is not None:
                    self._port_allocator.release(info.port)
                self._persist_state()
                logger.info("Claude process exited pid=%d session=%s", pid, session_id)
        except asyncio.CancelledError:
            return

    # ------------------------------------------------------------------
    # Process lifecycle
    # ------------------------------------------------------------------

    async def _terminate_process(self, pid: int) -> None:
        """Send SIGTERM, wait for timeout, then SIGKILL if needed."""
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            return

        for _ in range(self._stop_timeout * 2):
            await asyncio.sleep(0.5)
            try:
                os.kill(pid, 0)
            except OSError:
                return

        try:
            os.kill(pid, signal.SIGKILL)
            logger.warning("Sent SIGKILL to pid=%d after timeout", pid)
        except OSError:
            pass

    # ------------------------------------------------------------------
    # State persistence
    # ------------------------------------------------------------------

    def _persist_state(self) -> None:
        """Write process state to JSON file."""
        self._state_file.parent.mkdir(parents=True, exist_ok=True)

        data = {sid: info.to_dict() for sid, info in self._processes.items()}

        tmp_path = self._state_file.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(data, indent=2, default=str),
            encoding="utf-8",
        )
        tmp_path.replace(self._state_file)

    def _load_state(self) -> None:
        """Load state from JSON file, marking stale sessions as stopped."""
        if not self._state_file.exists():
            return

        try:
            data = json.loads(self._state_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load state file: %s", exc)
            return

        for sid, info_data in data.items():
            info = ProcessInfo.from_dict(info_data)
            if info.state in (ProcessState.RUNNING, ProcessState.STARTING):
                if info.pid is not None and self._is_process_alive(info.pid):
                    info.state = ProcessState.RUNNING
                else:
                    info.state = ProcessState.STOPPED
                    logger.info(
                        "Marked stale session %s as stopped (process dead)",
                        sid,
                    )
            self._processes[sid] = info

        self._persist_state()

    @staticmethod
    def _is_process_alive(pid: int) -> bool:
        """Check if a process is still running."""
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _active_sessions(self) -> list[str]:
        """Return session IDs with active (running/starting) processes."""
        return [
            sid
            for sid, info in self._processes.items()
            if info.state in (ProcessState.RUNNING, ProcessState.STARTING)
        ]
