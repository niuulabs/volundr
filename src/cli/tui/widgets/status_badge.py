"""StatusBadge widget — colored dot + label for status indicators."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widget import Widget
from textual.widgets import Static

from cli.tui.theme import (
    ACCENT_AMBER,
    ACCENT_CYAN,
    ACCENT_EMERALD,
    ACCENT_PURPLE,
    ACCENT_RED,
    TEXT_MUTED,
)

# Status → (dot character, color hex).
_STATUS_MAP: dict[str, tuple[str, str]] = {
    "running": ("●", ACCENT_EMERALD),
    "connected": ("●", ACCENT_EMERALD),
    "starting": ("◐", ACCENT_AMBER),
    "provisioning": ("◐", ACCENT_AMBER),
    "stopped": ("○", TEXT_MUTED),
    "disconnected": ("○", TEXT_MUTED),
    "error": ("●", ACCENT_RED),
    "failed": ("●", ACCENT_RED),
    "completed": ("●", ACCENT_CYAN),
    "pending": ("◌", ACCENT_PURPLE),
}

_DEFAULT_INDICATOR: tuple[str, str] = ("○", TEXT_MUTED)


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
