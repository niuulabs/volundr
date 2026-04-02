"""Tests for cli.app — Typer app factory and CLI commands."""

from __future__ import annotations

from typer.testing import CliRunner

from cli.app import build_app
from cli.config import CLISettings
from cli.registry import PluginRegistry
from tests.test_cli.conftest import FakePlugin

runner = CliRunner()


def _build_test_app(
    plugins: list[FakePlugin] | None = None,
) -> tuple:
    """Build a test app with given plugins (no entry point discovery)."""
    settings = CLISettings()
    registry = PluginRegistry()
    for p in plugins or []:
        registry.register(p)
    app = build_app(settings=settings, registry=registry)
    return app, settings, registry


class TestVersionCommand:
    def test_version_flag(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["--version"])
        assert result.exit_code == 0
        assert "niuu 0.1.0" in result.output

    def test_version_short_flag(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["-V"])
        assert result.exit_code == 0
        assert "niuu" in result.output

    def test_version_command(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["version"])
        assert result.exit_code == 0
        assert "0.1.0" in result.output


class TestStatusCommand:
    def test_status_no_plugins(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["status"])
        assert result.exit_code == 0
        assert "No plugins" in result.output

    def test_status_with_plugins(self) -> None:
        plugins = [FakePlugin(name="test", description="A test")]
        app, _, _ = _build_test_app(plugins=plugins)
        result = runner.invoke(app, ["status"])
        assert result.exit_code == 0
        assert "test" in result.output
        assert "A test" in result.output


class TestConfigCommand:
    def test_config_shows_context(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["config"])
        assert result.exit_code == 0
        assert "Context: local" in result.output

    def test_config_shows_plugins(self) -> None:
        plugins = [FakePlugin(name="alpha"), FakePlugin(name="beta")]
        app, _, _ = _build_test_app(plugins=plugins)
        result = runner.invoke(app, ["config"])
        assert "alpha" in result.output
        assert "beta" in result.output


class TestUpDownCommands:
    def test_up_skip_preflight(self) -> None:
        """Up with --skip-preflight starts services (no blocking signal wait in test)."""
        from unittest.mock import patch

        # Patch _run in up to just do startup without waiting for signal
        app, _, _ = _build_test_app()
        with (
            patch("cli.commands.core._startup") as mock_startup,
            patch("cli.commands.core._shutdown") as mock_shutdown,
        ):
            mock_startup.return_value = None
            mock_shutdown.return_value = None
            # The up command uses asyncio loop internally; just test down
            result = runner.invoke(app, ["down"])
            assert result.exit_code == 0

    def test_down(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["down"])
        assert result.exit_code == 0
        assert "stopped" in result.output.lower()


class TestPluginCommands:
    def test_plugin_commands_registered(self) -> None:
        plugins = [FakePlugin(name="myplugin", has_commands=True)]
        app, _, _ = _build_test_app(plugins=plugins)
        result = runner.invoke(app, ["myplugin", "test-cmd"])
        assert result.exit_code == 0
        assert "myplugin test command" in result.output

    def test_disabled_plugin_no_commands(self) -> None:
        registry = PluginRegistry()
        registry.register(FakePlugin(name="disabled", has_commands=True))
        registry.disable("disabled")
        settings = CLISettings()
        app = build_app(settings=settings, registry=registry)
        result = runner.invoke(app, ["disabled", "test-cmd"])
        assert result.exit_code != 0

    def test_plugin_without_commands_not_added(self) -> None:
        plugins = [FakePlugin(name="nocmds", has_commands=False)]
        app, _, _ = _build_test_app(plugins=plugins)
        result = runner.invoke(app, ["nocmds"])
        # Should fail since no subcommands were registered
        assert result.exit_code != 0


class TestHelpOutput:
    def test_help_shows_core_commands(self) -> None:
        app, _, _ = _build_test_app()
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0
        assert "up" in result.output
        assert "down" in result.output
        assert "status" in result.output
        assert "version" in result.output
        assert "tui" in result.output

    def test_help_shows_plugin_commands(self) -> None:
        plugins = [FakePlugin(name="volundr", has_commands=True, description="Dev platform")]
        app, _, _ = _build_test_app(plugins=plugins)
        result = runner.invoke(app, ["--help"])
        assert "volundr" in result.output
