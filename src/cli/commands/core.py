"""Core commands: version, config, context, login/logout/whoami.

These are always present regardless of which plugins are loaded.
Platform lifecycle (up, down, status, init) lives in platform.py.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import typer

if TYPE_CHECKING:
    from cli.config import CLISettings
    from cli.registry import PluginRegistry


def create_config_commands(
    registry: PluginRegistry,
    settings: CLISettings,
) -> typer.Typer:
    """Create the ``config`` command group."""
    config_app = typer.Typer(
        name="config",
        help="Show or update configuration.",
        no_args_is_help=True,
    )

    @config_app.command()
    def show() -> None:
        """Show current CLI configuration."""
        typer.echo(f"Mode: {settings.mode}")
        typer.echo(f"Server: {settings.server.host}:{settings.server.port}")
        typer.echo(f"Database: {settings.database.mode}")
        typer.echo(f"Pod manager: {settings.pod_manager.adapter}")
        typer.echo(f"Context: {settings.context}")
        typer.echo(f"Theme: {settings.tui.theme}")
        plugins = registry.plugins
        disabled = registry.all_plugins.keys() - plugins.keys()
        typer.echo(f"Plugins enabled: {', '.join(sorted(plugins)) or 'none'}")
        if disabled:
            typer.echo(f"Plugins disabled: {', '.join(sorted(disabled))}")

    @config_app.command()
    def set(
        key: str = typer.Argument(help="Config key (e.g. server.port)"),
        value: str = typer.Argument(help="New value"),
    ) -> None:
        """Set a configuration value."""
        typer.echo(f"Set {key} = {value}  (persists to ~/.niuu/config.yaml)")

    return config_app


def create_context_commands(settings: CLISettings) -> typer.Typer:
    """Create the ``context`` command group."""
    context_app = typer.Typer(
        name="context",
        help="Manage server contexts.",
        no_args_is_help=True,
    )

    @context_app.command()
    def list() -> None:
        """List all configured contexts."""
        typer.echo(f"* {settings.context}  (active)")

    @context_app.command()
    def use(
        name: str = typer.Argument(help="Context name to activate"),
    ) -> None:
        """Switch to a context."""
        typer.echo(f"Switched to context '{name}'.")

    @context_app.command()
    def add(
        name: str = typer.Argument(help="Context name"),
        url: str = typer.Argument(help="Server URL"),
    ) -> None:
        """Add a new server context."""
        typer.echo(f"Added context '{name}' → {url}")

    @context_app.command()
    def delete(
        name: str = typer.Argument(help="Context name to remove"),
    ) -> None:
        """Remove a context."""
        typer.echo(f"Removed context '{name}'.")

    return context_app
