"""FlokkaView — Flokk membership overview."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import DataTable, Static

if TYPE_CHECKING:
    pass

_STATUS_LABEL: dict[str, str] = {
    "connected": "● connected",
    "connecting": "◌ connecting",
    "disconnected": "○ disconnected",
    "error": "✗ error",
}

_STATUS_STYLE: dict[str, str] = {
    "connected": "bold #10b981",
    "connecting": "#f59e0b",
    "disconnected": "#71717a",
    "error": "bold #ef4444",
}


class FlokkaView(Widget):
    """Lists all discovered Ravens with status, progress, and capabilities."""

    DEFAULT_CSS = """
    FlokkaView {
        height: 1fr;
        width: 1fr;
        background: #09090b;
    }
    FlokkaView #fv-header {
        color: #f59e0b;
        padding: 0 1;
    }
    FlokkaView DataTable {
        height: 1fr;
    }
    """

    BINDINGS = [
        ("g", "ghost_mode", "Ghost"),
        ("b", "broadcast", "Broadcast"),
        ("n", "notifications", "Notifs"),
    ]

    _tick: reactive[int] = reactive(0)

    def __init__(self, flokka: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._flokka: Any | None = flokka

    def compose(self) -> ComposeResult:
        yield Static("ᚠ  Flokk", id="fv-header")
        table = DataTable(id="fv-table", cursor_type="row")
        table.add_columns("Name", "Host", "Status", "Iter", "Uptime", "Task")
        yield table

    def on_mount(self) -> None:
        self.set_interval(2.0, self._refresh_table)
        if self._flokka:
            self._flokka.on_event(self._on_flokk_event)
        self._refresh_table()

    def _on_flokk_event(self, conn: Any, event: dict[str, Any]) -> None:
        self.call_after_refresh(self._refresh_table)

    def _refresh_table(self) -> None:
        try:
            table = self.query_one("#fv-table", DataTable)
        except Exception:
            return
        table.clear()
        if not self._flokka:
            table.add_row("(no flokka)", "—", "—", "—", "—", "—")
            return
        for conn in self._flokka.connections():
            status = conn.status
            label = _STATUS_LABEL.get(status, status)
            style = _STATUS_STYLE.get(status, "")
            info = conn.ravn_info
            iter_str = _iter_bar(info.get("iteration"), info.get("max_iterations"))
            uptime = info.get("uptime", "—")
            task = _truncate(info.get("task_title", "—"), 30)
            ghost_marker = " ⊙" if conn.ghost else ""
            name = f"ᚱ {conn.name}{ghost_marker}"
            table.add_row(
                name,
                conn.host,
                f"[{style}]{label}[/]",
                iter_str,
                uptime,
                task,
            )

    def action_ghost_mode(self) -> None:
        """Open ghost (read-only) event stream for selected Ravn."""
        try:
            table = self.query_one("#fv-table", DataTable)
            row = table.cursor_row
            if self._flokka:
                conns = self._flokka.connections()
                if 0 <= row < len(conns):
                    conn = conns[row]
                    self.app.post_message_no_wait(
                        self.app.GhostMode(conn.host, conn.port)
                    ) if hasattr(self.app, "GhostMode") else None
        except Exception:
            pass

    def action_broadcast(self) -> None:
        self.app.action_broadcast() if hasattr(self.app, "action_broadcast") else None

    def action_notifications(self) -> None:
        self.app.action_notifications() if hasattr(self.app, "action_notifications") else None


def _iter_bar(current: Any, maximum: Any) -> str:
    if current is None or maximum is None:
        return "—"
    try:
        cur = int(current)
        mx = int(maximum)
        if mx == 0:
            return "—"
        filled = int((cur / mx) * 8)
        bar = "▓" * filled + "░" * (8 - filled)
        return f"iter {cur}/{mx} {bar}"
    except (ValueError, TypeError):
        return "—"


def _truncate(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"
