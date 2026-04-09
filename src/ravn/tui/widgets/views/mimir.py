"""MimirView — wiki browser connected to Mímir HTTP API."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.widget import Widget
from textual.widgets import Input, RichLog

if TYPE_CHECKING:
    pass


class MimirView(Widget):
    """Connects to GET /mimir/pages.

    Navigate with arrow keys, Enter to open, Backspace to go back,
    / to search.  Toggle graph view with g.
    """

    DEFAULT_CSS = """
    MimirView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
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

    can_focus = True

    BINDINGS = [
        Binding("backspace", "go_back", "Back"),
        Binding("g", "toggle_graph", "Graph"),
        Binding("/", "search", "Search"),
    ]

    def __init__(
        self,
        connection: Any | None = None,
        mimir_urls: list[tuple[str, str]] | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self._connection = connection
        self._mimir_urls: list[tuple[str, str]] = mimir_urls or []
        self._history: list[str] = []
        self._current_page: str | None = None
        self._graph_mode = False

    def compose(self) -> ComposeResult:
        yield RichLog(id="mv-content", markup=True, wrap=True)
        yield Input(placeholder="Search pages…", id="mv-search")

    def on_mount(self) -> None:
        asyncio.create_task(self._load_pages(), name="mimir-pages")

    async def _load_pages(self) -> None:
        # Try each configured HTTP mimir instance in priority order
        for name, base_url in self._mimir_urls:
            if await self._try_load(name, base_url):
                return

        # Fall back to ravn connection's base_url if available
        if self._connection:
            await self._try_load(self._connection.name, self._connection.base_url)
            return

        log = self.query_one("#mv-content", RichLog)
        log.write("[#52525b]  No Mímir instances configured.[/]")
        log.write("")
        log.write("[#3f3f46]  Add mimir instances to your ravn config:[/]")
        log.write("[#71717a]  mimir:[/]")
        log.write("[#71717a]    instances:[/]")
        log.write("[#71717a]      - name: shared[/]")
        log.write("[#71717a]        url: https://your-volundr-host[/]")

    async def _try_load(self, name: str, base_url: str) -> bool:
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base_url}/mimir/pages")
                if resp.status_code == 200:
                    pages = resp.json()
                    self._render_page_list(name, pages)
                    return True
                self._write(
                    f"[#52525b]  {name}[/] [#ef4444]HTTP {resp.status_code}[/]"
                )
                return False
        except Exception as exc:
            self._write(f"[#52525b]  {name}[/] [#3f3f46]{exc}[/]")
            return False

    def _render_page_list(self, instance: str, pages: list[Any]) -> None:
        log = self.query_one("#mv-content", RichLog)
        log.clear()
        log.write(f"[#52525b]  {instance}[/]  [#3f3f46]{len(pages)} pages[/]")
        log.write("")
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
