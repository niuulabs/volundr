"""Typer app factory — discovers plugins and mounts commands.

New command tree (NIU-405):

  Platform:
    platform up|down|status|init    — lifecycle (dynamic service flags)

  Workflow (registered by plugins at top level):
    sessions list|create|stop|delete
    sagas    list|create|dispatch
    raids    active|approve|reject|retry

  Identity:
    login / logout / whoami

  Configuration:
    config  show|set
    context list|use|add|delete

  Other:
    tui
    version
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

    from cli.commands.platform import _print_status

    manager = ServiceManager(
        registry=registry,
        health_check_interval=settings.services.health_check_interval_seconds,
        health_check_timeout=settings.services.health_check_timeout_seconds,
        health_check_max_retries=settings.services.health_check_max_retries,
        on_status_change=_print_status,
    )

    app = typer.Typer(
        name="niuu",
        help="The Niuu platform CLI.",
        no_args_is_help=True,
        invoke_without_command=True,
        rich_markup_mode=None,
    )

    # ------------------------------------------------------------------ #
    # --version / -V flag                                                  #
    # ------------------------------------------------------------------ #
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
        """The Niuu platform CLI."""

    # ------------------------------------------------------------------ #
    # Platform lifecycle                                                   #
    # ------------------------------------------------------------------ #
    from cli.commands.platform import create_platform_commands

    app.add_typer(create_platform_commands(registry, settings, manager), name="platform")

    # ------------------------------------------------------------------ #
    # version                                                              #
    # ------------------------------------------------------------------ #
    @app.command()
    def version() -> None:
        """Print the niuu CLI version."""
        typer.echo(f"niuu {settings.version}")

    # ------------------------------------------------------------------ #
    # Identity                                                             #
    # ------------------------------------------------------------------ #
    @app.command()
    def login() -> None:
        """Authenticate with the Niuu platform."""
        typer.echo("Opening browser for authentication...")

    @app.command()
    def logout() -> None:
        """Clear stored credentials."""
        typer.echo("Logged out.")

    @app.command()
    def whoami() -> None:
        """Show the currently authenticated user."""
        typer.echo("Not authenticated. Run 'niuu login' first.")

    # ------------------------------------------------------------------ #
    # Configuration                                                        #
    # ------------------------------------------------------------------ #
    from cli.commands.core import create_config_commands, create_context_commands

    app.add_typer(create_config_commands(registry, settings), name="config")
    app.add_typer(create_context_commands(settings), name="context")

    # ------------------------------------------------------------------ #
    # TUI                                                                  #
    # ------------------------------------------------------------------ #
    @app.command()
    def tui() -> None:
        """Launch the interactive TUI."""
        from cli.tui.app import build_tui

        tui_app = build_tui(registry=registry, theme=settings.tui.theme)
        tui_app.run()

    # ------------------------------------------------------------------ #
    # Plugin workflow commands (top-level, registered by each plugin)     #
    # Plugins call app.add_typer(...) directly on the main app.           #
    # ------------------------------------------------------------------ #
    for name, plugin in registry.plugins.items():
        try:
            plugin.register_commands(app)
        except Exception:
            logger.exception("failed to register commands for plugin: %s", name)

    return app
