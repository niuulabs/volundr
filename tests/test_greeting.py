"""Tests for niuu.utils.greeting."""

from niuu.utils.greeting import greet


def test_greet_world():
    assert greet("World") == "Hello, World!"


def test_greet_empty_string():
    assert greet("") == "Hello, !"
