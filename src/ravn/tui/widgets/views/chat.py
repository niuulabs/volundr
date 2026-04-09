"""ChatView — WebSocket conversation with a Ravn daemon."""

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
    """Streams chat via POST /chat (SSE response).

    Displays message bubbles with role distinction, inline THOUGHT
    display in muted italic, tool call badges, and a streaming indicator.
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
        self._history: list[dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        yield RichLog(id="cv-log", markup=True, highlight=True, wrap=True)
        name = self._connection.name if self._connection else "ravn"
        yield Input(placeholder=f"{name} > message…", id="cv-input")

    def on_mount(self) -> None:
        log = self.query_one("#cv-log", RichLog)
        if self._connection:
            log.write(f"[#3f3f46]  ── {self._connection.name} ──[/]")
            log.write("")
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
            log.write("")
            log.write("[#52525b]  Split this pane:[/]")
            log.write(
                "[#3f3f46]  ^w v[/][#71717a] vsplit  [/]"
                "[#3f3f46]^w s[/][#71717a] hsplit[/]"
            )

    def _handle_event(self, data: dict[str, Any]) -> None:
        event_type = data.get("type", "")
        payload = data.get("payload", {}) or {}
        match event_type:
            case "thought":
                self._append_thought(payload.get("text", ""))
            case "tool_start":
                tool = payload.get("tool_name", "?")
                args = payload.get("args", "")
                self._append_tool_start(tool, str(args)[:60] if args else "")
            case "tool_result":
                tool = payload.get("tool_name", "?")
                result = str(payload.get("result", ""))
                self._append_tool_result(tool, result)
            case "response":
                self.streaming = False
                self._append_ravn(payload.get("text", ""))
            case "error":
                self.streaming = False
                self._append_system(f"[#ef4444]{payload.get('message', 'error')}[/]")

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        event.input.clear()
        if not text:
            return
        self._append_user(text)
        await self._send(text)

    async def _send(self, text: str) -> None:
        if not self._connection:
            self._append_system("[#71717a](not connected)[/]")
            return
        self.streaming = True
        asyncio.create_task(self._stream_response(text), name="chat-send")

    async def _stream_response(self, text: str) -> None:
        try:
            import httpx

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(None, connect=5.0)
            ) as client:
                async with client.stream(
                    "POST",
                    f"{self._connection.base_url}/chat",
                    json={"message": text},
                ) as resp:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        self._handle_event(data)
        except Exception as exc:
            self._append_system(f"[#ef4444]Error: {exc}[/]")
        finally:
            self.streaming = False

    def _append_user(self, text: str) -> None:
        from datetime import datetime

        log = self.query_one("#cv-log", RichLog)
        ts = datetime.now().strftime("%H:%M:%S")
        log.write(f"[#d4d4d8 on #1a1308]  {text}  [/]")
        log.write(f"[#3f3f46]  {ts} · you[/]")
        log.write("")

    def _append_ravn(self, text: str) -> None:
        from datetime import datetime

        log = self.query_one("#cv-log", RichLog)
        name = self._connection.name if self._connection else "ravn"
        ts = datetime.now().strftime("%H:%M:%S")
        log.write(f"[#d4d4d8 on #1c1c1e]  {text}  [/]")
        log.write(f"[#3f3f46]  {ts} · {name}[/]")
        log.write("")

    def _append_thought(self, text: str) -> None:
        log = self.query_one("#cv-log", RichLog)
        log.write(f"[italic #52525b]  ✦ {text}[/]")

    def _append_tool_start(self, tool: str, args: str = "") -> None:
        log = self.query_one("#cv-log", RichLog)
        detail = f": {args}" if args else ""
        log.write(f"[#06b6d4 on #071a1e]  TOOL [/][#06b6d4] {tool}{detail}[/]")

    def _append_tool_result(self, tool: str, result: str = "") -> None:
        log = self.query_one("#cv-log", RichLog)
        summary = result[:80] + "…" if len(result) > 80 else result
        log.write(f"[#10b981 on #071a12]  RESULT [/][#10b981] {tool}: {summary}[/]")

    def _append_system(self, text: str) -> None:
        try:
            log = self.query_one("#cv-log", RichLog)
            log.write(f"[#3f3f46]  ── {text} ──[/]")
        except Exception:
            pass
