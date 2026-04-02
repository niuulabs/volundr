"""TyrPlugin — registers Tyr as a niuu CLI plugin.

Provides saga/dispatch commands, the Tyr coordinator service,
and TUI pages for saga management.
"""

from __future__ import annotations

from collections.abc import Sequence

import typer

from cli.registry import ServicePlugin


class TyrPlugin(ServicePlugin):
    """Plugin for the Tyr saga coordinator service."""

    @property
    def name(self) -> str:
        return "tyr"

    @property
    def description(self) -> str:
        return "Autonomous saga coordinator — reviews, dispatch, raids"

    def depends_on(self) -> Sequence[str]:
        return ["volundr"]

    def register_commands(self, app: typer.Typer) -> None:
        """Register tyr-specific CLI commands."""

        @app.command()
        def sagas() -> None:
            """List active Tyr sagas."""
            typer.echo("Tyr sagas (stub)")

        @app.command()
        def dispatch() -> None:
            """Show dispatch status."""
            typer.echo("Tyr dispatch (stub)")
