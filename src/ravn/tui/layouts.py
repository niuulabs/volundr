"""Named layout save/restore for Ravn TUI.

Layouts are persisted to ~/.ravn/tui/layouts.json.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LAYOUT_DIR = Path.home() / ".ravn" / "tui"
_LAYOUT_FILE = _LAYOUT_DIR / "layouts.json"

# ------------------------------------------------------------------
# Built-in layout presets — serialised split trees
# ------------------------------------------------------------------

_BUILTIN_LAYOUTS: dict[str, dict[str, Any]] = {
    "flokk": {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.25,
        "left": {"type": "leaf", "view": "flokka", "target": None},
        "right": {
            "type": "branch",
            "direction": "horizontal",
            "ratio": 0.5,
            "left": {"type": "leaf", "view": "chat", "target": None},
            "right": {"type": "leaf", "view": "events", "target": None},
        },
    },
    "cascade": {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.5,
        "left": {"type": "leaf", "view": "tasks", "target": None},
        "right": {
            "type": "branch",
            "direction": "vertical",
            "ratio": 0.5,
            "left": {"type": "leaf", "view": "chat", "target": None},
            "right": {"type": "leaf", "view": "events", "target": None},
        },
    },
    "mimir": {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.75,
        "left": {"type": "leaf", "view": "mimir", "target": None},
        "right": {"type": "leaf", "view": "events", "target": None},
    },
    "compare": {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.5,
        "left": {"type": "leaf", "view": "chat", "target": "ravn1"},
        "right": {"type": "leaf", "view": "chat", "target": "ravn2"},
    },
    "broadcast": {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.5,
        "left": {"type": "leaf", "view": "flokka", "target": None},
        "right": {"type": "leaf", "view": "events", "target": None},
    },
}

_DEFAULT_LAYOUT: dict[str, Any] = _BUILTIN_LAYOUTS["flokk"]


class LayoutManager:
    """Manages named layout presets — built-in and user-defined."""

    def __init__(self) -> None:
        self._user_layouts: dict[str, dict[str, Any]] = {}
        self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save(self, name: str, tree: dict[str, Any]) -> None:
        """Save a layout under *name*, persisting to disk."""
        self._user_layouts[name] = tree
        self._persist()

    def load(self, name: str) -> dict[str, Any] | None:
        """Return layout tree by name (built-in first, then user-defined)."""
        if name in _BUILTIN_LAYOUTS:
            return _BUILTIN_LAYOUTS[name]
        return self._user_layouts.get(name)

    def list(self) -> list[str]:
        """Return all available layout names."""
        names = list(_BUILTIN_LAYOUTS.keys()) + list(self._user_layouts.keys())
        return sorted(set(names))

    def delete(self, name: str) -> bool:
        """Delete a user-defined layout. Returns True if deleted."""
        if name not in self._user_layouts:
            return False
        del self._user_layouts[name]
        self._persist()
        return True

    def default(self) -> dict[str, Any]:
        return dict(_DEFAULT_LAYOUT)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if not _LAYOUT_FILE.exists():
            return
        try:
            data = json.loads(_LAYOUT_FILE.read_text())
            self._user_layouts = data if isinstance(data, dict) else {}
        except Exception:
            logger.warning("failed to load layouts from %s", _LAYOUT_FILE)

    def _persist(self) -> None:
        try:
            _LAYOUT_DIR.mkdir(parents=True, exist_ok=True)
            _LAYOUT_FILE.write_text(json.dumps(self._user_layouts, indent=2))
        except Exception:
            logger.warning("failed to persist layouts to %s", _LAYOUT_FILE)
