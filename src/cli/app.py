"""Typer app factory — discovers plugins and mounts commands.

The CLI never hardcodes knowledge of any service. Plugins bring their
own commands, services, API clients, and TUI pages.
"""

from __future__ import annotations

import logging

import typer

from cli.config import CLISettings
from cli.registry import PluginRegistry
from cli.services.manager import ServiceManager

logger = logging.getLogger(__name__)


def build_app(
    settings: CLISettings | None = None,
    registry: PluginRegistry | None = None,
) -> typer.Typer:
    """Build the niuu CLI app with plugin discovery.

    Parameters are injectable for testing. When None, defaults are created.
    """
    if settings is None:
        settings = CLISettings()

    if registry is None:
        registry = PluginRegistry()
        registry.discover_entry_points()
        registry.discover_config(settings.plugins.extra)
        registry.apply_config(settings.plugins.enabled)

    from cli.commands.core import _print_status

    manager = ServiceManager(
        registry=registry,
        health_check_interval=settings.services.health_check_interval_seconds,
        health_check_timeout=settings.services.health_check_timeout_seconds,
        health_check_max_retries=settings.services.health_check_max_retries,
        on_status_change=_print_status,
    )

    app = typer.Typer(
        name="niuu",
        help="Niuu — unified CLI for the Niuu platform.",
        no_args_is_help=True,
        invoke_without_command=True,
    )

    # Version callback
    def _version_callback(value: bool) -> None:
        if value:
            typer.echo(f"niuu {settings.version}")
            raise typer.Exit()

    @app.callback()
    def main(
        version: bool = typer.Option(
            False,
            "--version",
            "-V",
            help="Print version and exit.",
            callback=_version_callback,
            is_eager=True,
        ),
    ) -> None:
        """Niuu — unified CLI for the Niuu platform."""

    # Register core commands
    from cli.commands.core import create_core_commands

    core = create_core_commands(registry, settings, manager)
    for cmd_info in core.registered_commands:
        if cmd_info.callback:
            app.command(name=cmd_info.name)(cmd_info.callback)

    # Register TUI command
    @app.command()
    def tui() -> None:
        """Launch the interactive TUI."""
        from cli.tui.app import build_tui

        tui_app = build_tui(registry=registry, theme=settings.tui.theme)
        tui_app.run()

    # Register plugin commands
    for name, plugin in registry.plugins.items():
        try:
            plugin_app = typer.Typer(help=plugin.description)
            plugin.register_commands(plugin_app)
            if plugin_app.registered_commands:
                app.add_typer(plugin_app, name=name)
        except Exception:
            logger.exception("failed to register commands for plugin: %s", name)

    return app
