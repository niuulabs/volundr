"""VolundrPlugin — registers Volundr as a niuu CLI plugin.

Provides session/chronicle commands, the Volundr API service,
and TUI pages for session management.
"""

from __future__ import annotations

from collections.abc import Sequence

import typer

from niuu.ports.plugin import ServicePlugin


class VolundrPlugin(ServicePlugin):
    """Plugin for the Volundr development platform service."""

    @property
    def name(self) -> str:
        return "volundr"

    @property
    def description(self) -> str:
        return "AI-native development platform — sessions, chronicles, workspaces"

    def depends_on(self) -> Sequence[str]:
        return []

    def register_commands(self, app: typer.Typer) -> None:
        """Register volundr-specific CLI commands."""

        @app.command()
        def sessions() -> None:
            """List active Volundr sessions."""
            typer.echo("Volundr sessions (stub)")

        @app.command()
        def chronicles() -> None:
            """List chronicles."""
            typer.echo("Volundr chronicles (stub)")
