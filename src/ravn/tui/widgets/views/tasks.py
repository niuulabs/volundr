"""TaskBoardView — cascade task board with CaptureChannel progress."""

from __future__ import annotations

from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.widget import Widget
from textual.widgets import DataTable

from ravn.tui.utils import iter_bar

_STATUS_STYLE: dict[str, str] = {
    "running": "#f59e0b",
    "queued": "#06b6d4",
    "complete": "#10b981",
    "error": "#ef4444",
    "stopped": "#71717a",
}


class TaskBoardView(Widget):
    """Shows all running and queued cascade tasks across the Flokk."""

    DEFAULT_CSS = """
    TaskBoardView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
    }
    TaskBoardView DataTable {
        height: 1fr;
    }
    """

    can_focus = True

    BINDINGS = [
        Binding("s", "stop_task", "Stop"),
        Binding("c", "collect", "Collect"),
        Binding("n", "new_task", "New"),
        Binding("enter", "expand_task", "Expand"),
    ]

    def __init__(self, flokka: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._flokka = flokka
        self._tasks: list[dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        table = DataTable(id="tb-table", cursor_type="row")
        table.add_columns("Task ID", "Title", "Ravn", "Status", "Progress", "Elapsed")
        yield table

    def on_mount(self) -> None:
        if self._flokka:
            self._flokka.on_event(self._on_event)
        self.set_interval(5.0, self._refresh)

    def _on_event(self, conn: Any, event: dict[str, Any]) -> None:
        event_type = str(event.get("event", ""))
        if event_type in ("task_started", "task_complete"):
            self.call_after_refresh(self._refresh)

    def _refresh(self) -> None:
        try:
            table = self.query_one("#tb-table", DataTable)
        except Exception:
            return
        table.clear()
        for task in self._tasks:
            tid = str(task.get("task_id", ""))[:8]
            title = task.get("title", "—")[:30]
            ravn = task.get("ravn", "—")
            status = task.get("status", "?")
            style = _STATUS_STYLE.get(status, "#a1a1aa")
            progress = iter_bar(task.get("iteration"), task.get("max_iterations"))
            elapsed = task.get("elapsed", "—")
            table.add_row(
                tid,
                title,
                ravn,
                f"[{style}]{status}[/]",
                progress,
                elapsed,
            )

    def load_tasks(self, tasks: list[dict[str, Any]]) -> None:
        """Load task data directly (for testing or programmatic use)."""
        self._tasks = list(tasks)
        self._refresh()

    def action_stop_task(self) -> None:
        pass  # Wired up by app

    def action_collect(self) -> None:
        pass

    def action_new_task(self) -> None:
        pass

    def action_expand_task(self) -> None:
        pass
