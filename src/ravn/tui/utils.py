"""Shared utilities for Ravn TUI widgets."""

from __future__ import annotations

from typing import Any


def iter_bar(current: Any, maximum: Any, prefix: str = "") -> str:
    """Render an iteration progress bar string.

    Args:
        current: Current iteration count (or None).
        maximum: Maximum iteration count (or None).
        prefix: Optional prefix string (e.g. "iter ").

    Returns:
        A formatted progress string, or "—" if data is unavailable.
    """
    if current is None or maximum is None:
        return "—"
    try:
        cur = int(current)
        mx = int(maximum)
        if mx == 0:
            return "—"
        filled = int((cur / mx) * 8)
        bar = "▓" * filled + "░" * (8 - filled)
        return f"{prefix}{cur}/{mx} {bar}"
    except (ValueError, TypeError):
        return "—"
