"""HelpOverlay — modal screen showing keybinding table grouped by section."""

from __future__ import annotations

from dataclasses import dataclass

from textual.app import ComposeResult
from textual.containers import Center, Vertical
from textual.screen import ModalScreen
from textual.widgets import Static

from cli.tui.theme import (
    ACCENT_AMBER,
    ACCENT_PURPLE,
    BG_SECONDARY,
    TEXT_MUTED,
    TEXT_SECONDARY,
)


@dataclass(frozen=True)
class KeyBinding:
    """A single keybinding entry.

    Use key="" and description="" for a section header.
    """

    key: str
    description: str
    section: str = ""


# Default keybindings shown in the help overlay.
DEFAULT_BINDINGS: list[KeyBinding] = [
    KeyBinding("", "", section="Navigation"),
    KeyBinding("1-7", "Switch page"),
    KeyBinding("Alt+1-7", "Switch page (insert mode)"),
    KeyBinding("j / ↓", "Move down"),
    KeyBinding("k / ↑", "Move up"),
    KeyBinding("g", "Go to top"),
    KeyBinding("G", "Go to bottom"),
    KeyBinding("Enter", "Select"),
    KeyBinding("", "", section="Modes"),
    KeyBinding("/", "Enter search mode"),
    KeyBinding("Ctrl+K", "Open command palette"),
    KeyBinding("Esc", "Exit mode / close overlay"),
    KeyBinding("", "", section="App"),
    KeyBinding("[", "Toggle sidebar"),
    KeyBinding("?", "Toggle help"),
    KeyBinding("r", "Refresh"),
    KeyBinding("q", "Quit"),
]


class HelpOverlay(ModalScreen[None]):
    """Full-screen modal showing keybinding reference."""

    DEFAULT_CSS = f"""
    HelpOverlay {{
        align: center middle;
    }}
    HelpOverlay #help-container {{
        width: 54;
        max-height: 80%;
        background: {BG_SECONDARY};
        border: round {ACCENT_AMBER};
        padding: 1 2;
    }}
    HelpOverlay #help-title {{
        text-align: center;
        text-style: bold;
        color: {ACCENT_AMBER};
        height: 1;
        margin-bottom: 1;
    }}
    HelpOverlay .help-section {{
        color: {ACCENT_PURPLE};
        text-style: bold;
        height: 1;
        margin-top: 1;
    }}
    HelpOverlay .help-row {{
        height: 1;
    }}
    HelpOverlay .help-close-hint {{
        text-align: center;
        color: {TEXT_MUTED};
        height: 1;
        margin-top: 1;
    }}
    """

    BINDINGS = [
        ("question_mark", "dismiss", "Close"),
        ("escape", "dismiss", "Close"),
    ]

    def __init__(
        self,
        bindings: list[KeyBinding] | None = None,
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self._bindings_list = bindings or DEFAULT_BINDINGS

    @property
    def bindings_list(self) -> list[KeyBinding]:
        return list(self._bindings_list)

    def compose(self) -> ComposeResult:
        with Center():
            with Vertical(id="help-container"):
                yield Static("⚒ Niuu — Keybindings", id="help-title")
                yield from self._build_rows()
                yield Static("Press ? or Esc to close", classes="help-close-hint")

    def _build_rows(self) -> list[Static]:
        rows: list[Static] = []
        for binding in self._bindings_list:
            if binding.section:
                rows.append(Static(f"── {binding.section} ──", classes="help-section"))
                continue
            key_col = f"[bold {ACCENT_AMBER}]{binding.key:>14}[/]"
            desc = f"[{TEXT_SECONDARY}]{binding.description}[/]"
            rows.append(Static(f"{key_col}  {desc}", classes="help-row"))
        return rows

    def action_dismiss(self) -> None:
        self.dismiss(None)
