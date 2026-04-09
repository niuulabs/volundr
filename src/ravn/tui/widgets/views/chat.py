"""ChatView — WebSocket conversation with a Ravn daemon.

Uses the /ws WebSocket endpoint with the CLI stream-json format (same as the
web UI's useSkuldChat hook).  Text deltas are buffered per content_block and
written to the log as one bubble when the block closes, giving clean output
instead of a line per token.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Input, RichLog

if TYPE_CHECKING:
    pass


class ChatView(Widget):
    """Streams over /ws WebSocket (CLI stream-json format).

    Message protocol (server → client):
      content_block_start  type=text|thinking|tool_use
      content_block_delta  type=text_delta|thinking_delta|input_json_delta
      content_block_stop
      result               subtype=success|error
      error                error.message
    """

    DEFAULT_CSS = """
    ChatView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
        layout: vertical;
    }
    ChatView #cv-log {
        height: 1fr;
        background: #09090b;
    }
    ChatView #cv-input-bar {
        height: 3;
        border-top: solid #27272a;
        background: #0d0d0f;
        padding: 0 1;
    }
    ChatView #cv-input {
        width: 1fr;
        background: #0d0d0f;
        color: #d4d4d8;
        border: none;
    }
    """

    can_focus = True

    streaming: reactive[bool] = reactive(False)

    def __init__(self, connection: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._connection: Any | None = connection
        self._ws: Any | None = None
        # Per-block stream buffers
        self._block_type: str = ""
        self._text_buf: str = ""
        self._think_buf: str = ""

    def compose(self) -> ComposeResult:
        yield RichLog(id="cv-log", markup=True, highlight=True, wrap=True)
        name = self._connection.name if self._connection else "ravn"
        yield Input(placeholder=f"{name} > message…", id="cv-input")

    def on_mount(self) -> None:
        log = self.query_one("#cv-log", RichLog)
        if self._connection:
            log.write(f"[#3f3f46]  ── {self._connection.name} ──[/]")
            log.write("")
            asyncio.create_task(self._connect_ws(), name="chat-ws")
        else:
            log.write("[#3f3f46]  ── no ravn selected ──[/]")
            log.write("")
            log.write("[#52525b]  Select a ravn from the Flokka panel:[/]")
            log.write(
                "[#3f3f46]  Tab[/][#71717a] → focus Flokka  [/]"
                "[#3f3f46]j/k[/][#71717a] → navigate  [/]"
                "[#3f3f46]↵[/][#71717a] → open chat[/]"
            )
            log.write("")
            log.write("[#52525b]  No ravn? Connect one:[/]")
            log.write("[#3f3f46]  :[/][#71717a]connect host:7477[/]")

    # ------------------------------------------------------------------
    # WebSocket connection
    # ------------------------------------------------------------------

    async def _connect_ws(self) -> None:
        if not self._connection:
            return
        try:
            import websockets

            async with websockets.connect(self._connection.ws_url) as ws:
                self._ws = ws
                self._append_system("connected")
                async for raw in ws:
                    try:
                        frame = json.loads(raw)
                        self._handle_frame(frame)
                    except json.JSONDecodeError:
                        pass
        except Exception as exc:
            self._append_system(f"[#ef4444]disconnected: {exc}[/]")
        finally:
            self._ws = None
            self.streaming = False

    # ------------------------------------------------------------------
    # CLI stream-json frame handler
    # ------------------------------------------------------------------

    def _handle_frame(self, frame: dict[str, Any]) -> None:
        ftype = frame.get("type", "")

        match ftype:
            case "content_block_start":
                cb = frame.get("content_block", {})
                self._block_type = cb.get("type", "")
                self._text_buf = ""
                self._think_buf = ""
                if self._block_type == "tool_use":
                    tool_name = cb.get("name", "?")
                    self._append_tool_start(tool_name)

            case "content_block_delta":
                delta = frame.get("delta", {})
                dtype = delta.get("type", "")
                if dtype == "text_delta":
                    self._text_buf += delta.get("text", "")
                elif dtype == "thinking_delta":
                    self._think_buf += delta.get("thinking", "")

            case "content_block_stop":
                if self._block_type == "text" and self._text_buf:
                    self._append_ravn(self._text_buf)
                elif self._block_type == "thinking" and self._think_buf:
                    # Show a compact thought indicator, not the full text
                    preview = self._think_buf[:80].replace("\n", " ")
                    dots = "…" if len(self._think_buf) > 80 else ""
                    self._append_thought(f"{preview}{dots}")
                self._block_type = ""
                self._text_buf = ""
                self._think_buf = ""

            case "result":
                self.streaming = False
                if frame.get("subtype") == "error" or frame.get("is_error"):
                    self._append_system(f"[#ef4444]{frame.get('result', 'error')}[/]")

            case "error":
                self.streaming = False
                msg = frame.get("error", {}).get("message", "unknown error")
                self._append_system(f"[#ef4444]{msg}[/]")

    # ------------------------------------------------------------------
    # Input
    # ------------------------------------------------------------------

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        event.input.clear()
        if not text:
            return
        self._append_user(text)
        await self._send(text)

    async def _send(self, text: str) -> None:
        if not self._ws:
            self._append_system("[#71717a](not connected — reconnecting…)[/]")
            if self._connection:
                asyncio.create_task(self._connect_ws(), name="chat-ws-reconnect")
            return
        try:
            await self._ws.send(json.dumps({"type": "user", "content": text}))
            self.streaming = True
        except Exception:
            self._append_system("[#ef4444]send failed[/]")

    # ------------------------------------------------------------------
    # Rendering helpers
    # ------------------------------------------------------------------

    def _append_user(self, text: str) -> None:
        from datetime import datetime

        log = self.query_one("#cv-log", RichLog)
        ts = datetime.now().strftime("%H:%M:%S")
        log.write(f"[#d4d4d8 on #1a1308]  {text}  [/]")
        log.write(f"[#3f3f46]  {ts} · you[/]")
        log.write("")

    def _append_ravn(self, text: str) -> None:
        from datetime import datetime

        try:
            log = self.query_one("#cv-log", RichLog)
        except Exception:
            return
        name = self._connection.name if self._connection else "ravn"
        ts = datetime.now().strftime("%H:%M:%S")
        log.write(f"[#d4d4d8 on #1c1c1e]  {text}  [/]")
        log.write(f"[#3f3f46]  {ts} · {name}[/]")
        log.write("")
        log.scroll_end(animate=False)

    def _append_thought(self, text: str) -> None:
        try:
            log = self.query_one("#cv-log", RichLog)
            log.write(f"[italic #52525b]  ✦ {text}[/]")
        except Exception:
            pass

    def _append_tool_start(self, tool: str) -> None:
        try:
            log = self.query_one("#cv-log", RichLog)
            log.write(f"[#06b6d4 on #071a1e]  TOOL [/][#06b6d4] {tool}[/]")
        except Exception:
            pass

    def _append_system(self, text: str) -> None:
        try:
            log = self.query_one("#cv-log", RichLog)
            log.write(f"[#3f3f46]  ── {text} ──[/]")
        except Exception:
            pass
