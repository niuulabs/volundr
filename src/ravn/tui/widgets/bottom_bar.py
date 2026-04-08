"""BottomBar — keybinding hints, updates contextually per focused view."""

from __future__ import annotations

from textual.app import ComposeResult
from textual.widget import Widget
from textual.widgets import Static

# Default keybinding hints shown at the bottom
_DEFAULT_HINTS = (
    "[#71717a]^W v[/] vsplit  "
    "[#71717a]^W s[/] hsplit  "
    "[#71717a]^W q[/] close  "
    "[#71717a]^W w[/] next  "
    "[#71717a]^W z[/] zoom  "
    "[#71717a]:[/] cmd  "
    "[#71717a]q[/] quit"
)

_VIEW_HINTS: dict[str, str] = {
    "flokka": ("[#71717a]g[/] ghost  [#71717a]b[/] broadcast  [#71717a]n[/] notifs  "),
    "events": ("[#71717a]f[/] filter  [#71717a]G[/] bottom  [#71717a]l[/] lock  "),
    "tasks": (
        "[#71717a]s[/] stop  [#71717a]c[/] collect  [#71717a]n[/] new  [#71717a]↵[/] expand  "
    ),
    "mimir": (
        "[#71717a]↵[/] open  [#71717a]⌫[/] back  [#71717a]/[/] search  [#71717a]g[/] graph  "
    ),
    "cron": (
        "[#71717a]space[/] toggle  [#71717a]r[/] run  [#71717a]d[/] delete  [#71717a]n[/] new  "
    ),
    "checkpoints": ("[#71717a]r[/] resume  [#71717a]d[/] delete  "),
}


class BottomBar(Widget):
    """Bottom bar displaying contextual keybinding hints."""

    DEFAULT_CSS = """
    BottomBar {
        height: 1;
        background: #18181b;
        layout: horizontal;
        border-top: solid #3f3f46;
    }
    BottomBar #bb-hints {
        color: #71717a;
        width: 1fr;
        padding: 0 1;
    }
    """

    def compose(self) -> ComposeResult:
        yield Static(_DEFAULT_HINTS, id="bb-hints")

    def set_context(self, view_type: str) -> None:
        """Update hints for the focused view type."""
        extra = _VIEW_HINTS.get(view_type, "")
        text = extra + _DEFAULT_HINTS if extra else _DEFAULT_HINTS
        try:
            self.query_one("#bb-hints", Static).update(text)
        except Exception:
            pass
