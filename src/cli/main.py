"""Niuu CLI entry point — dispatches to the Typer app."""

from __future__ import annotations

from cli.app import build_app


def main() -> None:
    """Build the Typer app and run it."""
    app = build_app()
    app()
