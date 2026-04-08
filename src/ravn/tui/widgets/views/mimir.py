"""MimirView — wiki browser connected to Mímir HTTP API."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.widget import Widget
from textual.widgets import Input, Label, RichLog

if TYPE_CHECKING:
    pass


class MimirView(Widget):
    """Connects to GET /mimir/pages and GET /mimir/graph.

    Navigate with arrow keys, Enter to open, Backspace to go back,
    / to search.  Toggle graph view with g.
    """

    DEFAULT_CSS = """
    MimirView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
    }
    MimirView #mv-header {
        color: #f59e0b;
        padding: 0 1;
    }
    MimirView #mv-content {
        height: 1fr;
        background: #09090b;
        padding: 1;
    }
    MimirView #mv-search {
        height: 3;
        border-top: solid #3f3f46;
        background: #18181b;
        display: none;
    }
    MimirView #mv-search.visible {
        display: block;
    }
    """

    BINDINGS = [
        Binding("backspace", "go_back", "Back"),
        Binding("g", "toggle_graph", "Graph"),
        Binding("/", "search", "Search"),
    ]

    def __init__(self, connection: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._connection = connection
        self._history: list[str] = []
        self._current_page: str | None = None
        self._graph_mode = False

    def compose(self) -> ComposeResult:
        target = self._connection.name if self._connection else "shared"
        yield Label(f"📚 mimir:{target}", id="mv-header")
        yield RichLog(id="mv-content", markup=True, wrap=True)
        yield Input(placeholder="Search pages…", id="mv-search")

    def on_mount(self) -> None:
        asyncio.create_task(self._load_pages(), name="mimir-pages")

    async def _load_pages(self) -> None:
        if not self._connection:
            self._write("[(no connection)]")
            return
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._connection.base_url}/mimir/pages")
                if resp.status_code == 200:
                    pages = resp.json()
                    self._render_page_list(pages)
                else:
                    self._write(f"[#ef4444]HTTP {resp.status_code}[/]")
        except Exception as exc:
            self._write(f"[#ef4444]Error: {exc}[/]")

    def _render_page_list(self, pages: list[Any]) -> None:
        log = self.query_one("#mv-content", RichLog)
        log.clear()
        if not pages:
            log.write("[#71717a](no pages)[/]")
            return
        for page in pages:
            if isinstance(page, dict):
                title = page.get("title", page.get("id", str(page)))
                category = page.get("category", "")
                log.write(f"  [bold #06b6d4]{title}[/]  [#71717a]{category}[/]")
            else:
                log.write(f"  [#fafafa]{page}[/]")

    def action_go_back(self) -> None:
        if self._history:
            self._current_page = self._history.pop()

    def action_toggle_graph(self) -> None:
        self._graph_mode = not self._graph_mode
        try:
            header = self.query_one("#mv-header", Label)
            target = self._connection.name if self._connection else "shared"
            mode = " [graph]" if self._graph_mode else ""
            header.update(f"📚 mimir:{target}{mode}")
        except Exception:
            pass

    def action_search(self) -> None:
        search = self.query_one("#mv-search", Input)
        search.toggle_class("visible")
        if "visible" in search.classes:
            search.focus()

    def _write(self, text: str) -> None:
        try:
            log = self.query_one("#mv-content", RichLog)
            log.write(text)
        except Exception:
            pass
