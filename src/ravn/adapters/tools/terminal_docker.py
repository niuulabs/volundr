"""Docker-sandboxed terminal backend.

Runs commands inside an ephemeral Docker container rather than the host
shell.  A single container is started per task; shell state (cwd,
environment variables) persists across calls within that container.
The container is destroyed cleanly when :meth:`DockerTerminalTool.close`
is called or on interruption.

Sandboxing properties
---------------------
* **Network isolation** — the container's network is ``none`` by default
  (no outbound or inbound traffic).  Set ``network`` to ``"bridge"`` or
  ``"host"`` in :class:`~ravn.config.DockerTerminalConfig` to relax this.
* **Filesystem isolation** — only the workspace directory is mounted
  read-write.  The host filesystem outside the workspace is not visible
  unless ``extra_mounts`` are configured.
* **Ephemeral** — the container is started with ``--rm`` so it is removed
  automatically if the process exits unexpectedly.

Usage::

    tool = DockerTerminalTool(config=DockerTerminalConfig(), workspace_root=Path("."))
    result = await tool.execute({"command": "echo hello"})
    await tool.close()

Or wire via :class:`~ravn.config.TerminalToolConfig` with ``backend="docker"``.
"""

from __future__ import annotations

import asyncio
import logging
import shlex
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ravn.config import DockerTerminalConfig
from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort

logger = logging.getLogger(__name__)

_PERMISSION_SHELL = "shell:execute"
_SENTINEL_PREFIX = "RAVN_DONE"
_DEFAULT_SHELL = "/bin/bash"
_DEFAULT_TIMEOUT_SECONDS = 30.0
_CONTAINER_STOP_TIMEOUT_SECONDS = 5.0
_CONTAINER_REMOVE_TIMEOUT_SECONDS = 10.0


# ---------------------------------------------------------------------------
# Shell state (checkpoint / resume)
# ---------------------------------------------------------------------------


@dataclass
class ShellState:
    """Snapshot of a Docker shell's state for checkpoint/resume.

    ``cwd`` is the current working directory; ``env_exports`` is the
    output of ``export -p`` — the full set of exported variables in
    POSIX-portable syntax, suitable for re-sourcing into a fresh shell.
    """

    cwd: str = ""
    env_exports: str = field(default="", repr=False)


# ---------------------------------------------------------------------------
# DockerPersistentShell
# ---------------------------------------------------------------------------


class DockerPersistentShell:
    """Manages a long-lived bash session inside an ephemeral Docker container.

    A single container is started on the first :meth:`run` call.  Commands
    are written to the container's stdin pipe; a UUID sentinel echoed after
    each command marks the end of output.  This preserves ``cd``, ``export``,
    and venv activations across calls — identical semantics to
    :class:`~ravn.adapters.tools.terminal.PersistentShell`.

    The container is destroyed when :meth:`close` is called (or on timeout).

    Args:
        config:           Docker configuration (image, network, mounts).
        workspace_root:   Host path mounted read-write at the same path
                          inside the container when ``mount_workspace=True``.
        timeout_seconds:  Per-command timeout.
    """

    def __init__(
        self,
        config: DockerTerminalConfig,
        workspace_root: Path,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._config = config
        self._workspace_root = workspace_root.resolve()
        self._timeout = timeout_seconds
        self._container_name: str | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """True if the container process is alive."""
        return self._process is not None and self._process.returncode is None

    async def start(self) -> None:
        """Start the Docker container (no-op if already running)."""
        if self.is_running:
            return

        self._container_name = f"ravn-sandbox-{uuid.uuid4().hex[:12]}"
        cmd = self._build_docker_cmd()

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        logger.debug(
            "DockerPersistentShell started container=%s image=%s pid=%s",
            self._container_name,
            self._config.image,
            self._process.pid,
        )

    def _build_docker_cmd(self) -> list[str]:
        """Build the ``docker run`` command list."""
        cmd = [
            "docker",
            "run",
            "--rm",
            "--interactive",
            "--name",
            self._container_name,  # type: ignore[list-item]
            f"--network={self._config.network}",
        ]

        if self._config.mount_workspace:
            ws = str(self._workspace_root)
            cmd.extend(["-v", f"{ws}:{ws}", "-w", ws])

        for mount in self._config.extra_mounts:
            cmd.extend(["-v", mount])

        cmd.extend([self._config.image, _DEFAULT_SHELL, "--norc", "--noprofile"])
        return cmd

    async def close(self) -> None:
        """Cleanly terminate the container and shell process."""
        if not self.is_running:
            await self._force_remove_container()
            return

        assert self._process is not None  # noqa: S101 — narrowing
        assert self._process.stdin is not None  # noqa: S101 — narrowing

        try:
            self._process.stdin.write(b"exit 0\n")
            await self._process.stdin.drain()
            await asyncio.wait_for(self._process.wait(), timeout=_CONTAINER_STOP_TIMEOUT_SECONDS)
        except Exception:
            self._process.kill()
            await self._process.wait()
        finally:
            self._process = None
            await self._force_remove_container()
            logger.debug("DockerPersistentShell closed container=%s", self._container_name)

    async def _force_remove_container(self) -> None:
        """Remove the container by name, ignoring errors (already gone is fine)."""
        if not self._container_name:
            return
        name = self._container_name
        self._container_name = None
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker",
                "rm",
                "-f",
                name,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=_CONTAINER_REMOVE_TIMEOUT_SECONDS)
        except Exception:
            logger.debug("docker rm -f %s failed (container may already be gone)", name)

    async def __aenter__(self) -> DockerPersistentShell:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    # ------------------------------------------------------------------
    # Command execution
    # ------------------------------------------------------------------

    async def run(self, command: str) -> tuple[str, int]:
        """Run *command* inside the Docker container.

        Returns ``(output, exit_code)``.  On timeout, output is truncated
        and exit code 124 is returned (matching ``timeout(1)`` convention).
        The container is killed on timeout to avoid output pollution.
        """
        if not self.is_running:
            await self.start()

        async with self._lock:
            return await self._run_locked(command)

    async def _run_locked(self, command: str) -> tuple[str, int]:
        assert self._process is not None  # noqa: S101 — narrowing
        assert self._process.stdin is not None  # noqa: S101 — narrowing
        assert self._process.stdout is not None  # noqa: S101 — narrowing

        sentinel = f"{_SENTINEL_PREFIX}_{uuid.uuid4().hex}"
        # Do NOT wrap in a subshell — we want cd/export to persist.
        wrapped = f"{command}\necho {sentinel}:$?\n"

        self._process.stdin.write(wrapped.encode())
        await self._process.stdin.drain()

        output_lines: list[str] = []
        try:
            async with asyncio.timeout(self._timeout):
                while True:
                    line_bytes = await self._process.stdout.readline()
                    if not line_bytes:
                        # EOF — container exited (e.g. command was "exit N").
                        try:
                            await asyncio.wait_for(
                                self._process.wait(), timeout=_CONTAINER_STOP_TIMEOUT_SECONDS
                            )
                        except TimeoutError:
                            pass
                        actual_rc = (
                            self._process.returncode if self._process.returncode is not None else 1
                        )
                        self._process = None
                        return "\n".join(output_lines), actual_rc
                    line_str = line_bytes.decode(errors="replace").rstrip("\n")
                    if line_str.startswith(f"{sentinel}:"):
                        exit_code_str = line_str[len(sentinel) + 1 :]
                        exit_code = int(exit_code_str) if exit_code_str.isdigit() else 1
                        break
                    output_lines.append(line_str)
        except TimeoutError:
            if self._process is not None:
                logger.warning(
                    "DockerPersistentShell timed out — killing container=%s",
                    self._container_name,
                )
                self._process.kill()
                await self._process.wait()
                self._process = None
            return "\n".join(output_lines) + "\n[timed out]", 124

        return "\n".join(output_lines), exit_code

    # ------------------------------------------------------------------
    # State capture / restore
    # ------------------------------------------------------------------

    async def get_state(self) -> ShellState:
        """Capture the current shell state (cwd + exported env vars)."""
        cwd, _ = await self.run("pwd")
        env, _ = await self.run("export -p")
        return ShellState(cwd=cwd.strip(), env_exports=env)

    async def restore_state(self, state: ShellState) -> None:
        """Restore shell to a previously captured state.

        Re-sources environment exports and changes to the saved working
        directory.  Errors are silently ignored so the shell remains usable.
        """
        if state.env_exports:
            await self.run(state.env_exports)
        if state.cwd:
            await self.run(f"cd {shlex.quote(state.cwd)} 2>/dev/null || true")


# ---------------------------------------------------------------------------
# DockerTerminalTool
# ---------------------------------------------------------------------------


class DockerTerminalTool(ToolPort):
    """Execute shell commands inside an ephemeral Docker container.

    Implements the same :class:`~ravn.ports.tool.ToolPort` interface as
    :class:`~ravn.adapters.tools.terminal.TerminalTool` — the tool registry
    treats them identically; backend selection is done by configuration.

    One container is started per task (on first ``execute`` call).  Shell
    state — working directory, environment variables, activated venvs —
    persists across calls within the container.

    Pass ``initial_state`` to resume from a previously checkpointed
    :class:`ShellState` (e.g. for task restart after interruption).

    Args:
        config:         :class:`~ravn.config.DockerTerminalConfig` instance.
        workspace_root: Host path to mount read-write inside the container.
        timeout_seconds: Per-command execution timeout.
        initial_state:  Optional shell state to restore on first call.
    """

    def __init__(
        self,
        config: DockerTerminalConfig | None = None,
        workspace_root: Path | None = None,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        initial_state: ShellState | None = None,
    ) -> None:
        self._config = config or DockerTerminalConfig()
        self._workspace_root = (workspace_root or Path.cwd()).resolve()
        self._timeout = timeout_seconds
        self._initial_state = initial_state
        self._shell: DockerPersistentShell | None = None

    # ------------------------------------------------------------------
    # ToolPort interface
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        return "terminal"

    @property
    def description(self) -> str:
        return (
            "Run a shell command inside an isolated Docker container and return its "
            "combined stdout/stderr output. "
            "Working directory, environment variables, and activated virtual "
            "environments persist across calls within the same task. "
            "The container is destroyed cleanly when the task ends."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute inside the Docker sandbox.",
                },
            },
            "required": ["command"],
        }

    @property
    def required_permission(self) -> str:
        return _PERMISSION_SHELL

    @property
    def parallelisable(self) -> bool:
        return False

    async def execute(self, input: dict) -> ToolResult:
        command = input.get("command", "").strip()
        if not command:
            return ToolResult(tool_call_id="", content="No command provided.", is_error=True)

        if self._shell is None:
            self._shell = DockerPersistentShell(
                config=self._config,
                workspace_root=self._workspace_root,
                timeout_seconds=self._timeout,
            )
            await self._shell.start()
            if self._initial_state is not None:
                await self._shell.restore_state(self._initial_state)

        output, exit_code = await self._shell.run(command)
        return self._build_result(output, exit_code)

    # ------------------------------------------------------------------
    # State / cleanup
    # ------------------------------------------------------------------

    async def get_state(self) -> ShellState | None:
        """Return the current shell state for checkpointing.

        Returns ``None`` if the container has not been started yet.
        """
        if self._shell is None or not self._shell.is_running:
            return None
        return await self._shell.get_state()

    async def close(self) -> None:
        """Destroy the Docker container and clean up resources."""
        if self._shell is not None:
            await self._shell.close()
            self._shell = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_result(output: str, exit_code: int) -> ToolResult:
        content = output.rstrip("\n")
        if exit_code != 0:
            suffix = f"\n[exit {exit_code}]"
            content = (content + suffix).strip()
        return ToolResult(tool_call_id="", content=content, is_error=exit_code != 0)
