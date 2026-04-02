"""Tests for the Niuu CLI entry point (Typer-based)."""

from __future__ import annotations

from unittest.mock import patch

from typer.testing import CliRunner

from cli.app import build_app
from cli.config import CLISettings
from cli.registry import PluginRegistry

runner = CliRunner()


def _app() -> build_app:
    """Build a test app with no plugin discovery."""
    return build_app(settings=CLISettings(), registry=PluginRegistry())


class TestCLIEntryPoint:
    """Tests for the Typer app produced by build_app."""

    def test_version_flag(self) -> None:
        result = runner.invoke(_app(), ["--version"])
        assert result.exit_code == 0
        assert "niuu" in result.output

    def test_all_commands_registered(self) -> None:
        result = runner.invoke(_app(), ["--help"])
        assert result.exit_code == 0
        for cmd in ("up", "down", "status", "config", "version", "migrate", "serve"):
            assert cmd in result.output

    def test_up_command(self) -> None:
        result = runner.invoke(_app(), ["up"])
        assert result.exit_code == 0

    def test_down_command(self) -> None:
        result = runner.invoke(_app(), ["down"])
        assert result.exit_code == 0

    def test_status_command(self) -> None:
        result = runner.invoke(_app(), ["status"])
        assert result.exit_code == 0

    def test_serve_dispatches(self) -> None:
        with patch("cli._commands.serve.execute", return_value=0) as mock_exec:
            result = runner.invoke(_app(), ["serve"])
        assert result.exit_code == 0
        mock_exec.assert_called_once()

    def test_migrate_dispatches(self) -> None:
        with patch("cli._commands.migrate.execute", return_value=0) as mock_exec:
            result = runner.invoke(_app(), ["migrate"])
        assert result.exit_code == 0
        mock_exec.assert_called_once()

    def test_migrate_accepts_target(self) -> None:
        with patch("cli._commands.migrate.execute", return_value=0) as mock_exec:
            result = runner.invoke(_app(), ["migrate", "--target", "000005"])
        assert result.exit_code == 0
        mock_exec.assert_called_once_with(target="000005")

    def test_serve_accepts_port(self) -> None:
        with patch("cli._commands.serve.execute", return_value=0) as mock_exec:
            result = runner.invoke(_app(), ["serve", "--port", "8080"])
        assert result.exit_code == 0
        mock_exec.assert_called_once_with(port=8080)

    def test_unknown_command_fails(self) -> None:
        result = runner.invoke(_app(), ["nonexistent"])
        assert result.exit_code != 0
