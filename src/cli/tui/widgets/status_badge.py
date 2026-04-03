"""StatusBadge widget — colored dot + label for status indicators."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widget import Widget
from textual.widgets import Static

# Status → (dot character, color hex).
_STATUS_MAP: dict[str, tuple[str, str]] = {
    "running": ("●", "#10b981"),
    "connected": ("●", "#10b981"),
    "starting": ("◐", "#f59e0b"),
    "provisioning": ("◐", "#f59e0b"),
    "stopped": ("○", "#71717a"),
    "disconnected": ("○", "#71717a"),
    "error": ("●", "#ef4444"),
    "failed": ("●", "#ef4444"),
    "completed": ("●", "#06b6d4"),
    "pending": ("◌", "#a855f7"),
}

_DEFAULT_INDICATOR: tuple[str, str] = ("○", "#71717a")


class StatusBadge(Widget):
    """Colored dot + label showing a status value."""

    DEFAULT_CSS = """
    StatusBadge {
        height: 1;
        width: auto;
    }
    """

    def __init__(
        self,
        status: str = "stopped",
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self._status = status

    @property
    def status(self) -> str:
        return self._status

    def set_status(self, status: str) -> None:
        self._status = status
        self._refresh()

    def compose(self) -> ComposeResult:
        yield Static(self._render(), id="badge-label")

    def _render(self) -> str:
        dot, color = _STATUS_MAP.get(self._status, _DEFAULT_INDICATOR)
        return f"[{color}]{dot}[/] [{color}]{self._status}[/]"

    def _refresh(self) -> None:
        try:
            label = self.query_one("#badge-label", Static)
        except Exception:
            return
        label.update(self._render())
