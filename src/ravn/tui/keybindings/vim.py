"""Vimscript keybinding parser.

Parses ``~/.vimrc``, ``~/.vim/vimrc``, or any vimscript file to extract
normal-mode remaps (``nnoremap``, ``noremap``, ``nmap``) and translates
them into additional TUI bindings.

Only mappings whose RHS resolves to a known TUI action are imported.
All others are silently ignored.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from ravn.tui.keybindings.defaults import VIM_RHS_TO_ACTION
from ravn.tui.keybindings.model import KeybindingMap, vim_sequence_to_textual

logger = logging.getLogger(__name__)

# Matches: nnoremap/noremap/nmap/nnmap with optional <silent>/<nowait>/etc. flags
_REMAP_RE = re.compile(
    r"^\s*(?:nn(?:oremap)?|n(?:oremap|map))\s+"
    r"(?:<(?:silent|buffer|nowait|expr|unique|script)>\s*)*"
    r"(\S+)\s+(\S+)",
    re.IGNORECASE,
)

# Candidate config file paths in preference order
_VIM_PATHS: list[Path] = [
    Path.home() / ".vimrc",
    Path.home() / ".vim" / "vimrc",
    Path.home() / ".vim" / "init.vim",
]


def find_vimrc() -> Path | None:
    """Return the first existing vimrc path, or None."""
    env_path = _env_myvimrc()
    if env_path and env_path.exists():
        return env_path
    for p in _VIM_PATHS:
        if p.exists():
            return p
    return None


def _env_myvimrc() -> Path | None:
    import os

    val = os.environ.get("MYVIMRC")
    return Path(val) if val else None


class VimscriptParser:
    """Parse a vimscript file for normal-mode key remaps.

    Only extracts mappings whose RHS is (or chains to) a known TUI window
    management or navigation command.
    """

    def parse_file(self, path: Path) -> dict[str, str]:
        """Return ``{vim_lhs: vim_rhs}`` for all relevant remaps in *path*."""
        try:
            content = path.read_text(errors="replace")
        except OSError as exc:
            logger.debug("cannot read vimrc %s: %s", path, exc)
            return {}
        return self.parse(content)

    def parse(self, content: str) -> dict[str, str]:
        """Return ``{vim_lhs: vim_rhs}`` from vimscript content string."""
        remaps: dict[str, str] = {}
        for line in content.splitlines():
            # Strip inline comments
            line = re.sub(r'\s+".*$', "", line)
            m = _REMAP_RE.match(line)
            if not m:
                continue
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
            # Resolve the RHS through one level of chaining
            action = VIM_RHS_TO_ACTION.get(vim_rhs)
            if action is None:
                # Try resolving via another remap in the same file
                chained_rhs = remaps.get(vim_rhs)
                if chained_rhs:
                    action = VIM_RHS_TO_ACTION.get(chained_rhs)

            if action is None:
                continue

            textual_lhs = vim_sequence_to_textual(vim_lhs)
            if textual_lhs is None:
                kb.warn(f"vim: cannot convert LHS {vim_lhs!r} to Textual key")
                continue

            kb.register(textual_lhs, action)
            logger.debug("vim: %s → %s → %s", vim_lhs, vim_rhs, action)
            added += 1

        return added
