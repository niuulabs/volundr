"""Neovim config keybinding parser.

Supports:
- ``~/.config/nvim/init.vim`` — vimscript (delegated to VimscriptParser)
- ``~/.config/nvim/init.lua`` — Lua API calls

Lua patterns recognised::

    vim.keymap.set('n', '<C-h>', '<C-w>h')
    vim.keymap.set("n", "<C-h>", "<C-w>h", { silent = true })
    vim.api.nvim_set_keymap('n', '<C-h>', '<C-w>h', {})
    vim.api.nvim_set_keymap("n", "<C-h>", "<C-w>h", { noremap = true })

Only normal-mode (``'n'``) mappings are imported.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from ravn.tui.keybindings.defaults import VIM_RHS_TO_ACTION
from ravn.tui.keybindings.model import KeybindingMap, vim_sequence_to_textual
from ravn.tui.keybindings.vim import VimscriptParser

logger = logging.getLogger(__name__)

_NVIM_CONFIG_DIR = Path.home() / ".config" / "nvim"

# Candidate paths in preference order
_NVIM_PATHS: list[Path] = [
    _NVIM_CONFIG_DIR / "init.lua",
    _NVIM_CONFIG_DIR / "init.vim",
    Path.home() / ".config" / "nvim" / "init.lua",
]

# vim.keymap.set('n', '<lhs>', '<rhs>' [, opts])
_KEYMAP_SET_RE = re.compile(
    r"""vim\.keymap\.set\s*\(\s*['"]n['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]""",
    re.IGNORECASE,
)

# vim.api.nvim_set_keymap('n', '<lhs>', '<rhs>', opts)
_NVIM_SET_KEYMAP_RE = re.compile(
    r"""vim\.api\.nvim_set_keymap\s*\(\s*['"]n['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]""",
    re.IGNORECASE,
)

# which-key.nvim style (common): map('n', '<lhs>', '<rhs>')
_WKMAP_RE = re.compile(
    r"""(?:^|\s)map\s*\(\s*['"]n['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]""",
)


def find_nvim_config() -> Path | None:
    """Return the first existing neovim config path."""
    for p in _NVIM_PATHS:
        if p.exists():
            return p
    return None


class NvimLuaParser:
    """Parse a Neovim Lua init file for normal-mode key remaps."""

    def parse_file(self, path: Path) -> dict[str, str]:
        """Return ``{vim_lhs: vim_rhs}`` from *path* (Lua or vimscript)."""
        if path.suffix == ".vim":
            return VimscriptParser().parse_file(path)
        try:
            content = path.read_text(errors="replace")
        except OSError as exc:
            logger.debug("cannot read nvim config %s: %s", path, exc)
            return {}
        return self.parse(content)

    def parse(self, content: str) -> dict[str, str]:
        """Extract ``{vim_lhs: vim_rhs}`` from Lua content."""
        remaps: dict[str, str] = {}
        for pattern in (_KEYMAP_SET_RE, _NVIM_SET_KEYMAP_RE, _WKMAP_RE):
            for m in pattern.finditer(content):
                lhs, rhs = m.group(1), m.group(2)
                remaps[lhs] = rhs
        return remaps

    def apply_to_map(self, path: Path, kb: KeybindingMap) -> int:
        """Parse *path* and add recognised remaps to *kb*.

        Returns the number of bindings added.
        """
        remaps = self.parse_file(path)
        added = 0
        for vim_lhs, vim_rhs in remaps.items():
            action = VIM_RHS_TO_ACTION.get(vim_rhs)
            if action is None:
                chained = remaps.get(vim_rhs)
                if chained:
                    action = VIM_RHS_TO_ACTION.get(chained)

            if action is None:
                continue

            textual_lhs = vim_sequence_to_textual(vim_lhs)
            if textual_lhs is None:
                kb.warn(f"nvim: cannot convert LHS {vim_lhs!r} to Textual key")
                continue

            kb.register(textual_lhs, action)
            logger.debug("nvim: %s → %s → %s", vim_lhs, vim_rhs, action)
            added += 1

        return added
