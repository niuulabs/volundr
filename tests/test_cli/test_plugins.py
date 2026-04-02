"""Tests for volundr.plugin and tyr.plugin — service plugins."""

from __future__ import annotations

import typer
from typer.testing import CliRunner

from cli.registry import PluginRegistry
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

    def test_depends_on_empty(self) -> None:
        plugin = VolundrPlugin()
        assert list(plugin.depends_on()) == []

    def test_registers_commands(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        names = [c.name or c.callback.__name__ for c in app.registered_commands]
        assert "sessions" in names
        assert "chronicles" in names

    def test_sessions_command(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        result = runner.invoke(app, ["sessions"])
        assert result.exit_code == 0

    def test_chronicles_command(self) -> None:
        plugin = VolundrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        result = runner.invoke(app, ["chronicles"])
        assert result.exit_code == 0

    def test_default_service_is_none(self) -> None:
        plugin = VolundrPlugin()
        assert plugin.create_service() is None

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
        assert "saga" in plugin.description.lower() or "coordinator" in plugin.description.lower()

    def test_depends_on_volundr(self) -> None:
        plugin = TyrPlugin()
        assert "volundr" in plugin.depends_on()

    def test_registers_commands(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        names = [c.name or c.callback.__name__ for c in app.registered_commands]
        assert "sagas" in names
        assert "dispatch" in names

    def test_sagas_command(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        result = runner.invoke(app, ["sagas"])
        assert result.exit_code == 0

    def test_dispatch_command(self) -> None:
        plugin = TyrPlugin()
        app = typer.Typer()
        plugin.register_commands(app)
        result = runner.invoke(app, ["dispatch"])
        assert result.exit_code == 0

    def test_default_service_is_none(self) -> None:
        plugin = TyrPlugin()
        assert plugin.create_service() is None


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
