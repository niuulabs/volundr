"""StatusBar — top bar with logo, Flokk count, active Ravn, clock."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Label, Static

_URGENCY_THRESHOLD = 0.8


class StatusBar(Widget):
    """Top status bar: ᚠ Flokk name · Ravn count · active task count · clock."""

    DEFAULT_CSS = """
    StatusBar {
        height: 1;
        background: #18181b;
        layout: horizontal;
        border-bottom: solid #3f3f46;
    }
    StatusBar #sb-logo {
        color: #f59e0b;
        width: auto;
        padding: 0 1;
    }
    StatusBar #sb-flokk {
        color: #a1a1aa;
        width: auto;
        padding: 0 1;
    }
    StatusBar #sb-active {
        color: #06b6d4;
        width: auto;
        padding: 0 1;
    }
    StatusBar #sb-tasks {
        color: #a855f7;
        width: auto;
        padding: 0 1;
    }
    StatusBar #sb-clock {
        color: #71717a;
        width: auto;
        padding: 0 1;
        dock: right;
    }
    StatusBar #sb-notification {
        color: #f59e0b;
        width: 1fr;
        padding: 0 1;
    }
    """

    _clock: reactive[str] = reactive("")
    _notification: reactive[str] = reactive("")

    def __init__(self, flokka: Any | None = None, **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._flokka = flokka
        self._active_ravn: str = "—"
        self._task_count: int = 0

    def compose(self) -> ComposeResult:
        yield Static("ᚠ Flokk", id="sb-logo")
        yield Label("0 ravens", id="sb-flokk")
        yield Label("—", id="sb-active")
        yield Label("0 tasks", id="sb-tasks")
        yield Static("", id="sb-notification")
        yield Label("", id="sb-clock")

    def on_mount(self) -> None:
        self.set_interval(1.0, self._tick)
        if self._flokka:
            self._flokka.on_event(self._on_event)

    def _tick(self) -> None:
        now = datetime.now().strftime("%H:%M:%S")
        try:
            self.query_one("#sb-clock", Label).update(now)
        except Exception:
            pass
        self._update_flokk_count()

    def _on_event(self, conn: Any, event: dict[str, Any]) -> None:
        data = event.get("data", {})
        if not isinstance(data, dict):
            return
        urgency = data.get("urgency", 0.0)
        if urgency >= _URGENCY_THRESHOLD:
            self._flash_notification(str(data.get("payload", {}).get("text", "")))

    def _flash_notification(self, text: str) -> None:
        try:
            notif = self.query_one("#sb-notification", Static)
            notif.update(f"⚡ {text}")
            notif.add_class("-urgent")
        except Exception:
            return
        self.set_timer(5.0, self._clear_notification)

    def _clear_notification(self) -> None:
        try:
            notif = self.query_one("#sb-notification", Static)
            notif.update("")
            notif.remove_class("-urgent")
        except Exception:
            pass

    def _update_flokk_count(self) -> None:
        if not self._flokka:
            return
        conns = self._flokka.connections()
        count = len(conns)
        try:
            self.query_one("#sb-flokk", Label).update(f"{count} ravens")
        except Exception:
            pass

    def set_active_ravn(self, name: str) -> None:
        self._active_ravn = name
        try:
            self.query_one("#sb-active", Label).update(name)
        except Exception:
            pass

    def set_task_count(self, count: int) -> None:
        self._task_count = count
        try:
            self.query_one("#sb-tasks", Label).update(f"{count} tasks")
        except Exception:
            pass
