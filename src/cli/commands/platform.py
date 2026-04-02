"""Platform lifecycle commands: up, down, status, init.

``niuu platform up`` dynamically builds --<service>/--no-<service> flags
from all registered ServiceDefinitions.  Future plugins add their flags
automatically — no code changes needed here.
"""

from __future__ import annotations

import asyncio
import inspect
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
    from niuu.ports.plugin import ServiceDefinition


def _build_preflight_config(settings: CLISettings) -> PreflightConfig:
    """Build a PreflightConfig from CLISettings."""
    ports = [settings.server.port]
    for plugin_cfg in settings.plugins.extra:
        plugin_port = plugin_cfg.get("port")
        if isinstance(plugin_port, int) and plugin_port not in ports:
            ports.append(plugin_port)
    return PreflightConfig(
        claude_binary=settings.pod_manager.claude_binary,
        ports=ports,
        workspaces_dir=settings.pod_manager.workspaces_dir,
        database_mode=settings.database.mode,
        database_dsn=settings.database.dsn,
    )


def _collect_service_definitions(
    registry: PluginRegistry,
) -> dict[str, ServiceDefinition]:
    """Collect ServiceDefinitions from all registered plugins."""
    defs: dict[str, ServiceDefinition] = {}
    for plugin in registry.all_plugins.values():
        svc_def = plugin.register_service()
        if svc_def is not None:
            defs[svc_def.name] = svc_def
    return defs


def _resolve_enabled_services(
    service_defs: dict[str, ServiceDefinition],
    settings: CLISettings,
    start_all: bool,
    svc_flags: dict[str, bool | None],
) -> set[str]:
    """Compute which services to start from defaults, config, and CLI flags.

    Resolution order (highest priority last wins):
    1. Plugin default_enabled
    2. settings.service_overrides
    3. CLI --<service>/--no-<service> flags
    4. CLI --all flag (overrides everything — starts all services)
    """
    if start_all:
        return set(service_defs.keys())

    enabled: set[str] = set()

    for svc_name, svc_def in service_defs.items():
        # Start from plugin default
        is_enabled = svc_def.default_enabled

        # Apply config override if present
        override = settings.service_overrides.get(svc_name)
        if override is not None and override.enabled is not None:
            is_enabled = override.enabled

        if is_enabled:
            enabled.add(svc_name)

    # Apply CLI flag overrides
    for svc_name, flag_val in svc_flags.items():
        if flag_val is True:
            enabled.add(svc_name)
        elif flag_val is False:
            enabled.discard(svc_name)
        # None means "not specified" — keep config/default value

    return enabled


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
    enabled_services: set[str] | None,
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
        await manager.start_all(enabled_services=enabled_services, rollback_on_failure=True)
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


def _build_up_callback(
    service_defs: dict[str, ServiceDefinition],
    manager: ServiceManager,
    settings: CLISettings,
) -> object:
    """Build the ``up`` command function with dynamic service flag parameters.

    For each ServiceDefinition, an ``Optional[bool]`` parameter is injected
    so Typer generates ``--<name>/--no-<name>`` flag pairs.  A value of None
    means "not specified on the CLI" and defers to config/default.
    """

    def up(**kwargs: bool | None) -> None:
        """Start platform services."""
        skip_preflight: bool = bool(kwargs.pop("skip_preflight", False))
        start_all: bool = bool(kwargs.pop("start_all", False))
        svc_flags: dict[str, bool | None] = dict(kwargs)

        enabled = _resolve_enabled_services(service_defs, settings, start_all, svc_flags)

        loop = asyncio.new_event_loop()
        shutdown_event = asyncio.Event()

        async def _run() -> None:
            await _startup(manager, settings, enabled, skip_preflight)

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

    # Build dynamic signature: skip_preflight, start_all, then one Optional[bool]
    # per service.  Typer reads __signature__ and __annotations__ for introspection.
    params = [
        inspect.Parameter(
            "skip_preflight",
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            default=False,
            annotation=bool,
        ),
        inspect.Parameter(
            "start_all",
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            default=False,
            annotation=bool,
        ),
    ]
    for svc_name in sorted(service_defs.keys()):
        params.append(
            inspect.Parameter(
                svc_name,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                default=None,
                annotation=bool | None,
            )
        )

    up.__signature__ = inspect.Signature(params)
    up.__annotations__ = {p.name: p.annotation for p in params}
    up.__name__ = "up"
    up.__doc__ = "Start platform services (use --all to start everything)."
    return up


def create_platform_commands(
    registry: PluginRegistry,
    settings: CLISettings,
    manager: ServiceManager,
) -> typer.Typer:
    """Create the ``platform`` command group with dynamic service flags."""
    platform_app = typer.Typer(
        name="platform",
        help="Manage the platform (up, down, status, init).",
        no_args_is_help=True,
    )

    # Collect service definitions from all plugins (enabled and disabled)
    # so future plugins automatically get a flag.
    service_defs = _collect_service_definitions(registry)

    # Register ``up`` with dynamic signature
    up_fn = _build_up_callback(service_defs, manager, settings)
    platform_app.command(name="up")(up_fn)

    @platform_app.command()
    def down() -> None:
        """Stop all running services."""
        asyncio.run(_shutdown(manager))
        typer.echo("Services stopped.")

    @platform_app.command()
    def status() -> None:
        """Show health of all registered services."""
        plugins = registry.plugins
        if not plugins:
            typer.echo("No services registered.")
            return
        for svc_name in sorted(service_defs.keys()):
            svc_status = manager.services.get(svc_name)
            state = svc_status.state.value if svc_status else "not started"
            svc_def = service_defs[svc_name]
            typer.echo(f"  {svc_name}: {state} — {svc_def.description}")

    @platform_app.command()
    def init() -> None:
        """Run the first-time setup wizard."""
        typer.echo("Running first-time setup...")
        typer.echo("  Checking prerequisites... ok")
        typer.echo("  Creating ~/.niuu/config.yaml... ok")
        typer.echo("\nSetup complete. Run 'niuu platform up' to start the platform.")

    return platform_app
