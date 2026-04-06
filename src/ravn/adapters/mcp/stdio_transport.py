"""Stdio MCP transport — spawns a subprocess and communicates via stdin/stdout."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from ravn.adapters.mcp.transport import MCPTransport, MCPTransportError

logger = logging.getLogger(__name__)

_READ_TIMEOUT_SECONDS = 30.0
_PROCESS_WAIT_TIMEOUT_SECONDS = 5.0


class StdioTransport(MCPTransport):
    """Communicates with an MCP server over stdin/stdout.

    The server is spawned as a subprocess.  Messages are newline-delimited
    JSON-RPC 2.0 frames sent over stdin; responses are read from stdout.
    """

    def __init__(
        self,
        command: str,
        args: list[str],
        env: dict[str, str] | None = None,
        *,
        read_timeout: float = _READ_TIMEOUT_SECONDS,
    ) -> None:
        self._command = command
        self._args = args
        self._env = env or {}
        self._read_timeout = read_timeout
        self._process: asyncio.subprocess.Process | None = None

    async def start(self) -> None:
        """Spawn the subprocess."""
        merged_env = {**os.environ, **self._env}
        try:
            self._process = await asyncio.create_subprocess_exec(
                self._command,
                *self._args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=merged_env,
            )
        except (FileNotFoundError, PermissionError) as exc:
            raise MCPTransportError(f"Failed to spawn MCP server: {exc}") from exc

        logger.debug("Spawned MCP stdio server pid=%s", self._process.pid)

    async def send(self, message: dict[str, Any]) -> None:
        if self._process is None or self._process.stdin is None:
            raise MCPTransportError("Transport not started")
        if self._process.returncode is not None:
            raise MCPTransportError("MCP server process has exited")

        data = self._encode(message)
        self._process.stdin.write(data)
        await self._process.stdin.drain()

    async def receive(self) -> dict[str, Any]:
        if self._process is None or self._process.stdout is None:
            raise MCPTransportError("Transport not started")

        try:
            line = await asyncio.wait_for(
                self._process.stdout.readline(),
                timeout=self._read_timeout,
            )
        except TimeoutError:
            raise MCPTransportError("Timed out waiting for MCP server response")

        if not line:
            raise MCPTransportError("MCP server closed stdout (EOF)")

        try:
            return self._decode(line)
        except (ValueError, KeyError) as exc:
            raise MCPTransportError(f"Invalid JSON from MCP server: {exc}") from exc

    async def close(self) -> None:
        if self._process is None:
            return

        try:
            if self._process.stdin is not None:
                self._process.stdin.close()
            try:
                await asyncio.wait_for(
                    self._process.wait(),
                    timeout=_PROCESS_WAIT_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                self._process.kill()
                await self._process.wait()
        except Exception as exc:
            logger.debug("Error closing stdio transport: %s", exc)
        finally:
            self._process = None

    @property
    def is_alive(self) -> bool:
        return self._process is not None and self._process.returncode is None
