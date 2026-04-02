"""Core commands: up, down, status, config, version.

These are always present regardless of which plugins are loaded.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import typer

if TYPE_CHECKING:
    from cli.config import CLISettings
    from cli.registry import PluginRegistry
    from cli.services.manager import ServiceManager


def create_core_commands(
    registry: PluginRegistry,
    settings: CLISettings,
    manager: ServiceManager,
) -> typer.Typer:
    """Create the core command group."""
    app = typer.Typer(no_args_is_help=False)

    @app.command()
    def up(
        only: str | None = typer.Option(None, help="Start only this service + deps"),
    ) -> None:
        """Start all enabled services (or --only NAME for a single service)."""
        asyncio.run(manager.start_all(only=only))
        typer.echo("Services started.")

    @app.command()
    def down() -> None:
        """Stop all running services."""
        asyncio.run(manager.stop_all())
        typer.echo("Services stopped.")

    @app.command()
    def status() -> None:
        """Show status of registered services."""
        plugins = registry.plugins
        if not plugins:
            typer.echo("No plugins registered.")
            return
        for name, plugin in sorted(plugins.items()):
            svc_status = manager.services.get(name)
            state = svc_status.state.value if svc_status else "not started"
            typer.echo(f"  {name}: {state} — {plugin.description}")

    @app.command()
    def config() -> None:
        """Show current CLI configuration."""
        typer.echo(f"Context: {settings.context}")
        typer.echo(f"Theme: {settings.tui.theme}")
        plugins = registry.plugins
        disabled = registry.all_plugins.keys() - plugins.keys()
        typer.echo(f"Plugins enabled: {', '.join(sorted(plugins)) or 'none'}")
        if disabled:
            typer.echo(f"Plugins disabled: {', '.join(sorted(disabled))}")

    @app.command()
    def version() -> None:
        """Print the niuu CLI version."""
        typer.echo(f"niuu {settings.version}")

    return app
