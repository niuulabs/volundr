"""Phase 1 utility functions: greeting, reverse, fibonacci."""

from __future__ import annotations

from niuu.utils.fibonacci import fibonacci
from niuu.utils.greeting import greet


def greeting(name: str) -> str:
    return greet(name)


def reverse(text: str) -> str:
    """Return the reversed string."""
    return text[::-1]


__all__ = ["fibonacci", "greeting", "reverse"]
