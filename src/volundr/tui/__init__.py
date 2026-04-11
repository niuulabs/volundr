"""Volundr TUI pages — registered via VolundrPlugin.tui_pages()."""

from volundr.tui.admin import AdminPage
from volundr.tui.chat import ChatPage
from volundr.tui.chronicles import ChroniclesPage
from volundr.tui.diffs import DiffsPage
from volundr.tui.sessions import SessionsPage
from volundr.tui.settings import SettingsPage
from volundr.tui.terminal import TerminalPage

__all__ = [
    "AdminPage",
    "ChatPage",
    "ChroniclesPage",
    "DiffsPage",
    "SessionsPage",
    "SettingsPage",
    "TerminalPage",
]
