"""Niuu CLI entry point — dispatches to the Typer app."""

from __future__ import annotations

import os
from pathlib import Path


def main() -> None:
    """Build the Typer app and run it."""
    # Set default NIUU_CONFIG so all config systems (CLI, Volundr, Tyr)
    # read from ~/.niuu/config.yaml. The --config / --home flags override
    # this via eager callbacks before settings are loaded.
    if "NIUU_CONFIG" not in os.environ:
        default = Path.home() / ".niuu" / "config.yaml"
        if default.exists():
            os.environ["NIUU_CONFIG"] = str(default)

    from cli.app import build_app

    app = build_app()
    app()
