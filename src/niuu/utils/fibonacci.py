"""Fibonacci sequence utilities."""

from __future__ import annotations


def fibonacci(n: int) -> list[int]:
    """Return the first n Fibonacci numbers.

    Args:
        n: The number of Fibonacci numbers to return.

    Returns:
        A list of the first n Fibonacci numbers, starting with 0.
    """
    if n <= 0:
        return []

    if n == 1:
        return [0]

    sequence = [0, 1]
    for _ in range(2, n):
        sequence.append(sequence[-1] + sequence[-2])

    return sequence
