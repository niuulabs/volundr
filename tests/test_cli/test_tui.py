"""Tests for cli.tui.app — Textual TUI app."""

from __future__ import annotations

import pytest
from textual.widgets import Static

from cli.registry import PluginRegistry, TUIPageSpec
from cli.tui.app import NiuuTUI, PluginPageList, build_tui
from tests.test_cli.conftest import FakePlugin


@pytest.fixture
def tui_app() -> NiuuTUI:
    return NiuuTUI()


async def test_app_starts(tui_app: NiuuTUI) -> None:
    """App mounts successfully."""
    async with tui_app.run_test() as pilot:
        assert tui_app.title == "Niuu"
        assert tui_app.sub_title == "Platform Control"
        await pilot.pause()


async def test_sidebar_present(tui_app: NiuuTUI) -> None:
    """Sidebar with page list is rendered."""
    async with tui_app.run_test() as pilot:
        await pilot.pause()
        sidebar = tui_app.query_one("#sidebar")
        assert sidebar is not None


async def test_welcome_message(tui_app: NiuuTUI) -> None:
    """Content area shows welcome message."""
    async with tui_app.run_test() as pilot:
        await pilot.pause()
        welcome = tui_app.query_one("#welcome", Static)
        assert welcome is not None


async def test_quit_binding(tui_app: NiuuTUI) -> None:
    """Pressing q exits the app."""
    async with tui_app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("q")
        assert True


async def test_theme_applied() -> None:
    """Custom theme is applied on mount."""
    app = NiuuTUI(theme_name="textual-light")
    async with app.run_test() as pilot:
        await pilot.pause()
        assert app.theme == "textual-light"


async def test_pages_shown_in_sidebar() -> None:
    """Plugin pages are listed in the sidebar."""
    pages = [
        TUIPageSpec(name="Sessions", icon="S", widget_class=Static),
        TUIPageSpec(name="Sagas", icon="T", widget_class=Static),
    ]
    app = NiuuTUI(pages=pages)
    async with app.run_test() as pilot:
        await pilot.pause()
        page_list = app.query_one("#page-list", PluginPageList)
        assert page_list._pages == pages
        assert len(page_list._pages) == 2


async def test_no_pages_message() -> None:
    """Empty pages list shows 'no plugins loaded' message."""
    app = NiuuTUI(pages=[])
    async with app.run_test() as pilot:
        await pilot.pause()
        page_list = app.query_one("#page-list", PluginPageList)
        assert page_list._pages == []


def test_build_tui_without_registry() -> None:
    """build_tui works with no registry."""
    app = build_tui()
    assert isinstance(app, NiuuTUI)


def test_build_tui_with_registry() -> None:
    """build_tui collects pages from plugins."""
    registry = PluginRegistry()
    registry.register(FakePlugin(name="test"))
    app = build_tui(registry=registry)
    assert isinstance(app, NiuuTUI)


def test_plugin_page_list_widget() -> None:
    """PluginPageList renders page names."""
    pages = [TUIPageSpec(name="Test", icon="🧪", widget_class=Static)]
    widget = PluginPageList(pages)
    assert widget._pages == pages
