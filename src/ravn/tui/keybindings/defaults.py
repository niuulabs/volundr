"""Default vim-style keybindings for the Ravn TUI.

These are used as the baseline and are always present unless explicitly
disabled via ``keybindings.disabled`` in ``~/.ravn/tui.yaml``.
User-parsed remaps from their editor config are *added on top* of these
defaults (or replace them when there is a key conflict).
"""

from __future__ import annotations

from ravn.tui.keybindings.model import KeybindingMap

# Vim RHS patterns → TUI action names.
# Used by all parsers to resolve "what does this vim command do in the TUI".
VIM_RHS_TO_ACTION: dict[str, str] = {
    # Window navigation
    "<C-w>h": "focus_left",
    "<C-w>j": "focus_down",
    "<C-w>k": "focus_up",
    "<C-w>l": "focus_right",
    # Window movement to screen edge
    "<C-w>H": "move_far_left",
    "<C-w>J": "move_far_down",
    "<C-w>K": "move_far_up",
    "<C-w>L": "move_far_right",
    # Split / close / cycle
    "<C-w>v": "split_vert",
    "<C-w>s": "split_horiz",
    "<C-w>q": "close_pane",
    "<C-w>w": "focus_next",
    # Zoom / resize / rotate / swap
    "<C-w>z": "zoom_pane",
    "<C-w>=": "equalise_panes",
    "<C-w>r": "rotate_pane",
    "<C-w>x": "swap_pane",
    "<C-w><": "resize_left",
    "<C-w>>": "resize_right",
    "<C-w>+": "resize_up",
    "<C-w>-": "resize_down",
}


def build_default_map(disabled: list[str] | None = None) -> KeybindingMap:
    """Return a :class:`KeybindingMap` with built-in vim-style defaults.

    Args:
        disabled: List of Textual key names to suppress (from config).
    """
    disabled_set = set(disabled or [])
    kb = KeybindingMap()

    _register = [
        # ---- ctrl+w prefix sequences (multi-key) ----
        (["ctrl+w", "v"], "split_vert"),
        (["ctrl+w", "s"], "split_horiz"),
        (["ctrl+w", "q"], "close_pane"),
        (["ctrl+w", "w"], "focus_next"),
        (["ctrl+w", "h"], "focus_left"),
        (["ctrl+w", "j"], "focus_down"),
        (["ctrl+w", "k"], "focus_up"),
        (["ctrl+w", "l"], "focus_right"),
        (["ctrl+w", "H"], "move_far_left"),
        (["ctrl+w", "J"], "move_far_down"),
        (["ctrl+w", "K"], "move_far_up"),
        (["ctrl+w", "L"], "move_far_right"),
        (["ctrl+w", "x"], "swap_pane"),
        (["ctrl+w", "="], "equalise_panes"),
        (["ctrl+w", "z"], "zoom_pane"),
        (["ctrl+w", "<"], "resize_left"),
        (["ctrl+w", ">"], "resize_right"),
        (["ctrl+w", "+"], "resize_up"),
        (["ctrl+w", "-"], "resize_down"),
        (["ctrl+w", "r"], "rotate_pane"),
        # ---- double-key sequences ----
        (["g", "g"], "scroll_top"),
        # ---- single-key (view-level navigation) ----
        # Note: j/k/G/g// are handled within individual views via their
        # own BINDINGS.  They are listed here so user remaps override them.
        (["j"], "scroll_down"),
        (["k"], "scroll_up"),
        (["G"], "scroll_bottom"),
        (["/"], "search"),
        # ---- app-level single keys ----
        ([":"], "command_mode"),
        (["q"], "quit"),
        (["b"], "broadcast"),
        (["n"], "notifications"),
        (["i"], "insert_mode"),
        (["?"], "command_palette"),
        # View assignment: assign current pane to the given view type
        (["f"], "view_flokka"),
        (["e"], "view_events"),
        (["t"], "view_tasks"),
        (["m"], "view_mimir"),
        # Pane management
        (["z"], "zoom_pane"),
        (["tab"], "focus_next"),
    ]

    for sequence, action in _register:
        if sequence[0] not in disabled_set:
            kb.register(sequence, action)

    return kb
