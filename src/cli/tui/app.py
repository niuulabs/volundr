"""Textual TUI app — queries plugin registry for pages dynamically."""

from __future__ import annotations

from typing import TYPE_CHECKING

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header, Static

if TYPE_CHECKING:
    from cli.registry import PluginRegistry, TUIPageSpec


class PluginPageList(Static):
    """Sidebar listing available plugin pages."""

    def __init__(self, pages: list[TUIPageSpec], **kwargs: object) -> None:
        self._pages = pages
        lines = ["Available Pages:", ""]
        for page in pages:
            lines.append(f"  {page.icon} {page.name}")
        if not pages:
            lines.append("  (no plugins loaded)")
        super().__init__("\n".join(lines), **kwargs)


class NiuuTUI(App[str]):
    """Main niuu TUI application.

    Dynamically shows pages registered by plugins via the PluginRegistry.
    """

    TITLE = "Niuu"
    SUB_TITLE = "Platform Control"

    CSS = """
    Screen {
        layout: vertical;
    }

    #main-container {
        height: 1fr;
    }

    #sidebar {
        width: 30;
        border: solid $accent;
        padding: 1;
    }

    #content {
        width: 1fr;
        padding: 1;
    }

    #welcome {
        margin: 1;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
    ]

    def __init__(
        self,
        pages: list[TUIPageSpec] | None = None,
        theme_name: str = "textual-dark",
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self._pages: list[TUIPageSpec] = pages or []
        self._theme_name = theme_name

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main-container"):
            with Vertical(id="sidebar"):
                yield PluginPageList(self._pages, id="page-list")
            with Vertical(id="content"):
                yield Static("Welcome to Niuu", id="welcome")
        yield Footer()

    def on_mount(self) -> None:
        self.theme = self._theme_name


def build_tui(
    registry: PluginRegistry | None = None,
    theme: str = "textual-dark",
) -> NiuuTUI:
    """Build the TUI app from a plugin registry."""
    pages: list[TUIPageSpec] = []
    if registry:
        for plugin in registry.plugins.values():
            pages.extend(plugin.tui_pages())
    return NiuuTUI(pages=pages, theme_name=theme)
