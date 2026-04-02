"""Core commands: up, down, status, config, version.

These are always present regardless of which plugins are loaded.
"""

from __future__ import annotations

import asyncio
import signal
from typing import TYPE_CHECKING

import typer

from cli.services.manager import ServiceState, StartupError
from cli.services.preflight import (
    PreflightConfig,
    format_results,
    has_failures,
    run_preflight_checks,
)

if TYPE_CHECKING:
    from cli.config import CLISettings
    from cli.registry import PluginRegistry
    from cli.services.manager import ServiceManager


def _build_preflight_config(settings: CLISettings) -> PreflightConfig:
    """Build a PreflightConfig from CLISettings."""
    return PreflightConfig(
        claude_binary=settings.pod_manager.claude_binary,
        ports=[settings.server.port],
        workspaces_dir=settings.pod_manager.workspaces_dir,
        database_mode=settings.database.mode,
        database_dsn=settings.database.dsn,
    )


def _print_status(name: str, state: ServiceState) -> None:
    """Print service status changes to the terminal."""
    match state:
        case ServiceState.STARTING:
            typer.echo(f"  Starting {name}...", nl=False)
        case ServiceState.HEALTHY:
            typer.echo(" ok")
        case ServiceState.UNHEALTHY:
            typer.echo(" FAILED")
        case ServiceState.STOPPING:
            typer.echo(f"  Stopping {name}...", nl=False)
        case ServiceState.STOPPED:
            typer.echo(" done")


async def _startup(
    manager: ServiceManager,
    settings: CLISettings,
    only: str | None,
    skip_preflight: bool,
) -> None:
    """Run preflight checks and start services."""
    if not skip_preflight:
        typer.echo("Running preflight checks...")
        config = _build_preflight_config(settings)
        results = run_preflight_checks(config)
        typer.echo(format_results(results))

        if has_failures(results):
            typer.echo("\nPreflight checks failed. Fix the issues above and retry.")
            raise typer.Exit(1)
        typer.echo()

    typer.echo("Starting services...")
    try:
        await manager.start_all(only=only, rollback_on_failure=True)
    except StartupError as exc:
        typer.echo(f"\nStartup failed: {exc}")
        raise typer.Exit(1) from None

    host = settings.server.host
    port = settings.server.port
    typer.echo(f"\nReady! All services running on http://{host}:{port}")
    typer.echo(f"  Volundr API: http://{host}:{port}/api/v1/")
    typer.echo(f"  Web UI:      http://{host}:{port}/")


async def _shutdown(manager: ServiceManager) -> None:
    """Stop all services gracefully."""
    typer.echo("Stopping services...")
    await manager.stop_all()


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
        skip_preflight: bool = typer.Option(False, help="Skip preflight checks"),
    ) -> None:
        """Start all enabled services (or --only NAME for a single service)."""
        loop = asyncio.new_event_loop()
        shutdown_event = asyncio.Event()

        async def _run() -> None:
            await _startup(manager, settings, only, skip_preflight)

            def _handle_signal() -> None:
                typer.echo("\nReceived shutdown signal...")
                shutdown_event.set()

            loop.add_signal_handler(signal.SIGINT, _handle_signal)
            loop.add_signal_handler(signal.SIGTERM, _handle_signal)

            await shutdown_event.wait()
            await _shutdown(manager)

        try:
            loop.run_until_complete(_run())
        except SystemExit:
            raise
        except Exception:
            loop.run_until_complete(_shutdown(manager))
        finally:
            loop.close()
        typer.echo("All services stopped. Goodbye.")

    @app.command()
    def down() -> None:
        """Stop all running services."""
        asyncio.run(_shutdown(manager))
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

    @app.command()
    def version() -> None:
        """Print the niuu CLI version."""
        typer.echo(f"niuu {settings.version}")

    @app.command()
    def migrate(
        target: str = typer.Option("latest", help="Migration target version"),
    ) -> None:
        """Run database migrations."""
        from cli._commands.migrate import execute

        execute(target=target)

    @app.command()
    def serve(
        port: int = typer.Option(5174, help="Port (default: 5174)"),
    ) -> None:
        """Serve the Niuu web UI."""
        from cli._commands.serve import execute

        execute(port=port)

    return app
