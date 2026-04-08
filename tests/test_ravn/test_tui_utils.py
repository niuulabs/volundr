"""Unit tests for ravn.tui.utils shared utilities."""

from __future__ import annotations

from ravn.tui.utils import iter_bar


def test_iter_bar_basic() -> None:
    result = iter_bar(4, 8)
    assert result == "4/8 ▓▓▓▓░░░░"


def test_iter_bar_with_prefix() -> None:
    result = iter_bar(4, 8, prefix="iter ")
    assert result == "iter 4/8 ▓▓▓▓░░░░"


def test_iter_bar_none_current() -> None:
    assert iter_bar(None, 8) == "—"


def test_iter_bar_none_maximum() -> None:
    assert iter_bar(4, None) == "—"


def test_iter_bar_zero_maximum() -> None:
    assert iter_bar(0, 0) == "—"


def test_iter_bar_full() -> None:
    result = iter_bar(8, 8)
    assert result == "8/8 ▓▓▓▓▓▓▓▓"


def test_iter_bar_empty() -> None:
    result = iter_bar(0, 8)
    assert result == "0/8 ░░░░░░░░"


def test_iter_bar_invalid_type() -> None:
    assert iter_bar("bad", 8) == "—"
    assert iter_bar(4, "bad") == "—"
