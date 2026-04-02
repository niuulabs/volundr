"""Tests for cli.commands.platform — dynamic service flags and platform lifecycle."""

from __future__ import annotations

from unittest.mock import MagicMock

from typer.testing import CliRunner

from cli.commands.platform import (
    _build_up_callback,
    _collect_service_definitions,
    _resolve_enabled_services,
    create_platform_commands,
)
from cli.config import CLISettings, PerServiceConfig
from cli.registry import PluginRegistry
from cli.services.manager import ServiceManager
from niuu.ports.plugin import ServiceDefinition
from tests.test_cli.conftest import FakePlugin, StubService

runner = CliRunner()


def _make_svc_def(
    name: str,
    default_enabled: bool = True,
    depends_on: list[str] | None = None,
    port: int = 8080,
) -> ServiceDefinition:
    return ServiceDefinition(
        name=name,
        description=f"{name} service",
        factory=StubService,
        default_enabled=default_enabled,
        depends_on=depends_on or [],
        default_port=port,
    )


class _ServicePlugin(FakePlugin):
    """FakePlugin that also implements register_service().

    Passes ``depends_on`` from the ServiceDefinition to FakePlugin so that
    ``depends_on()`` (which FakePlugin overrides) stays in sync.
    """

    def __init__(self, svc_def: ServiceDefinition, **kwargs: object) -> None:
        super().__init__(
            name=svc_def.name,
            service=StubService(),
            deps=list(svc_def.depends_on),
            **kwargs,
        )
        self._svc_def = svc_def

    def register_service(self) -> ServiceDefinition:
        return self._svc_def


class TestCollectServiceDefinitions:
    def test_collects_from_plugins_with_register_service(self) -> None:
        registry = PluginRegistry()
        registry.register(_ServicePlugin(_make_svc_def("volundr")))
        registry.register(_ServicePlugin(_make_svc_def("tyr")))
        defs = _collect_service_definitions(registry)
        assert "volundr" in defs
        assert "tyr" in defs

    def test_skips_plugins_without_register_service(self) -> None:
        registry = PluginRegistry()
        registry.register(FakePlugin(name="query-only"))  # no register_service
        registry.register(_ServicePlugin(_make_svc_def("volundr")))
        defs = _collect_service_definitions(registry)
        assert "volundr" in defs
        assert "query-only" not in defs

    def test_includes_disabled_plugins(self) -> None:
        """Disabled plugins still contribute ServiceDefinitions (for flags)."""
        registry = PluginRegistry()
        registry.register(_ServicePlugin(_make_svc_def("skuld", default_enabled=False)))
        registry.disable("skuld")
        defs = _collect_service_definitions(registry)
        assert "skuld" in defs


class TestResolveEnabledServices:
    def test_default_enabled_only(self) -> None:
        service_defs = {
            "volundr": _make_svc_def("volundr", default_enabled=True),
            "tyr": _make_svc_def("tyr", default_enabled=True),
            "skuld": _make_svc_def("skuld", default_enabled=False),
        }
        enabled = _resolve_enabled_services(service_defs, CLISettings(), False, {})
        assert "volundr" in enabled
        assert "tyr" in enabled
        assert "skuld" not in enabled

    def test_cli_flag_adds_disabled_service(self) -> None:
        service_defs = {
            "skuld": _make_svc_def("skuld", default_enabled=False),
        }
        enabled = _resolve_enabled_services(service_defs, CLISettings(), False, {"skuld": True})
        assert "skuld" in enabled

    def test_cli_flag_removes_enabled_service(self) -> None:
        service_defs = {
            "tyr": _make_svc_def("tyr", default_enabled=True),
        }
        enabled = _resolve_enabled_services(service_defs, CLISettings(), False, {"tyr": False})
        assert "tyr" not in enabled

    def test_start_all_enables_everything(self) -> None:
        service_defs = {
            "volundr": _make_svc_def("volundr", default_enabled=True),
            "skuld": _make_svc_def("skuld", default_enabled=False),
        }
        enabled = _resolve_enabled_services(service_defs, CLISettings(), True, {})
        assert enabled == {"volundr", "skuld"}

    def test_config_override_enables(self) -> None:
        service_defs = {"skuld": _make_svc_def("skuld", default_enabled=False)}
        settings = CLISettings(service_overrides={"skuld": PerServiceConfig(enabled=True)})
        enabled = _resolve_enabled_services(service_defs, settings, False, {})
        assert "skuld" in enabled

    def test_config_override_disables(self) -> None:
        service_defs = {"tyr": _make_svc_def("tyr", default_enabled=True)}
        settings = CLISettings(service_overrides={"tyr": PerServiceConfig(enabled=False)})
        enabled = _resolve_enabled_services(service_defs, settings, False, {})
        assert "tyr" not in enabled

    def test_cli_flag_wins_over_config_override(self) -> None:
        """CLI flag has the highest priority."""
        service_defs = {"tyr": _make_svc_def("tyr", default_enabled=False)}
        settings = CLISettings(service_overrides={"tyr": PerServiceConfig(enabled=False)})
        enabled = _resolve_enabled_services(service_defs, settings, False, {"tyr": True})
        assert "tyr" in enabled

    def test_start_all_overrides_no_flags(self) -> None:
        """--all takes highest precedence even when --no-service is set."""
        service_defs = {"tyr": _make_svc_def("tyr", default_enabled=True)}
        enabled = _resolve_enabled_services(service_defs, CLISettings(), True, {"tyr": False})
        assert "tyr" in enabled


class TestDynamicUpCallback:
    def test_up_callback_has_service_flags(self) -> None:
        service_defs = {
            "volundr": _make_svc_def("volundr"),
            "tyr": _make_svc_def("tyr"),
        }
        manager = MagicMock()
        settings = CLISettings()
        up_fn = _build_up_callback(service_defs, manager, settings)

        import inspect

        sig = inspect.signature(up_fn)
        assert "volundr" in sig.parameters
        assert "tyr" in sig.parameters
        assert "skip_preflight" in sig.parameters
        assert "all" in sig.parameters

    def test_up_flag_defaults_are_none_for_services(self) -> None:
        service_defs = {"skuld": _make_svc_def("skuld", default_enabled=False)}
        manager = MagicMock()
        settings = CLISettings()
        up_fn = _build_up_callback(service_defs, manager, settings)

        import inspect

        sig = inspect.signature(up_fn)
        assert sig.parameters["skuld"].default is None

    def test_new_plugin_adds_flag_automatically(self) -> None:
        """Adding a new service definition adds its flag with no code change."""
        service_defs = {
            "odin": _make_svc_def("odin", default_enabled=False),
        }
        manager = MagicMock()
        settings = CLISettings()
        up_fn = _build_up_callback(service_defs, manager, settings)

        import inspect

        sig = inspect.signature(up_fn)
        assert "odin" in sig.parameters


class TestCreatePlatformCommands:
    def _make_platform(self, plugins: list | None = None) -> tuple:
        registry = PluginRegistry()
        for p in plugins or []:
            registry.register(p)
        settings = CLISettings()
        manager = ServiceManager(
            registry=registry,
            health_check_interval=0.01,
            health_check_timeout=0.5,
            health_check_max_retries=1,
        )
        platform = create_platform_commands(registry, settings, manager)
        return platform, registry, settings, manager

    def test_platform_has_up_down_status_init(self) -> None:
        platform, *_ = self._make_platform()
        names = [c.name or c.callback.__name__ for c in platform.registered_commands]
        assert "up" in names
        assert "down" in names
        assert "status" in names
        assert "init" in names

    def test_platform_down_command(self) -> None:
        platform, *_ = self._make_platform()
        result = runner.invoke(platform, ["down"])
        assert result.exit_code == 0
        assert "stopped" in result.output.lower()

    def test_platform_init_command(self) -> None:
        platform, *_ = self._make_platform()
        result = runner.invoke(platform, ["init"])
        assert result.exit_code == 0
        assert "setup" in result.output.lower()

    def test_platform_status_no_services(self) -> None:
        platform, *_ = self._make_platform()
        result = runner.invoke(platform, ["status"])
        assert result.exit_code == 0

    def test_platform_status_with_service_defs(self) -> None:
        plugin = _ServicePlugin(_make_svc_def("volundr"))
        platform, *_ = self._make_platform(plugins=[plugin])
        result = runner.invoke(platform, ["status"])
        assert result.exit_code == 0
        assert "volundr" in result.output

    def test_platform_up_with_service_flags_in_help(self) -> None:
        plugin = _ServicePlugin(_make_svc_def("volundr"))
        platform, *_ = self._make_platform(plugins=[plugin])
        result = runner.invoke(platform, ["up", "--help"])
        assert result.exit_code == 0
        assert "volundr" in result.output

    def test_platform_up_all_flag_in_help(self) -> None:
        platform, *_ = self._make_platform()
        result = runner.invoke(platform, ["up", "--help"])
        assert result.exit_code == 0
        # Must be --all, not --start-all
        assert "--all" in result.output
        assert "--start-all" not in result.output


class TestDependencyResolutionViaEnabledServices:
    async def test_tyr_dep_pulls_in_volundr(self) -> None:
        registry = PluginRegistry()
        registry.register(_ServicePlugin(_make_svc_def("volundr")))
        registry.register(_ServicePlugin(_make_svc_def("tyr", depends_on=["volundr"])))
        manager = ServiceManager(
            registry=registry,
            health_check_interval=0.01,
            health_check_timeout=0.5,
            health_check_max_retries=1,
        )
        order = manager.resolve_start_order(enabled_services={"tyr"})
        assert "volundr" in order
        assert "tyr" in order
        assert order.index("volundr") < order.index("tyr")
