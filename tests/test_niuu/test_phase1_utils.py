"""Tests for niuu.phase1_utils and scripts/demo_utils.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from niuu.phase1_utils import fibonacci, greeting, reverse


class TestGreeting:
    def test_returns_hello_name(self):
        assert greeting("Niuu") == "Hello, Niuu!"

    def test_empty_name(self):
        assert greeting("") == "Hello, !"

    def test_different_name(self):
        assert greeting("World") == "Hello, World!"


class TestReverse:
    def test_reverses_string(self):
        assert reverse("Niuu") == "uuiN"

    def test_empty_string(self):
        assert reverse("") == ""

    def test_palindrome(self):
        assert reverse("racecar") == "racecar"

    def test_single_char(self):
        assert reverse("a") == "a"


class TestFibonacci:
    def test_seven_elements(self):
        assert fibonacci(7) == [0, 1, 1, 2, 3, 5, 8]

    def test_zero_returns_empty(self):
        assert fibonacci(0) == []

    def test_one_returns_zero(self):
        assert fibonacci(1) == [0]

    def test_two_returns_first_two(self):
        assert fibonacci(2) == [0, 1]

    def test_negative_returns_empty(self):
        assert fibonacci(-1) == []


class TestDemoScript:
    def test_script_exits_with_code_zero(self):
        script = Path(__file__).parent.parent.parent / "scripts" / "demo_utils.py"
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0

    def test_script_output(self):
        script = Path(__file__).parent.parent.parent / "scripts" / "demo_utils.py"
        result = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
        )
        assert result.stdout == "Hello, Niuu!\nReversed: uuiN\nFibonacci(7): [0, 1, 1, 2, 3, 5, 8]\n"
