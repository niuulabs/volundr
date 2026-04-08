"""PaneWidget — leaf node of the split tree.

Hosts a single view and knows its pane_id.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.reactive import reactive
from textual.widget import Widget

if TYPE_CHECKING:
    pass


class PaneWidget(Widget):
    """A single pane in the split layout.

    Hosts one of the 8 view types.  Focused panes are highlighted
    with an amber border.
    """

    DEFAULT_CSS = """
    PaneWidget {
        border: solid #3f3f46;
        height: 1fr;
        width: 1fr;
    }
    PaneWidget:focus {
        border: solid #f59e0b;
    }
    PaneWidget.-focused {
        border: solid #f59e0b;
    }
    """

    focused_pane: reactive[bool] = reactive(False)

    def __init__(
        self,
        pane_id: str,
        view_type: str = "flokka",
        target: str | None = None,
        flokka: Any | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self.pane_id = pane_id
        self._view_type = view_type
        self._target = target
        self._flokka: Any | None = flokka

    def compose(self) -> ComposeResult:
        yield self._build_view()

    def _build_view(self) -> Widget:
        from ravn.tui.widgets.views.caps import CapsView
        from ravn.tui.widgets.views.chat import ChatView
        from ravn.tui.widgets.views.checkpoints import CheckpointsView
        from ravn.tui.widgets.views.cron import CronView
        from ravn.tui.widgets.views.events import EventStreamView
        from ravn.tui.widgets.views.flokka import FlokkaView
        from ravn.tui.widgets.views.mimir import MimirView
        from ravn.tui.widgets.views.tasks import TaskBoardView

        conn = None
        if self._flokka and self._target:
            conn = self._flokka.get(self._target)

        match self._view_type:
            case "chat":
                return ChatView(connection=conn)
            case "events":
                return EventStreamView(flokka=self._flokka, target=self._target)
            case "tasks":
                return TaskBoardView(flokka=self._flokka)
            case "mimir":
                return MimirView(connection=conn)
            case "cron":
                return CronView(connection=conn)
            case "checkpoints":
                return CheckpointsView(connection=conn)
            case "caps":
                return CapsView(flokka=self._flokka)
            case _:
                return FlokkaView(flokka=self._flokka)

    def assign_view(
        self,
        view_type: str,
        target: str | None = None,
        flokka: Any | None = None,
    ) -> None:
        """Change the view hosted by this pane."""
        self._view_type = view_type
        self._target = target
        if flokka is not None:
            self._flokka = flokka
        self.remove_children()
        self.mount(self._build_view())

    def watch_focused_pane(self, focused: bool) -> None:
        self.set_class(focused, "-focused")

    def on_focus(self) -> None:
        self.focused_pane = True

    def on_blur(self) -> None:
        self.focused_pane = False
