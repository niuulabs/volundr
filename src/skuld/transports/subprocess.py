"""SubprocessTransport — legacy path (one process per message)."""

import asyncio
import json
import logging

from niuu.adapters.cli.runtime import (
    drain_process_stream as _drain_stream,
)
from niuu.adapters.cli.runtime import (
    filter_cli_event as _filter_event,
)
from niuu.adapters.cli.runtime import (
    stop_subprocess as _stop_process,
)
from niuu.ports.cli import CLITransport, TransportCapabilities

logger = logging.getLogger("skuld.transport")


class SubprocessTransport(CLITransport):
    """Spawns `claude -p` per message, reads stdout for JSON events.

    This is a refactor of the original ClaudeCodeProcess class, preserving
    identical behavior as a fallback transport.
    """

    def __init__(self, workspace_dir: str) -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._session_id: str | None = None
        self._last_result: dict | None = None

    async def start(self) -> None:
        logger.info("SubprocessTransport configured for %s", self.workspace_dir)

    async def stop(self) -> None:
        async with self._lock:
            if self._process is None:
                return
            await _stop_process(self._process)
            self._process = None

    async def send_message(self, content: str) -> None:
        self._last_result = None

        cmd = [
            "claude",
            "-p",
            content,
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
        ]
        if self._session_id:
            cmd.extend(["--resume", self._session_id])

        logger.info("Running Claude CLI (session: %s)", self._session_id)

        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=self.workspace_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._process = process

        stderr_task = asyncio.create_task(_drain_stream(process.stderr, "stderr"))

        try:
            if process.stdout is None:
                raise RuntimeError("Claude Code CLI stdout not available")

            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                raw = line.decode().strip()
                if not raw:
                    continue

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError as e:
                    logger.warning("Skipping non-JSON line: %s (%s)", raw[:200], e)
                    continue

                if data.get("session_id"):
                    self._session_id = data["session_id"]

                event_type = data.get("type", "unknown")

                if event_type == "result":
                    self._last_result = data

                filtered = _filter_event(data)
                if filtered:
                    await self._emit(filtered)

                if event_type == "result":
                    break

            exit_code = await process.wait()
            if exit_code != 0:
                raise RuntimeError(f"Claude Code CLI exited with code {exit_code}")
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
            self._process = None

    @property
    def capabilities(self) -> TransportCapabilities:
        return TransportCapabilities(session_resume=True)

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return self._process is not None
