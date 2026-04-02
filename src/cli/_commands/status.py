"""``niuu status`` — show platform service status."""

from __future__ import annotations


def execute() -> int:
    """Print status of Niuu platform services."""
    print("Niuu platform status:")
    print("  volundr: unknown")
    print("  tyr:     unknown")
    print("  skuld:   unknown")
    return 0
