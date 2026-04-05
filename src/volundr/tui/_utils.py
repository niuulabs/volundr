"""Shared utilities for volundr TUI pages."""

from __future__ import annotations


def format_count(n: int) -> str:
    """Format a number with K/M suffixes for display."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)
