"""Minimal Textual TUI app for Nuitka compilation spike.

Validates: widget rendering, input handling, async workers, CSS styling.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import DataTable, Footer, Header, Input, Static

TICK_INTERVAL_SECONDS = 0.5
MAX_LOG_ROWS = 50


class StatusBar(Static):
    """Displays async worker status and tick count."""

    def __init__(self) -> None:
        super().__init__("Worker: idle | Ticks: 0")
        self._ticks: int = 0
        self._worker_status: str = "idle"

    def update_tick(self, ticks: int) -> None:
        self._ticks = ticks
        self._refresh_display()

    def update_worker_status(self, status: str) -> None:
        self._worker_status = status
        self._refresh_display()

    def _refresh_display(self) -> None:
        self.update(f"Worker: {self._worker_status} | Ticks: {self._ticks}")


class SpikeApp(App[str]):
    """Spike app validating Textual features for Nuitka compilation.

    Features exercised:
    - DataTable widget with dynamic rows
    - Text input with submit handling
    - Async worker running in background
    - CSS styling via Textual CSS string
    - Key bindings and navigation
    """

    TITLE = "Niuu TUI Spike"
    SUB_TITLE = "Nuitka + Textual validation"

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
    }

    #log-table {
        height: 1fr;
    }

    #input-bar {
        dock: bottom;
        height: 3;
        padding: 0 1;
    }

    #status-bar {
        dock: bottom;
        height: 1;
        background: $surface;
        color: $text;
        padding: 0 1;
    }

    .sidebar-info {
        margin-bottom: 1;
    }
    """

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("d", "toggle_dark", "Toggle dark"),
        Binding("c", "clear_log", "Clear log"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._tick_count: int = 0
        self._running: bool = True

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main-container"):
            with Vertical(id="sidebar"):
                yield Static("Spike Validation", classes="sidebar-info")
                yield Static("Features:", classes="sidebar-info")
                yield Static("- DataTable", classes="sidebar-info")
                yield Static("- Input", classes="sidebar-info")
                yield Static("- Async worker", classes="sidebar-info")
                yield Static("- CSS styling", classes="sidebar-info")
            with Vertical(id="content"):
                yield DataTable(id="log-table")
                yield StatusBar()
        yield Input(placeholder="Type a message and press Enter...", id="input-bar")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#log-table", DataTable)
        table.add_columns("Time", "Source", "Message")
        self._add_log_row("system", "Spike app started")
        self._start_tick_worker()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if not event.value.strip():
            return
        self._add_log_row("user", event.value.strip())
        event.input.value = ""

    def action_toggle_dark(self) -> None:
        was_dark = self.theme == "textual-dark"
        super().action_toggle_dark()
        self._add_log_row("system", f"Dark mode: {not was_dark}")

    def action_clear_log(self) -> None:
        table = self.query_one("#log-table", DataTable)
        table.clear()
        self._tick_count = 0
        status = self.query_one(StatusBar)
        status.update_tick(0)
        self._add_log_row("system", "Log cleared")

    def _add_log_row(self, source: str, message: str) -> None:
        table = self.query_one("#log-table", DataTable)
        now = datetime.now(UTC).strftime("%H:%M:%S")
        table.add_row(now, source, message)
        if table.row_count > MAX_LOG_ROWS:
            table.remove_row(table.rows[next(iter(table.rows))].key)

    @work(exclusive=True)
    async def _start_tick_worker(self) -> None:
        """Background async worker that increments a tick counter."""
        status = self.query_one(StatusBar)
        status.update_worker_status("running")
        while self._running:
            await asyncio.sleep(TICK_INTERVAL_SECONDS)
            self._tick_count += 1
            status.update_tick(self._tick_count)
            if self._tick_count % 10 == 0:
                self._add_log_row("worker", f"Tick #{self._tick_count}")

    def on_unmount(self) -> None:
        self._running = False


def main() -> None:
    """Entry point for the spike app."""
    app = SpikeApp()
    app.run()


if __name__ == "__main__":
    main()
