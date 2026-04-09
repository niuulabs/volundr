"""Data model for TUI keybindings."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# A TUI action name — matches the app's action_* methods
TuiAction = str

# A key sequence: one or more Textual key names in order.
# Single key:  ["ctrl+h"]
# Multi-key:   ["ctrl+w", "v"]  or  ["g", "g"]
KeySequence = list[str]

# -------------------------------------------------------------------------
# Vim → Textual key name conversion
# -------------------------------------------------------------------------

_VIM_SPECIALS: dict[str, str] = {
    "<Esc>": "escape",
    "<C-[>": "escape",
    "<CR>": "enter",
    "<Return>": "enter",
    "<NL>": "enter",
    "<Space>": "space",
    "<Tab>": "tab",
    "<BS>": "backspace",
    "<Del>": "delete",
    "<Up>": "up",
    "<Down>": "down",
    "<Left>": "left",
    "<Right>": "right",
    "<Home>": "home",
    "<End>": "end",
    "<PageUp>": "pageup",
    "<PageDown>": "pagedown",
    "<F1>": "f1",
    "<F2>": "f2",
    "<F3>": "f3",
    "<F4>": "f4",
    "<F5>": "f5",
    "<F6>": "f6",
    "<F7>": "f7",
    "<F8>": "f8",
    "<F9>": "f9",
    "<F10>": "f10",
    "<F11>": "f11",
    "<F12>": "f12",
    "<leader>": None,   # cannot map leader to a single Textual key
    "<LocalLeader>": None,
}

_CTRL_RE = re.compile(r"^<C-([a-zA-Z0-9\[\]\\^_])>$", re.IGNORECASE)
_ALT_RE = re.compile(r"^<[MA]-([a-zA-Z0-9])>$", re.IGNORECASE)


def vim_key_to_textual(vim_notation: str) -> str | None:
    """Convert a single vim key notation token to a Textual key name.

    Returns ``None`` for tokens that cannot be mapped (e.g. ``<leader>``).
    """
    # Direct lookup first
    if vim_notation in _VIM_SPECIALS:
        return _VIM_SPECIALS[vim_notation]

    # <C-x> → ctrl+x
    m = _CTRL_RE.match(vim_notation)
    if m:
        char = m.group(1).lower()
        return f"ctrl+{char}"

    # <M-x> / <A-x> → alt+x
    m = _ALT_RE.match(vim_notation)
    if m:
        char = m.group(1).lower()
        return f"alt+{char}"

    # Plain character — return as-is
    if len(vim_notation) == 1 and vim_notation not in "<>":
        return vim_notation

    return None


def vim_sequence_to_textual(vim_seq: str) -> list[str] | None:
    """Convert a vim key sequence string to a list of Textual key names.

    e.g. ``"<C-w>h"`` → ``["ctrl+w", "h"]``
         ``"<C-h>"``   → ``["ctrl+h"]``
         ``"gg"``      → ``["g", "g"]``

    Returns ``None`` if any token cannot be converted.
    """
    tokens = _tokenise_vim_seq(vim_seq)
    result: list[str] = []
    for tok in tokens:
        key = vim_key_to_textual(tok)
        if key is None:
            return None
        result.append(key)
    return result if result else None


def _tokenise_vim_seq(seq: str) -> list[str]:
    """Split a vim key sequence into individual token strings."""
    tokens: list[str] = []
    i = 0
    while i < len(seq):
        if seq[i] == "<":
            end = seq.find(">", i)
            if end == -1:
                tokens.append(seq[i])
                i += 1
            else:
                tokens.append(seq[i : end + 1])
                i = end + 1
        else:
            tokens.append(seq[i])
            i += 1
    return tokens


# -------------------------------------------------------------------------
# Emacs → Textual key name conversion
# -------------------------------------------------------------------------

_EMACS_SPECIALS: dict[str, str] = {
    "RET": "enter",
    "ESC": "escape",
    "SPC": "space",
    "TAB": "tab",
    "DEL": "delete",
    "BS": "backspace",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
}

_EMACS_CTRL_RE = re.compile(r"^C-([a-zA-Z0-9])$")
_EMACS_META_RE = re.compile(r"^M-([a-zA-Z0-9])$")


def emacs_key_to_textual(emacs_key: str) -> str | None:
    """Convert an emacs key string (from ``kbd``) to a Textual key name."""
    if emacs_key in _EMACS_SPECIALS:
        return _EMACS_SPECIALS[emacs_key]
    m = _EMACS_CTRL_RE.match(emacs_key)
    if m:
        return f"ctrl+{m.group(1).lower()}"
    m = _EMACS_META_RE.match(emacs_key)
    if m:
        return f"alt+{m.group(1).lower()}"
    if len(emacs_key) == 1:
        return emacs_key
    return None


def emacs_kbd_to_textual(kbd_string: str) -> list[str] | None:
    """Convert an emacs kbd string to a list of Textual key names.

    e.g. ``"C-h"`` → ``["ctrl+h"]``
         ``"C-x C-f"`` → ``["ctrl+x", "ctrl+f"]``
    """
    parts = kbd_string.strip().split()
    result: list[str] = []
    for part in parts:
        key = emacs_key_to_textual(part)
        if key is None:
            return None
        result.append(key)
    return result if result else None


# -------------------------------------------------------------------------
# KeybindingMap
# -------------------------------------------------------------------------

@dataclass
class KeybindingMap:
    """Maps TUI actions to one or more key sequences.

    Single-key sequences (length 1) are stored in :attr:`single_key`
    for O(1) dispatch.  Multi-key sequences (length > 1) are stored in
    :attr:`multi_key` for sequence-buffer matching.
    """

    # action → primary display sequence (first registered)
    single_key: dict[str, str] = field(default_factory=dict)
    """key → action for single-key bindings."""

    multi_key: list[tuple[list[str], str]] = field(default_factory=list)
    """(key_sequence, action) pairs for multi-key bindings."""

    _warnings: list[str] = field(default_factory=list, repr=False)

    def register(self, sequence: KeySequence, action: TuiAction) -> None:
        """Register a key sequence → action binding."""
        if not sequence:
            return
        if len(sequence) == 1:
            self.single_key[sequence[0]] = action
        else:
            self.multi_key.append((list(sequence), action))

    def register_vim_rhs(self, textual_lhs: list[str], vim_rhs: str, action_map: dict[str, str]) -> bool:
        """Try to map a user lhs to an action via vim rhs patterns.

        Returns True if a mapping was found.
        """
        action = action_map.get(vim_rhs)
        if action is None:
            return False
        self.register(textual_lhs, action)
        return True

    def warn(self, msg: str) -> None:
        self._warnings.append(msg)

    @property
    def warnings(self) -> list[str]:
        return list(self._warnings)
