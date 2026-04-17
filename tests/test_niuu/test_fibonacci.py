"""Tests for niuu.utils.fibonacci."""

from __future__ import annotations

from niuu.utils.fibonacci import fibonacci


class TestFibonacci:
    def test_zero_returns_empty(self):
        assert fibonacci(0) == []

    def test_one_returns_first(self):
        assert fibonacci(1) == [0]

    def test_five_returns_first_five(self):
        assert fibonacci(5) == [0, 1, 1, 2, 3]

    def test_eight_returns_first_eight(self):
        assert fibonacci(8) == [0, 1, 1, 2, 3, 5, 8, 13]
