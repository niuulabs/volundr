"""Tests for volundr.plugin, tyr.plugin, and the plugin registry."""

from __future__ import annotations

import typer
from typer.testing import CliRunner

from cli.registry import PluginRegistry
from niuu.ports.plugin import ServiceDefinition
from tyr.plugin import TyrPlugin
from volundr.plugin import VolundrPlugin

runner = CliRunner()


class TestVolundrPlugin:
    def test_name(self) -> None:
        plugin = VolundrPlugin()
        assert plugin.name == "volundr"

    def test_description(self) -> None:
        plugin = VolundrPlugin()
        desc = plugin.description.lower()
        assert "session" in desc or "development" in desc

    def test_register_service_returns_definition(self) -> None:
        plugin = VolundrPlugin()
        svc_def = plugin.register_service()
        assert isinstance(svc_def, ServiceDefinition)
        assert svc_def.name == "volundr"
        assert svc_def.default_enabled is True

    def test_register_service_default_port(self) -> None:
        plugin = VolundrPlugin()
        svc_def = plugin.register_service()
        assert svc_def is not None
        assert svc_def.default_port > 0

    def test_register_service_factory_creates_service(self) -> None:
        plugin = VolundrPlugin()
        svc_def = plugin.register_service()
        assert svc_def is not None
        svc = svc_def.factory()
        assert svc is not None

    def test_depends_on_via_service_definition(self) -> None:
        plugin = VolundrPlugin()
        # depends_on() delegates to register_service().depends_on
        svc_def = plugin.register_service()
        assert svc_def is not None
        assert list(plugin.depends_on()) == svc_def.depends_on

    def test_create_service_returns_service(self) -> None:
        plugin = VolundrPlugin()
        svc = plugin.create_service()
        assert svc is not None

    def test_registers_sessions_group(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        # sessions should be registered as a sub-group
        group_names = [g.name for g in app.registered_groups]
        assert "sessions" in group_names

    def test_sessions_list_command(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer(no_args_is_help=False)
        plugin.register_commands(app)
        result = runner.invoke(app, ["sessions", "list"])
        assert result.exit_code == 0

    def test_sessions_create_command(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer(no_args_is_help=False)
        plugin.register_commands(app)
        result = runner.invoke(app, ["sessions", "create", "my-session"])
        assert result.exit_code == 0

    def test_default_api_client_is_none(self) -> None:
        plugin = VolundrPlugin()
        assert plugin.create_api_client() is None

    def test_default_tui_pages_empty(self) -> None:
        plugin = VolundrPlugin()
        assert plugin.tui_pages() == []


class TestTyrPlugin:
    def test_name(self) -> None:
        plugin = TyrPlugin()
        assert plugin.name == "tyr"

    def test_description(self) -> None:
        plugin = TyrPlugin()
        desc = plugin.description.lower()
        assert "saga" in desc or "coordinator" in desc

    def test_register_service_returns_definition(self) -> None:
        plugin = TyrPlugin()
        svc_def = plugin.register_service()
        assert isinstance(svc_def, ServiceDefinition)
        assert svc_def.name == "tyr"
        assert svc_def.default_enabled is True

    def test_register_service_depends_on_volundr(self) -> None:
        plugin = TyrPlugin()
        svc_def = plugin.register_service()
        assert svc_def is not None
        assert "volundr" in svc_def.depends_on

    def test_depends_on_volundr_via_service_definition(self) -> None:
        plugin = TyrPlugin()
        assert "volundr" in plugin.depends_on()

    def test_create_service_returns_service(self) -> None:
        plugin = TyrPlugin()
        svc = plugin.create_service()
        assert svc is not None

    def test_registers_sagas_group(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        group_names = [g.name for g in app.registered_groups]
        assert "sagas" in group_names

    def test_registers_raids_group(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        group_names = [g.name for g in app.registered_groups]
        assert "raids" in group_names

    def test_sagas_list_command(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer(no_args_is_help=False)
        plugin.register_commands(app)
        result = runner.invoke(app, ["sagas", "list"])
        assert result.exit_code == 0

    def test_raids_active_command(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer(no_args_is_help=False)
        plugin.register_commands(app)
        result = runner.invoke(app, ["raids", "active"])
        assert result.exit_code == 0


class TestPluginDiscovery:
    def test_both_plugins_register(self) -> None:
        registry = PluginRegistry()
        registry.register(VolundrPlugin())
        registry.register(TyrPlugin())
        assert "volundr" in registry.plugins
        assert "tyr" in registry.plugins

    def test_dependency_order(self) -> None:
        """Tyr depends on volundr — verify start order."""
        from cli.services.manager import ServiceManager

        registry = PluginRegistry()
        registry.register(VolundrPlugin())
        registry.register(TyrPlugin())
        manager = ServiceManager(registry=registry)
        order = manager.resolve_start_order()
        assert order.index("volundr") < order.index("tyr")

    def test_plugin_without_register_service_works(self) -> None:
        """A plugin that does not implement register_service() still works."""
        from tests.test_cli.conftest import FakePlugin

        plugin = FakePlugin(name="query-only")
        assert plugin.register_service() is None
        assert list(plugin.depends_on()) == []
