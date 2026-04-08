"""ChatView — WebSocket conversation with a Ravn daemon."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Input, Label, RichLog

if TYPE_CHECKING:
    pass


class ChatView(Widget):
    """Streams directly over /ws WebSocket.

    Displays message bubbles with role distinction, inline THOUGHT
    display in muted italic, tool call badges, and a streaming indicator.
    """

    DEFAULT_CSS = """
    ChatView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
    }
    ChatView #cv-log {
        height: 1fr;
        background: #09090b;
    }
    ChatView #cv-input-bar {
        height: 3;
        border-top: solid #3f3f46;
        background: #18181b;
        padding: 0 1;
    }
    ChatView #cv-input {
        width: 1fr;
        background: #18181b;
        color: #fafafa;
        border: none;
    }
    ChatView #cv-header {
        color: #f59e0b;
        padding: 0 1;
    }
    """

    streaming: reactive[bool] = reactive(False)

    def __init__(self, connection: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._connection: Any | None = connection
        self._ws: Any | None = None
        self._history: list[dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        target = self._connection.name if self._connection else "—"
        yield Label(f"💬 chat:{target}", id="cv-header")
        yield RichLog(id="cv-log", markup=True, highlight=True, wrap=True)
        yield Input(placeholder="Send message…", id="cv-input")

    def on_mount(self) -> None:
        if self._connection:
            self._connection.on_message(self._on_ws_message)
            asyncio.create_task(self._connect_ws(), name="chat-ws")

    async def _connect_ws(self) -> None:
        if not self._connection:
            return
        try:
            import websockets

            async with websockets.connect(self._connection.ws_url) as ws:
                self._ws = ws
                self._append_system("Connected to " + self._connection.name)
                async for raw in ws:
                    try:
                        data = json.loads(raw)
                        self._handle_ws_frame(data)
                    except json.JSONDecodeError:
                        pass
        except Exception as exc:
            self._append_system(f"[#ef4444]Disconnected: {exc}[/]")
        finally:
            self._ws = None
            self.streaming = False

    def _handle_ws_frame(self, data: dict[str, Any]) -> None:
        event_type = data.get("type", "")
        match event_type:
            case "thought":
                text = data.get("payload", {}).get("text", "")
                self._append_thought(text)
            case "tool_start":
                tool = data.get("payload", {}).get("tool_name", "?")
                self._append_tool(f"▶ TOOL: {tool}")
            case "tool_result":
                tool = data.get("payload", {}).get("tool_name", "?")
                self._append_tool(f"◀ RESULT: {tool}")
            case "response":
                text = data.get("payload", {}).get("text", "")
                self.streaming = False
                self._append_ravn(text)
            case "streaming":
                self.streaming = True
            case _:
                pass

    def _on_ws_message(self, conn: Any, msg: dict[str, Any]) -> None:
        self._handle_ws_frame(msg)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        event.input.clear()
        if not text:
            return
        self._append_user(text)
        await self._send(text)

    async def _send(self, text: str) -> None:
        if self._ws:
            try:
                await self._ws.send(json.dumps({"type": "message", "content": text}))
                self.streaming = True
            except Exception:
                self._append_system("[#ef4444]Send failed[/]")
            return
        self._append_system("[#71717a](not connected)[/]")

    def _append_user(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        log.write(f"[bold #f59e0b]You:[/] {text}")

    def _append_ravn(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        name = self._connection.name if self._connection else "Ravn"
        log.write(f"[bold #06b6d4]ᚱ {name}:[/] {text}")

    def _append_thought(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        log.write(f"[italic #71717a]  ✦ {text}[/]")

    def _append_tool(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        log.write(f"[#a855f7]{text}[/]")

    def _append_system(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        log.write(f"[#71717a]── {text} ──[/]")
