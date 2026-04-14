"""SkuldChannel — WebSocket channel for browser delivery via the Skuld broker.

Connects to the Skuld broker WebSocket endpoint and forwards
:class:`~ravn.domain.events.RavnEvent` objects as NDJSON frames,
matching the existing Skuld event protocol.

The channel reconnects automatically on disconnect so ephemeral network
blips do not terminate an in-flight agent turn.

Protocol (NDJSON, one JSON object per line):

    {"type": "thought", "data": "...", "metadata": {}}
    {"type": "tool_start", "data": "BashTool", "metadata": {"input": {...}}}
    {"type": "tool_result", "data": "...", "metadata": {"tool_name": "BashTool"}}
    {"type": "response", "data": "...", "metadata": {}}
    {"type": "error", "data": "...", "metadata": {}}
"""

from __future__ import annotations

import asyncio
import json
import logging

import websockets
import websockets.exceptions

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.ports.channel import ChannelPort

logger = logging.getLogger(__name__)

_DEFAULT_RECONNECT_DELAY_SECONDS = 2.0
_DEFAULT_MAX_RECONNECT_ATTEMPTS = 5


class SkuldChannel(ChannelPort):
    """Delivers Ravn events to the browser via the Skuld WebSocket broker.

    Args:
        broker_url:    WebSocket URL of the Skuld broker endpoint
                       (e.g. ``ws://localhost:9000/ws/ravn/{peer_id}``).
        session_id:    Agent session identifier forwarded in each event frame.
        peer_id:       Stable participant identifier for this Ravn daemon.
                       Included as ``source`` in each NDJSON frame so the
                       RoomBridge can route events to the correct participant.
        persona:       Display name for this Ravn in the room UI.  Included
                       in each frame for late-joining RoomBridge registration.
        reconnect_delay: Seconds to wait between reconnection attempts.
        max_reconnect_attempts: Maximum number of reconnection attempts before
                               giving up and buffering events locally.
    """

    def __init__(
        self,
        broker_url: str,
        session_id: str,
        *,
        peer_id: str | None = None,
        persona: str | None = None,
        reconnect_delay: float = _DEFAULT_RECONNECT_DELAY_SECONDS,
        max_reconnect_attempts: int = _DEFAULT_MAX_RECONNECT_ATTEMPTS,
    ) -> None:
        self._broker_url = broker_url
        self._session_id = session_id
        self._peer_id = peer_id
        self._persona = persona
        self._reconnect_delay = reconnect_delay
        self._max_reconnect_attempts = max_reconnect_attempts
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._connect_lock = asyncio.Lock()
        self._buffer: list[RavnEvent] = []

    async def emit(self, event: RavnEvent) -> None:
        """Emit *event* to the Skuld broker as an NDJSON frame."""
        payload = self._serialise(event)
        try:
            await self._send(payload)
        except Exception as exc:
            logger.warning("SkuldChannel: emit failed, buffering event: %r", exc)
            self._buffer.append(event)

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Establish the WebSocket connection to the Skuld broker.

        Safe to call multiple times — subsequent calls are no-ops when
        the connection is already open.
        """
        async with self._connect_lock:
            if self._ws is not None and not self._ws.closed:
                return
            await self._do_connect()

    async def disconnect(self) -> None:
        """Close the WebSocket connection gracefully."""
        if self._ws is None:
            return
        try:
            await self._ws.close()
        except Exception:
            pass
        finally:
            self._ws = None

    async def flush_buffer(self) -> None:
        """Re-send any buffered events that could not be delivered earlier."""
        if not self._buffer:
            return
        pending = list(self._buffer)
        self._buffer.clear()
        for event in pending:
            payload = self._serialise(event)
            try:
                await self._send(payload)
            except Exception as exc:
                logger.warning("SkuldChannel: flush failed for event %r: %r", event.type, exc)
                self._buffer.append(event)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _do_connect(self) -> None:
        attempts = 0
        while attempts < self._max_reconnect_attempts:
            try:
                self._ws = await websockets.connect(self._broker_url)
                logger.info(
                    "SkuldChannel connected to %s (session=%s).",
                    self._broker_url,
                    self._session_id,
                )
                return
            except Exception as exc:
                attempts += 1
                logger.warning(
                    "SkuldChannel: connection attempt %d/%d failed: %r",
                    attempts,
                    self._max_reconnect_attempts,
                    exc,
                )
                if attempts < self._max_reconnect_attempts:
                    await asyncio.sleep(self._reconnect_delay)

        logger.error(
            "SkuldChannel: gave up connecting to %s after %d attempts.",
            self._broker_url,
            self._max_reconnect_attempts,
        )

    async def _send(self, payload: str) -> None:
        """Send *payload* over the WebSocket, reconnecting if necessary."""
        if self._ws is None or self._ws.closed:
            await self.connect()

        if self._ws is None:
            raise RuntimeError("SkuldChannel: no WebSocket connection available.")

        try:
            await self._ws.send(payload)
        except websockets.exceptions.ConnectionClosed:
            logger.info("SkuldChannel: connection closed — reconnecting.")
            self._ws = None
            await self.connect()
            if self._ws is not None:
                await self._ws.send(payload)

    def _serialise(self, event: RavnEvent) -> str:
        """Serialise *event* as an NDJSON line (no trailing newline from caller).

        Reconstructs the legacy ``data``/``metadata`` envelope from the
        unified ``payload`` dict so downstream Skuld consumers remain
        compatible.
        """
        payload = event.payload
        match event.type:
            case RavnEventType.THOUGHT:
                data = payload["text"]
                metadata = {"thinking": True} if payload.get("thinking") else {}
            case RavnEventType.RESPONSE:
                data = payload["text"]
                metadata = {}
            case RavnEventType.TOOL_START:
                data = payload["tool_name"]
                metadata = {"input": payload.get("input", {})}
                if "diff" in payload:
                    metadata["diff"] = payload["diff"]
            case RavnEventType.TOOL_RESULT:
                data = payload["result"]
                metadata = {
                    "tool_name": payload.get("tool_name", ""),
                    "is_error": payload.get("is_error", False),
                }
            case RavnEventType.ERROR:
                data = payload["message"]
                metadata = {}
            case _:
                data = str(payload)
                metadata = {}

        frame: dict = {
            "session_id": self._session_id,
            "type": str(event.type),
            "data": data,
            "metadata": metadata,
        }
        # Include source/persona for RoomBridge participant identification.
        # Existing Skuld deployments that do not understand these fields will
        # ignore them (backward-compatible addition).
        if self._peer_id is not None:
            frame["source"] = self._peer_id
        if self._persona is not None:
            frame["persona"] = self._persona
        return json.dumps(frame) + "\n"
