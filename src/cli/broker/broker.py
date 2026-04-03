"""Session broker — bridges N browser WebSocket clients to 1 SDK connection."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from cli.broker.translate import (
    filter_cli_event,
    skuld_to_sdk_control,
    skuld_to_sdk_permission,
)
from cli.broker.transport import Transport

logger = logging.getLogger(__name__)

BROWSER_SEND_BUFFER = 256
MAX_HISTORY_TURNS = 500

CONTROL_MSG_TYPES = frozenset(
    {
        "interrupt",
        "set_model",
        "set_max_thinking_tokens",
        "set_permission_mode",
        "rewind_files",
        "mcp_set_servers",
    }
)


@dataclass(frozen=True)
class ConversationTurn:
    """A single user or assistant turn in the conversation."""

    id: str
    role: str
    content: str
    parts: list[Any]
    created_at: str
    metadata: dict[str, Any] = field(default_factory=dict)


class BrowserConnection:
    """Wraps an asyncio WebSocket with a bounded send queue."""

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self.queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=BROWSER_SEND_BUFFER)
        self._write_task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._write_task = asyncio.create_task(self._write_loop())

    async def _write_loop(self) -> None:
        try:
            while True:
                data = await self.queue.get()
                await self.ws.send_text(data.decode())
        except Exception:
            logger.debug("write loop ended", exc_info=True)

    async def send(self, payload: bytes) -> None:
        try:
            self.queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.debug("dropping message for slow browser client")

    async def close(self) -> None:
        if self._write_task:
            self._write_task.cancel()
            try:
                await self._write_task
            except asyncio.CancelledError:
                pass
        try:
            await self.ws.close()
        except Exception:
            pass


class SessionBroker:
    """Per-session broker: N browser clients to 1 SDK connection.

    Mirrors the Go ``Broker`` struct. Handles:
    - Browser WebSocket connections (fan-out broadcasts, fan-in forwards)
    - Conversation history for late joiners
    - CLI event tracking and state management
    """

    def __init__(self, session_id: str, transport: Transport) -> None:
        self._session_id = session_id
        self._transport = transport
        self._browsers: list[BrowserConnection] = []
        self._history: list[ConversationTurn] = []
        self._active = False
        self._lock = asyncio.Lock()

        # Streaming accumulator for building assistant turns.
        self._pending_text: list[str] = []
        self._pending_parts: list[Any] = []
        self._pending_model = ""

    @property
    def session_id(self) -> str:
        return self._session_id

    def conversation_history(self) -> dict[str, Any]:
        """Return the history payload for the HTTP endpoint."""
        turns = [
            {
                "id": t.id,
                "role": t.role,
                "content": t.content,
                "parts": t.parts,
                "created_at": t.created_at,
                "metadata": t.metadata,
            }
            for t in self._history
        ]
        last_activity = "Assistant is responding..." if self._active else ""
        return {
            "turns": turns,
            "is_active": self._active,
            "last_activity": last_activity,
        }

    async def add_browser(self, ws: Any) -> BrowserConnection:
        """Register a new browser WebSocket connection."""
        bc = BrowserConnection(ws)
        bc.start()
        async with self._lock:
            self._browsers.append(bc)
        logger.info(
            "browser connected (session %s, %d clients)",
            self._session_id,
            len(self._browsers),
        )
        await self._send_to(
            bc,
            {
                "type": "system",
                "content": f"Connected to session {self._session_id}",
            },
        )
        return bc

    async def remove_browser(self, bc: BrowserConnection) -> None:
        """Unregister and close a browser connection."""
        async with self._lock:
            self._browsers = [b for b in self._browsers if b is not bc]
        await bc.close()
        logger.info(
            "browser disconnected (session %s, %d clients)",
            self._session_id,
            len(self._browsers),
        )

    async def handle_browser_message(self, msg: dict[str, Any]) -> None:
        """Route a message received from a browser client."""
        msg_type = msg.get("type", "")

        # Legacy format: {content: "text"} without type field.
        if not msg_type and "content" in msg:
            msg_type = "user"

        if msg_type in ("user", "message"):
            content = msg.get("content")
            if content is None:
                return

            content_str = content if isinstance(content, str) else json.dumps(content)
            self._append_turn("user", content_str, None, None)

            await self._broadcast(
                {
                    "type": "user_confirmed",
                    "id": str(uuid.uuid4()),
                    "content": content_str,
                }
            )

            cli_session_id = self._transport.cli_session_id()
            try:
                self._transport.send_user_message(content, cli_session_id)
            except Exception as exc:
                logger.error("send user message: %s", exc)
                await self._broadcast(
                    {
                        "type": "error",
                        "error": f"Failed to send message: {exc}",
                    }
                )

        elif msg_type == "permission_response":
            resp = skuld_to_sdk_permission(msg)
            try:
                self._transport.send_control_response(resp)
            except Exception as exc:
                logger.error("send permission response: %s", exc)

        elif msg_type in CONTROL_MSG_TYPES:
            resp = skuld_to_sdk_control(msg_type, msg)
            try:
                self._transport.send_control_response(resp)
            except Exception as exc:
                logger.error("send control %s: %s", msg_type, exc)

    def on_cli_event(self, data: dict[str, Any]) -> asyncio.Task[None] | None:
        """Handle a CLI event — track state and broadcast to browsers.

        Returns the broadcast task so callers can optionally await it.
        """
        if not filter_cli_event(data):
            return None

        msg_type = data.get("type", "")

        match msg_type:
            case "user":
                message = data.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                    if isinstance(content, str) and content:
                        self._append_turn("user", content, None, None)

            case "system":
                subtype = data.get("subtype", "")
                if subtype == "init":
                    cmds: dict[str, Any] = {"type": "available_commands"}
                    if "slash_commands" in data:
                        cmds["slash_commands"] = data["slash_commands"]
                    if "skills" in data:
                        cmds["skills"] = data["skills"]
                    return asyncio.ensure_future(self._broadcast(cmds))

            case "assistant":
                self._active = True
                self._pending_text.clear()
                self._pending_parts.clear()
                self._pending_model = ""
                message = data.get("message")
                if isinstance(message, dict):
                    model = message.get("model")
                    if isinstance(model, str):
                        self._pending_model = model

            case "content_block_delta":
                delta = data.get("delta")
                if isinstance(delta, dict):
                    text = delta.get("text", "")
                    if text:
                        self._pending_text.append(text)
                    thinking = delta.get("thinking", "")
                    if thinking:
                        self._pending_parts.append({"type": "reasoning", "text": thinking})

            case "result":
                self._active = False
                content = "".join(self._pending_text)
                parts = list(self._pending_parts)

                if not content:
                    result_val = data.get("result")
                    if isinstance(result_val, str):
                        content = result_val

                if content:
                    parts.append({"type": "text", "text": content})

                metadata: dict[str, Any] = {}
                if self._pending_model:
                    metadata["model"] = self._pending_model
                if "modelUsage" in data:
                    metadata["usage"] = data["modelUsage"]

                self._pending_text.clear()
                self._pending_parts.clear()

                if content or parts:
                    self._append_turn("assistant", content, parts, metadata)

        return asyncio.ensure_future(self._broadcast(data))

    async def stop(self) -> None:
        """Close all browser connections."""
        async with self._lock:
            browsers = list(self._browsers)
            self._browsers.clear()
        for bc in browsers:
            await bc.close()

    async def inject_message(self, content: str) -> None:
        """Send a message to the CLI from an external source."""
        cli_session_id = self._transport.cli_session_id()
        self._transport.send_user_message(content, cli_session_id)
        self._append_turn("user", content, None, None)

    async def _broadcast(self, data: dict[str, Any]) -> None:
        """Send a JSON payload to all connected browsers."""
        try:
            payload = json.dumps(data).encode()
        except (TypeError, ValueError):
            return

        async with self._lock:
            browsers = list(self._browsers)

        for bc in browsers:
            await bc.send(payload)

    async def _send_to(self, bc: BrowserConnection, data: dict[str, Any]) -> None:
        """Send a JSON payload to a single browser."""
        try:
            payload = json.dumps(data).encode()
        except (TypeError, ValueError):
            return
        await bc.send(payload)

    def _append_turn(
        self,
        role: str,
        content: str,
        parts: list[Any] | None,
        metadata: dict[str, Any] | None,
    ) -> None:
        turn = ConversationTurn(
            id=str(uuid.uuid4()),
            role=role,
            content=content,
            parts=parts or [],
            created_at=datetime.now(UTC).isoformat(),
            metadata=metadata or {},
        )
        self._history.append(turn)
        if len(self._history) > MAX_HISTORY_TURNS:
            self._history = self._history[-MAX_HISTORY_TURNS:]
