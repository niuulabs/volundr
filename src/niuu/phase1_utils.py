"""Phase 1 utility functions: greeting, reverse, fibonacci."""

from __future__ import annotations

from niuu.utils.greeting import greet


def greeting(name: str) -> str:
    return greet(name)


def reverse(text: str) -> str:
    """Return the reversed string."""
    return text[::-1]


def fibonacci(n: int) -> list[int]:
    """Return the first n Fibonacci numbers (0-indexed sequence)."""
    if n <= 0:
        return []
    if n == 1:
        return [0]
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence
