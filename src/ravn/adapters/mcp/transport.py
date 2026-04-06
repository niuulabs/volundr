"""Abstract MCP transport protocol.

Each concrete transport handles the wire-level JSON-RPC 2.0 communication
with a single MCP server process or endpoint.
"""

from __future__ import annotations

import abc
import json
from typing import Any


class MCPTransportError(Exception):
    """Raised when transport-level communication fails."""


class MCPTransport(abc.ABC):
    """Abstract base class for MCP transports.

    Responsible for sending JSON-RPC requests and receiving responses.
    Transport instances are not thread-safe; use one per server connection.
    """

    @abc.abstractmethod
    async def start(self) -> None:
        """Start the transport (spawn process, open connection, etc.)."""

    @abc.abstractmethod
    async def send(self, message: dict[str, Any]) -> None:
        """Send a JSON-RPC message to the server."""

    @abc.abstractmethod
    async def receive(self) -> dict[str, Any]:
        """Receive and parse the next JSON-RPC message from the server."""

    @abc.abstractmethod
    async def close(self) -> None:
        """Gracefully shut down the transport."""

    @property
    @abc.abstractmethod
    def is_alive(self) -> bool:
        """Return True if the transport connection is alive."""

    def set_auth_headers(self, headers: dict[str, str]) -> None:
        """Inject authentication headers into outgoing HTTP requests.

        No-op for transports that do not use HTTP (e.g. stdio).  HTTP and SSE
        transports override this to merge *headers* into every outgoing POST.
        """

    # ------------------------------------------------------------------
    # Helpers shared by all transports
    # ------------------------------------------------------------------

    @staticmethod
    def _encode(message: dict[str, Any]) -> bytes:
        return (json.dumps(message) + "\n").encode()

    @staticmethod
    def _decode(line: bytes | str) -> dict[str, Any]:
        text = line.decode() if isinstance(line, bytes) else line
        return json.loads(text.strip())  # type: ignore[return-value]
