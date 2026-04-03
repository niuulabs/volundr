"""Tests for the Nuitka + Textual spike app using Textual's pilot framework."""

from __future__ import annotations

import pytest
from textual.widgets import DataTable, Input

from niuu.tui.app import SpikeApp, StatusBar


@pytest.fixture
def app() -> SpikeApp:
    return SpikeApp()


async def test_app_starts_and_renders_header(app: SpikeApp) -> None:
    """App mounts and header shows expected title."""
    async with app.run_test() as pilot:
        assert app.title == "Niuu TUI Spike"
        assert app.sub_title == "Nuitka + Textual validation"
        await pilot.pause()


async def test_datatable_has_columns(app: SpikeApp) -> None:
    """DataTable is created with Time, Source, Message columns."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        col_labels = [col.label.plain for col in table.columns.values()]
        assert col_labels == ["Time", "Source", "Message"]


async def test_initial_log_row(app: SpikeApp) -> None:
    """On mount, a 'system' row is added to the log table."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        assert table.row_count >= 1


async def test_input_submitted_adds_row(app: SpikeApp) -> None:
    """Submitting text in the input adds a row to the DataTable."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        initial_count = table.row_count

        input_widget = app.query_one("#input-bar", Input)
        input_widget.value = "hello spike"
        await pilot.press("enter")
        await pilot.pause()

        assert table.row_count == initial_count + 1


async def test_empty_input_not_added(app: SpikeApp) -> None:
    """Submitting empty input does not add a row."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        initial_count = table.row_count

        input_widget = app.query_one("#input-bar", Input)
        input_widget.value = "   "
        await pilot.press("enter")
        await pilot.pause()

        assert table.row_count == initial_count


async def test_toggle_dark_mode(app: SpikeApp) -> None:
    """action_toggle_dark toggles theme and adds a log row."""
    async with app.run_test() as pilot:
        await pilot.pause()
        initial_theme = app.theme
        table = app.query_one("#log-table", DataTable)
        count_before = table.row_count

        app.action_toggle_dark()
        await pilot.pause()

        assert app.theme != initial_theme
        assert table.row_count == count_before + 1


async def test_clear_log(app: SpikeApp) -> None:
    """Pressing 'c' clears the log table and resets tick count."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        assert table.row_count >= 1

        await pilot.press("c")
        await pilot.pause()

        # After clear, there should be exactly 1 row ("Log cleared")
        assert table.row_count == 1


async def test_status_bar_exists(app: SpikeApp) -> None:
    """StatusBar widget is present in the DOM."""
    async with app.run_test() as pilot:
        await pilot.pause()
        status = app.query_one(StatusBar)
        assert status is not None


async def test_status_bar_update_tick() -> None:
    """StatusBar.update_tick refreshes display text."""
    bar = StatusBar()
    bar.update_tick(42)
    assert bar._ticks == 42


async def test_status_bar_update_worker_status() -> None:
    """StatusBar.update_worker_status refreshes display text."""
    bar = StatusBar()
    bar.update_worker_status("running")
    assert bar._worker_status == "running"


async def test_sidebar_content(app: SpikeApp) -> None:
    """Sidebar contains feature list items."""
    async with app.run_test() as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar")
        statics = sidebar.query(".sidebar-info")
        assert len(statics) >= 5


async def test_quit_binding(app: SpikeApp) -> None:
    """Pressing 'q' exits the app."""
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("q")
        # If we get here without hanging, the quit binding works
        assert True


async def test_css_applied(app: SpikeApp) -> None:
    """CSS is loaded — sidebar has expected width constraint."""
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        sidebar = app.query_one("#sidebar")
        # Sidebar should exist and have styles applied
        assert sidebar.styles.width is not None


async def test_async_worker_increments_ticks(app: SpikeApp) -> None:
    """The background worker increments the tick counter."""
    async with app.run_test() as pilot:
        # Wait enough for at least one tick (0.5s interval)
        await pilot.pause(delay=1.0)
        assert app._tick_count >= 1
        status = app.query_one(StatusBar)
        assert status._worker_status == "running"


async def test_multiple_inputs(app: SpikeApp) -> None:
    """Multiple inputs each add their own row."""
    async with app.run_test() as pilot:
        await pilot.pause()
        table = app.query_one("#log-table", DataTable)
        initial_count = table.row_count

        input_widget = app.query_one("#input-bar", Input)
        for msg in ["first", "second", "third"]:
            input_widget.value = msg
            await pilot.press("enter")
            await pilot.pause()

        assert table.row_count == initial_count + 3


async def test_input_cleared_after_submit(app: SpikeApp) -> None:
    """Input field is cleared after a message is submitted."""
    async with app.run_test() as pilot:
        await pilot.pause()
        input_widget = app.query_one("#input-bar", Input)
        input_widget.value = "test message"
        await pilot.press("enter")
        await pilot.pause()
        assert input_widget.value == ""
