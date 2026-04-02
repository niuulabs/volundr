"""Niuu CLI — unified entry point for the Niuu platform."""

from importlib.metadata import version

try:
    __version__ = version("volundr")
except Exception:
    __version__ = "0.0.0-dev"
