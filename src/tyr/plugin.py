"""TyrPlugin — registers Tyr as a niuu CLI plugin.

Provides ``sagas`` and ``raids`` top-level command groups, the Tyr
coordinator service, and TUI pages for saga management.
"""

from __future__ import annotations

import typer

from niuu.ports.plugin import Service, ServiceDefinition, ServicePlugin


class _TyrService(Service):
    """Stub Tyr service (replaced by real implementation at runtime)."""

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def health_check(self) -> bool:
        return True


class TyrPlugin(ServicePlugin):
    """Plugin for the Tyr saga coordinator service."""

    @property
    def name(self) -> str:
        return "tyr"

    @property
    def description(self) -> str:
        return "Autonomous saga coordinator — reviews, dispatch, raids"

    def register_service(self) -> ServiceDefinition:
        return ServiceDefinition(
            name="tyr",
            description="Autonomous saga coordinator",
            factory=_TyrService,
            default_enabled=True,
            depends_on=["postgres", "volundr"],
            default_port=8081,
        )

    def create_service(self) -> Service:
        return self.register_service().factory()

    def register_commands(self, app: typer.Typer) -> None:
        """Mount workflow commands directly on the main app."""
        sagas = typer.Typer(
            name="sagas",
            help="Manage sagas.",
            no_args_is_help=True,
        )

        @sagas.command()
        def list() -> None:
            """List active sagas."""
            typer.echo("Sagas: (stub)")

        @sagas.command()
        def create(
            name: str = typer.Argument(help="Saga name"),
        ) -> None:
            """Create a new saga."""
            typer.echo(f"Creating saga '{name}'... (stub)")

        @sagas.command()
        def dispatch(
            name: str = typer.Argument(help="Saga name"),
        ) -> None:
            """Dispatch a saga."""
            typer.echo(f"Dispatching saga '{name}'... (stub)")

        raids = typer.Typer(
            name="raids",
            help="Manage raids.",
            no_args_is_help=True,
        )

        @raids.command()
        def active() -> None:
            """List active raids."""
            typer.echo("Active raids: (stub)")

        @raids.command()
        def approve(
            raid_id: str = typer.Argument(help="Raid ID"),
        ) -> None:
            """Approve a pending raid."""
            typer.echo(f"Approved raid {raid_id}. (stub)")

        @raids.command()
        def reject(
            raid_id: str = typer.Argument(help="Raid ID"),
        ) -> None:
            """Reject a pending raid."""
            typer.echo(f"Rejected raid {raid_id}. (stub)")

        @raids.command()
        def retry(
            raid_id: str = typer.Argument(help="Raid ID"),
        ) -> None:
            """Retry a failed raid."""
            typer.echo(f"Retrying raid {raid_id}. (stub)")

        app.add_typer(sagas, name="sagas")
        app.add_typer(raids, name="raids")
