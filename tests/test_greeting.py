import pytest
from src.niuu.utils.greeting import greet


def test_greet():
    """Test the greet function with various inputs."""
    assert greet("World") == "Hello, World!"
    assert greet("") == "Hello, !"