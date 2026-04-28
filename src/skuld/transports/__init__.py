"""CLI transport abstraction for communicating with AI coding CLIs.

This package provides:
- CLITransport ABC and EventCallback type alias
- Shared helpers: _filter_event, _drain_stream, _stop_process
- Concrete transports: SubprocessTransport, SdkWebSocketTransport,
  CodexSubprocessTransport
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger("skuld.transport")

EventCallback = Callable[[dict], Awaitable[None]]


@dataclass(frozen=True)
class TransportCapabilities:
    """Declares what a transport supports.

    All fields default to False so new transports are safe-by-default.
    ``send_message`` defaults to True because every transport can receive
    user messages.
    """

    send_message: bool = True
    cli_websocket: bool = False
    session_resume: bool = False
    interrupt: bool = False
    set_model: bool = False
    set_thinking_tokens: bool = False
    set_permission_mode: bool = False
    rewind_files: bool = False
    mcp_set_servers: bool = False
    permission_requests: bool = False
    slash_commands: bool = False
    skills: bool = False


class CLITransport(ABC):
    """Abstract transport for communicating with Claude Code CLI."""

    def __init__(self) -> None:
        self._event_callback: EventCallback | None = None

    def on_event(self, callback: EventCallback | None) -> None:
        """Register a callback for CLI events (assistant, result, etc)."""
        self._event_callback = callback

    @property
    def event_callback(self) -> EventCallback | None:
        """Return the currently registered event callback (or None)."""
        return self._event_callback

    async def _emit(self, data: dict) -> None:
        """Fire the event callback if registered."""
        if not self._event_callback:
            logger.debug(
                "_emit: no callback registered, dropping type=%s",
                data.get("type"),
            )
            return
        await self._event_callback(data)

    @abstractmethod
    async def start(self) -> None:
        """Initialize the transport."""

    @abstractmethod
    async def stop(self) -> None:
        """Shut down the transport and clean up."""

    @abstractmethod
    async def send_message(self, content: str) -> None:
        """Send a user message to Claude Code."""

    async def send_control_response(self, request_id: str, response: dict) -> None:
        """Respond to a CLI-initiated control_request (e.g. can_use_tool).

        No-op for transports that don't support the control protocol.
        """

    async def send_control(self, subtype: str, **kwargs: object) -> None:
        """Send a server-initiated control message (e.g. interrupt, set_model).

        No-op for transports that don't support the control protocol.
        """

    @property
    @abstractmethod
    def session_id(self) -> str | None:
        """The CLI's session ID (for resume)."""

    @property
    @abstractmethod
    def last_result(self) -> dict | None:
        """The most recent result event (for usage reporting)."""

    @property
    @abstractmethod
    def is_alive(self) -> bool:
        """Whether the transport is connected and operational."""

    @property
    def capabilities(self) -> TransportCapabilities:
        """Declare what this transport supports.

        Returns all-False defaults — safe for new transports.
        Subclasses override to advertise their capabilities.
        """
        return TransportCapabilities()


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _filter_event(data: dict) -> dict | None:
    """Filter events before forwarding to the browser.

    Drops empty content_block_delta events (no text to display) and
    keep_alive messages (internal transport concern).
    """
    msg_type = data.get("type")

    if msg_type == "keep_alive":
        return None

    if msg_type == "content_block_delta":
        delta = data.get("delta", {})
        has_content = delta.get("text") or delta.get("thinking") or delta.get("partial_json")
        if not has_content:
            logger.debug("Filtering out empty content_block_delta event")
            return None

    logger.debug("_filter_event passing through event type=%s", msg_type)
    return data


async def _drain_stream(stream: asyncio.StreamReader | None, label: str) -> None:
    """Read and log a stream to prevent buffer fill blocking."""
    if stream is None:
        logger.debug("_drain_stream(%s): stream is None, nothing to drain", label)
        return

    line_count = 0
    try:
        while True:
            line = await stream.readline()
            if not line:
                break
            text = line.decode().rstrip()
            if text:
                line_count += 1
                logger.info("Claude CLI %s: %s", label, text)
    except Exception as e:
        logger.warning("Stream drain (%s) ended with error: %r", label, e)
    finally:
        logger.info("_drain_stream(%s): finished after %d lines", label, line_count)


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    """Terminate a subprocess gracefully, kill on timeout."""
    if process.returncode is not None:
        return

    logger.info("Stopping Claude Code CLI")
    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=5.0)
    except TimeoutError:
        logger.warning("Claude Code CLI did not terminate, killing")
        process.kill()
        await process.wait()


# Re-export concrete transports so `from skuld.transports import X` works
from skuld.transports.codex import (  # noqa: E402
    _CODEX_TOOL_MAP,
    CodexSubprocessTransport,
    _map_codex_tool,
)
from skuld.transports.codex_ws import CodexWebSocketTransport  # noqa: E402
from skuld.transports.opencode import OpenCodeHttpTransport  # noqa: E402
from skuld.transports.sdk_websocket import SdkWebSocketTransport  # noqa: E402
from skuld.transports.subprocess import SubprocessTransport  # noqa: E402

__all__ = [
    "CLITransport",
    "CodexSubprocessTransport",
    "CodexWebSocketTransport",
    "EventCallback",
    "OpenCodeHttpTransport",
    "SdkWebSocketTransport",
    "SubprocessTransport",
    "TransportCapabilities",
    "_CODEX_TOOL_MAP",
    "_drain_stream",
    "_filter_event",
    "_map_codex_tool",
    "_stop_process",
]
