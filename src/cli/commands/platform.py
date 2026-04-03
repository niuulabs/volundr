"""Platform lifecycle commands: up, down, status, init.

``niuu platform up`` dynamically builds --<service>/--no-<service> flags
from all registered ServiceDefinitions.  Future plugins add their flags
automatically — no code changes needed here.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import signal
from pathlib import Path
from typing import TYPE_CHECKING, Any

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

    kwargs = settings.pod_manager.adapter_kwargs()
    return PreflightConfig(
        claude_binary=kwargs.get("claude_binary", "claude"),
        ports=ports,
        workspaces_dir=kwargs.get("workspaces_dir", "~/.niuu/workspaces"),
        database_mode=settings.database.mode,
        database_dsn=settings.database.dsn,
        mode=settings.mode,
        kubeconfig=kwargs.get("kubeconfig", "~/.kube/config"),
        namespace=kwargs.get("namespace", "volundr"),
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
    """Run preflight checks, start infrastructure, then the root server."""
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

    # Start the unified root server (all plugin APIs + web UI on one port)
    from cli.server import RootServer

    host = settings.server.host
    port = settings.server.port

    # Expose server address so pod manager can construct chat_endpoint URLs
    os.environ["NIUU_SERVER_HOST"] = host
    os.environ["NIUU_SERVER_PORT"] = str(port)

    root_server = RootServer(
        registry=manager._registry,
        host=host,
        port=port,
    )
    manager._root_server = root_server  # type: ignore[attr-defined]

    typer.echo("  Starting API server...", nl=False)
    await root_server.start()

    # Wait for the server to become healthy
    for _ in range(15):
        if await root_server.health_check():
            break
        await asyncio.sleep(0.5)

    if await root_server.health_check():
        typer.echo(" ok")
    else:
        typer.echo(" FAILED")
        raise typer.Exit(1)

    typer.echo(f"\nReady! Platform running on http://{host}:{port}")
    typer.echo(f"  API:    http://{host}:{port}/api/v1/")
    typer.echo(f"  Web UI: http://{host}:{port}/")


async def _shutdown(manager: ServiceManager) -> None:
    """Stop all services gracefully."""
    typer.echo("Stopping services...")
    root_server = getattr(manager, "_root_server", None)
    if root_server:
        typer.echo("  Stopping API server...", nl=False)
        await root_server.stop()
        typer.echo(" done")
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
        import os

        # In mini mode, enable local mounts and mini_mode feature flag
        # so Volundr's Settings picks them up via env vars.
        if settings.mode == "mini":
            os.environ.setdefault("LOCAL_MOUNTS__ENABLED", "true")
            os.environ.setdefault("LOCAL_MOUNTS__MINI_MODE", "true")

        skip_preflight: bool = bool(kwargs.pop("skip_preflight", False))
        start_all: bool = bool(kwargs.pop("all", False))
        svc_flags: dict[str, bool | None] = dict(kwargs)

        enabled = _resolve_enabled_services(service_defs, settings, start_all, svc_flags)

        loop = asyncio.new_event_loop()
        shutdown_event = asyncio.Event()

        def _handle_signal(signum: int, frame: object) -> None:
            typer.echo("\nReceived shutdown signal...")
            loop.call_soon_threadsafe(shutdown_event.set)

        # Use OS-level signal handlers (not event-loop-level) so they
        # fire reliably even under `uv run` or other wrappers.
        prev_int = signal.signal(signal.SIGINT, _handle_signal)
        prev_term = signal.signal(signal.SIGTERM, _handle_signal)

        async def _run() -> None:
            await _startup(manager, settings, enabled, skip_preflight)
            await shutdown_event.wait()
            await _shutdown(manager)

        try:
            loop.run_until_complete(_run())
        except KeyboardInterrupt:
            typer.echo("\nReceived shutdown signal...")
            loop.run_until_complete(_shutdown(manager))
        except SystemExit:
            raise
        except Exception:
            loop.run_until_complete(_shutdown(manager))
        finally:
            signal.signal(signal.SIGINT, prev_int)
            signal.signal(signal.SIGTERM, prev_term)
            loop.close()
        typer.echo("All services stopped. Goodbye.")

    # Build dynamic signature: skip_preflight, all, then one bool | None per service.
    # Typer reads __signature__ and __annotations__ for introspection.
    # "all" is a valid inspect.Parameter name even though it shadows the builtin.
    params = [
        inspect.Parameter(
            "skip_preflight",
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            default=False,
            annotation=bool,
        ),
        inspect.Parameter(
            "all",
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


MINI_POD_MANAGER_ADAPTER = "volundr.adapters.outbound.local_process.LocalProcessPodManager"
CLUSTER_POD_MANAGER_ADAPTER = "volundr.adapters.outbound.direct_k8s_pod_manager.DirectK8sPodManager"

CLUSTER_POD_MANAGER_DEFAULTS: dict[str, Any] = {
    "adapter": CLUSTER_POD_MANAGER_ADAPTER,
    "namespace": "volundr",
    "kubeconfig": "~/.kube/config",
    "skuld_image": "ghcr.io/niuulabs/skuld:0.2.0",
    "db_host": "host.k3d.internal",
    "ingress_class": "traefik",
}

MINI_POD_MANAGER_DEFAULTS: dict[str, Any] = {
    "adapter": MINI_POD_MANAGER_ADAPTER,
    "workspaces_dir": "~/.niuu/workspaces",
    "claude_binary": "claude",
}


def _prompt_mode_selection() -> str:
    """Prompt the user for mini or cluster mode."""
    typer.echo("Select operating mode:")
    typer.echo("  [1] mini   — local processes, no cluster needed (default)")
    typer.echo("  [2] cluster — session pods run in k3d/k3s cluster")
    choice = typer.prompt("Choice", default="1", show_default=False)
    if choice.strip() in ("2", "cluster"):
        return "cluster"
    return "mini"


def _build_init_config(mode: str) -> dict[str, Any]:
    """Build the initial config dict for the selected mode."""
    if mode == "cluster":
        return {
            "mode": "cluster",
            "pod_manager": dict(CLUSTER_POD_MANAGER_DEFAULTS),
        }
    return {
        "mode": "mini",
        "pod_manager": dict(MINI_POD_MANAGER_DEFAULTS),
    }


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
        typer.echo(f"Mode: {settings.mode}")
        typer.echo(f"Pod manager: {settings.pod_manager.adapter.rsplit('.', 1)[-1]}")
        typer.echo()

        if settings.mode == "cluster":
            kwargs = settings.pod_manager.adapter_kwargs()
            typer.echo("Cluster info:")
            typer.echo(f"  Namespace: {kwargs.get('namespace', 'volundr')}")
            typer.echo(f"  Kubeconfig: {kwargs.get('kubeconfig', '~/.kube/config')}")
            typer.echo()

        plugins = registry.plugins
        if not plugins:
            typer.echo("No services registered.")
            return
        typer.echo("Services:")
        for svc_name in sorted(service_defs.keys()):
            svc_status = manager.services.get(svc_name)
            state = svc_status.state.value if svc_status else "not started"
            svc_def = service_defs[svc_name]
            typer.echo(f"  {svc_name}: {state} — {svc_def.description}")

    @platform_app.command()
    def init() -> None:
        """Run the first-time setup wizard."""
        typer.echo("Running first-time setup...\n")

        config_dir = Path.home() / ".niuu"
        config_dir.mkdir(parents=True, exist_ok=True)
        config_path = config_dir / "config.yaml"

        if config_path.exists():
            overwrite = typer.confirm(
                f"Config already exists at {config_path}. Overwrite?",
                default=False,
            )
            if not overwrite:
                typer.echo("Aborted — existing config preserved.")
                raise typer.Exit(0)

        mode = _prompt_mode_selection()
        config_data = _build_init_config(mode)

        import yaml

        config_path.write_text(yaml.safe_dump(config_data, default_flow_style=False))
        typer.echo(f"\n  Config written to {config_path}")
        typer.echo(f"\nSetup complete ({mode} mode). Run 'niuu platform up' to start.")

    @platform_app.command(hidden=True)
    def skuld() -> None:
        """Run a Skuld broker instance (internal, one per session)."""
        from skuld.broker import main as skuld_main

        skuld_main()

    return platform_app
