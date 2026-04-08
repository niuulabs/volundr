"""EventStreamView — live SSE event stream with type and source filters."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from textual.app import ComposeResult
from textual.binding import Binding
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import DataTable, Label

_EVENT_STYLES: dict[str, str] = {
    "thought": "#71717a",
    "tool_start": "#a855f7",
    "tool_result": "#6366f1",
    "response": "#10b981",
    "error": "#ef4444",
    "decision": "#f59e0b",
    "task_complete": "#06b6d4",
    "task_started": "#06b6d4",
}

_EVENT_CYCLE = ["all", "thought", "tool", "response", "task", "heartbeat"]

_MAX_ROWS = 500


class EventStreamView(Widget):
    """SSE subscription to /events.

    Columns: timestamp, event type (colour-coded badge), source Ravn, detail.
    Filters: type with `f`, source with `/`.
    """

    DEFAULT_CSS = """
    EventStreamView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
    }
    EventStreamView #ev-header {
        color: #f59e0b;
        padding: 0 1;
    }
    EventStreamView DataTable {
        height: 1fr;
    }
    """

    BINDINGS = [
        Binding("f", "cycle_filter", "Filter type"),
        Binding("G", "scroll_bottom", "Bottom"),
        Binding("l", "lock_scroll", "Lock"),
        Binding("g", "scroll_top", "Top"),
    ]

    _filter_idx: reactive[int] = reactive(0)
    _locked: reactive[bool] = reactive(False)
    _row_count: reactive[int] = reactive(0)

    def __init__(
        self,
        flokka: Any | None = None,
        target: str | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self._flokka = flokka
        self._target = target
        self._events: list[dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        yield Label("⚡ events", id="ev-header")
        table = DataTable(id="ev-table", cursor_type="row")
        table.add_columns("Time", "Type", "Source", "Detail")
        yield table

    def on_mount(self) -> None:
        if self._flokka:
            self._flokka.on_event(self._on_event)
        self._update_header()

    def _on_event(self, conn: Any, event: dict[str, Any]) -> None:
        if self._target and conn.name != self._target:
            return
        self._events.append({"conn": conn.name, "event": event})
        if len(self._events) > _MAX_ROWS:
            self._events = self._events[-_MAX_ROWS:]
        self.call_after_refresh(self._append_row, conn, event)

    def _append_row(self, conn: Any, event: dict[str, Any]) -> None:
        current_filter = _EVENT_CYCLE[self._filter_idx]
        data_field = event.get("data", {})
        fallback_type = data_field.get("type", "?") if isinstance(data_field, dict) else "?"
        event_type = str(event.get("event", fallback_type))

        if current_filter != "all":
            if not event_type.startswith(current_filter):
                return

        try:
            table = self.query_one("#ev-table", DataTable)
        except Exception:
            return

        style = _EVENT_STYLES.get(event_type, "#a1a1aa")
        ts = datetime.now().strftime("%H:%M:%S")
        data = event.get("data", {})
        detail = ""
        if isinstance(data, dict):
            detail = _summarise(data)
        source = conn.name if hasattr(conn, "name") else str(conn)
        table.add_row(ts, f"[{style}]{event_type}[/]", source, detail)
        self._row_count += 1

        if not self._locked:
            table.move_cursor(row=table.row_count - 1)

    def action_cycle_filter(self) -> None:
        self._filter_idx = (self._filter_idx + 1) % len(_EVENT_CYCLE)
        self._update_header()

    def action_scroll_bottom(self) -> None:
        self._locked = False
        try:
            table = self.query_one("#ev-table", DataTable)
            table.move_cursor(row=table.row_count - 1)
        except Exception:
            pass

    def action_scroll_top(self) -> None:
        try:
            table = self.query_one("#ev-table", DataTable)
            table.move_cursor(row=0)
        except Exception:
            pass

    def action_lock_scroll(self) -> None:
        self._locked = not self._locked

    def _update_header(self) -> None:
        current_filter = _EVENT_CYCLE[self._filter_idx]
        lock_indicator = " 🔒" if self._locked else ""
        try:
            label = self.query_one("#ev-header", Label)
            label.update(f"⚡ events [{current_filter}]{lock_indicator}")
        except Exception:
            pass


def _summarise(data: dict[str, Any]) -> str:
    """Return a short summary of event payload."""
    if "text" in data:
        return str(data["text"])[:60]
    if "tool_name" in data:
        return f"{data['tool_name']}"
    if "message" in data:
        return str(data["message"])[:60]
    if "title" in data:
        return str(data["title"])[:60]
    return str(data)[:60]
