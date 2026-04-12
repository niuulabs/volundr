"""Connection management for Ravn TUI — WebSocket chat + SSE events per daemon."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_RECONNECT_DELAY_SECONDS = 3.0
_WS_PATH = "/ws"
_SSE_PATH = "/events"
_STATUS_PATH = "/status"


@dataclass
class RavnConnection:
    """Represents a live connection to a single Ravn daemon."""

    name: str
    host: str
    port: int
    status: Literal["connected", "connecting", "disconnected", "error"] = "disconnected"
    last_event: datetime | None = None
    ravn_info: dict[str, Any] = field(default_factory=dict)
    ghost: bool = False  # read-only event stream, no chat session

    # Internal async handles — not part of serialization
    _ws: Any | None = field(default=None, repr=False, compare=False)
    _sse_task: asyncio.Task | None = field(default=None, repr=False, compare=False)
    _event_callbacks: list[Any] = field(default_factory=list, repr=False, compare=False)
    _message_callbacks: list[Any] = field(default_factory=list, repr=False, compare=False)

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @property
    def ws_url(self) -> str:
        return f"ws://{self.host}:{self.port}{_WS_PATH}"

    @property
    def sse_url(self) -> str:
        return f"http://{self.host}:{self.port}{_SSE_PATH}"

    def on_event(self, callback: Any) -> None:
        """Register a callback for SSE events: callback(conn, event_dict)."""
        self._event_callbacks.append(callback)

    def on_message(self, callback: Any) -> None:
        """Register a callback for WS messages: callback(conn, msg_dict)."""
        self._message_callbacks.append(callback)

    def _emit_event(self, event: dict[str, Any]) -> None:
        self.last_event = datetime.now(UTC)
        for cb in self._event_callbacks:
            try:
                cb(self, event)
            except Exception:
                logger.exception("event callback error")

    def _emit_message(self, msg: dict[str, Any]) -> None:
        for cb in self._message_callbacks:
            try:
                cb(self, msg)
            except Exception:
                logger.exception("message callback error")

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "host": self.host,
            "port": self.port,
            "status": self.status,
            "ghost": self.ghost,
        }


class FlokkManager:
    """Maintains live membership of the Flokk.

    Discovers Ravens via:
    1. Explicit --connect arguments (host:port pairs)
    2. mDNS (--discover flag, uses zeroconf)
    3. Sleipnir announce events (odin.ravn.announce)
    """

    def __init__(self) -> None:
        self._connections: dict[str, RavnConnection] = {}
        self._lock = asyncio.Lock()
        self._event_callbacks: list[Any] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def on_event(self, callback: Any) -> None:
        """Global event callback: callback(conn, event_dict)."""
        self._event_callbacks.append(callback)

    async def connect(self, host: str, port: int, ghost: bool = False) -> RavnConnection:
        """Add a Ravn to the Flokk and start its event stream."""
        name = f"{host}:{port}"
        async with self._lock:
            if name in self._connections:
                return self._connections[name]
            conn = RavnConnection(name=name, host=host, port=port, ghost=ghost)
            conn.on_event(self._global_event_handler)
            self._connections[name] = conn

        asyncio.create_task(self._maintain_sse(conn), name=f"sse:{name}")
        if not ghost:
            asyncio.create_task(self._fetch_info(conn), name=f"info:{name}")
        return conn

    async def disconnect(self, name: str) -> None:
        """Remove a Ravn from the Flokk."""
        async with self._lock:
            conn = self._connections.pop(name, None)
        if conn is None:
            return
        if conn._sse_task and not conn._sse_task.done():
            conn._sse_task.cancel()
        conn.status = "disconnected"

    async def broadcast(self, message: str) -> dict[str, str]:
        """Send message to all connected Ravens. Returns {name: task_id}."""
        return await self.broadcast_to(
            [c.name for c in self.connections()],
            message,
        )

    async def broadcast_to(self, names: list[str], message: str) -> dict[str, str]:
        """Send message to a specific subset of Ravens. Returns {name: task_id}."""
        name_set = set(names)
        eligible = [
            c
            for c in self.connections()
            if c.name in name_set and c.status == "connected" and not c.ghost
        ]
        tasks = [self._send_message(conn, message) for conn in eligible]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        results: dict[str, str] = {}
        for conn, resp in zip(eligible, responses):
            if isinstance(resp, str):
                results[conn.name] = resp
        return results

    def connections(self) -> list[RavnConnection]:
        """Return snapshot of current connections."""
        return list(self._connections.values())

    def get(self, name: str) -> RavnConnection | None:
        return self._connections.get(name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _global_event_handler(self, conn: RavnConnection, event: dict[str, Any]) -> None:
        for cb in self._event_callbacks:
            try:
                cb(conn, event)
            except Exception:
                logger.exception("global event callback error")

    async def _fetch_info(self, conn: RavnConnection) -> None:
        """Fetch /status from the Ravn daemon and populate ravn_info."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{conn.base_url}{_STATUS_PATH}")
                if resp.status_code == 200:
                    conn.ravn_info = resp.json()
                    conn.status = "connected"
                else:
                    conn.status = "error"
                    logger.debug("non-200 from %s: %s", conn.name, resp.status_code)
        except Exception:
            conn.status = "error"
            logger.debug("failed to fetch info from %s", conn.name)

    async def _maintain_sse(self, conn: RavnConnection) -> None:
        """Subscribe to SSE /events with automatic reconnect."""
        conn.status = "connecting"
        while True:
            try:
                await self._sse_loop(conn)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.debug("SSE disconnected from %s, reconnecting", conn.name)
                conn.status = "error"
                await asyncio.sleep(_RECONNECT_DELAY_SECONDS)
                conn.status = "connecting"

    async def _sse_loop(self, conn: RavnConnection) -> None:
        """Single SSE connection loop."""
        if httpx is None:  # pragma: no cover
            logger.warning("httpx not available — SSE stream disabled")
            return

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", conn.sse_url) as response:
                conn.status = "connected"
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        event = _parse_sse_block(block)
                        if event is not None:
                            conn._emit_event(event)

    async def _send_message(self, conn: RavnConnection, message: str) -> str:
        """Send a single message via WS and return task_id."""
        try:
            async with websockets.connect(conn.ws_url) as ws:
                await ws.send(json.dumps({"type": "message", "content": message}))
                raw = await ws.recv()
                data = json.loads(raw)
                return data.get("task_id", "")
        except Exception:
            logger.debug("failed to send message to %s", conn.name)
            return ""


def _parse_sse_block(block: str) -> dict[str, Any] | None:
    """Parse an SSE block into a dict with 'event' and 'data' keys."""
    lines = block.strip().splitlines()
    result: dict[str, Any] = {}
    for line in lines:
        if line.startswith("event:"):
            result["event"] = line[6:].strip()
        elif line.startswith("data:"):
            raw = line[5:].strip()
            try:
                result["data"] = json.loads(raw)
            except json.JSONDecodeError:
                result["data"] = raw
    if not result:
        return None
    return result
