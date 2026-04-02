"""VolundrPlugin — registers Volundr as a niuu CLI plugin.

Provides the ``sessions`` top-level command group, the Volundr API service,
and TUI pages for session management.
"""

from __future__ import annotations

import typer

from niuu.ports.plugin import Service, ServiceDefinition, ServicePlugin


class _VolundrService(Service):
    """Stub Volundr service (replaced by real implementation at runtime)."""

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def health_check(self) -> bool:
        return True


class VolundrPlugin(ServicePlugin):
    """Plugin for the Volundr development platform service."""

    @property
    def name(self) -> str:
        return "volundr"

    @property
    def description(self) -> str:
        return "AI-native development platform — sessions, chronicles, workspaces"

    def register_service(self) -> ServiceDefinition:
        return ServiceDefinition(
            name="volundr",
            description="AI-native development platform",
            factory=_VolundrService,
            default_enabled=True,
            depends_on=["postgres"],
            default_port=8080,
        )

    def create_service(self) -> Service:
        return self.register_service().factory()

    def register_commands(self, app: typer.Typer) -> None:
        """Mount workflow commands directly on the main app."""
        sessions = typer.Typer(
            name="sessions",
            help="Manage coding sessions.",
            no_args_is_help=True,
        )

        @sessions.command()
        def list() -> None:
            """List active sessions."""
            typer.echo("Sessions: (stub)")

        @sessions.command()
        def create(
            name: str = typer.Argument(help="Session name"),
        ) -> None:
            """Create a new session."""
            typer.echo(f"Creating session '{name}'... (stub)")

        @sessions.command()
        def stop(
            name: str = typer.Argument(help="Session name"),
        ) -> None:
            """Stop a running session."""
            typer.echo(f"Stopping session '{name}'... (stub)")

        @sessions.command()
        def delete(
            name: str = typer.Argument(help="Session name"),
        ) -> None:
            """Delete a session."""
            typer.echo(f"Deleting session '{name}'... (stub)")

        app.add_typer(sessions, name="sessions")
