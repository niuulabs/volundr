"""Tests for cli.commands.core — up, down, status, config commands."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import click.exceptions
import pytest

from cli.commands.core import _build_preflight_config, _print_status, _shutdown, _startup
from cli.config import CLISettings
from cli.services.manager import ServiceState, StartupError


class TestPrintStatus:
    def test_starting_prints_no_newline(self, capsys: pytest.CaptureFixture[str]) -> None:
        _print_status("volundr", ServiceState.STARTING)
        captured = capsys.readouterr()
        assert "Starting volundr" in captured.out

    def test_healthy_prints_ok(self, capsys: pytest.CaptureFixture[str]) -> None:
        _print_status("volundr", ServiceState.HEALTHY)
        captured = capsys.readouterr()
        assert "ok" in captured.out

    def test_unhealthy_prints_failed(self, capsys: pytest.CaptureFixture[str]) -> None:
        _print_status("volundr", ServiceState.UNHEALTHY)
        captured = capsys.readouterr()
        assert "FAILED" in captured.out

    def test_stopping_prints_name(self, capsys: pytest.CaptureFixture[str]) -> None:
        _print_status("tyr", ServiceState.STOPPING)
        captured = capsys.readouterr()
        assert "Stopping tyr" in captured.out

    def test_stopped_prints_done(self, capsys: pytest.CaptureFixture[str]) -> None:
        _print_status("tyr", ServiceState.STOPPED)
        captured = capsys.readouterr()
        assert "done" in captured.out


class TestBuildPreflightConfig:
    def test_builds_from_settings(self) -> None:
        settings = CLISettings()
        config = _build_preflight_config(settings)
        assert config.claude_binary == "claude"
        assert config.ports == [8080]
        assert config.workspaces_dir == "~/.niuu/workspaces"
        assert config.database_mode == "embedded"

    def test_collects_plugin_ports(self) -> None:
        settings = CLISettings(
            plugins={
                "enabled": {},
                "extra": [
                    {"adapter": "some.Plugin", "port": 8081},
                    {"adapter": "other.Plugin", "port": 9100},
                ],
            },
        )
        config = _build_preflight_config(settings)
        assert 8080 in config.ports
        assert 8081 in config.ports
        assert 9100 in config.ports

    def test_deduplicates_server_port_in_plugins(self) -> None:
        settings = CLISettings(
            plugins={
                "enabled": {},
                "extra": [
                    {"adapter": "some.Plugin", "port": 8080},
                ],
            },
        )
        config = _build_preflight_config(settings)
        assert config.ports == [8080]

    def test_ignores_non_int_ports(self) -> None:
        settings = CLISettings(
            plugins={
                "enabled": {},
                "extra": [
                    {"adapter": "some.Plugin", "port": "not-a-port"},
                    {"adapter": "other.Plugin"},
                ],
            },
        )
        config = _build_preflight_config(settings)
        assert config.ports == [8080]


class TestStartup:
    async def test_startup_with_preflight_pass(self) -> None:
        manager = MagicMock()
        manager.start_all = AsyncMock()
        settings = CLISettings()

        passing_results = [MagicMock(passed=True, warn_only=False, name="test", message="ok")]
        with (
            patch(
                "cli.commands.core.run_preflight_checks",
                return_value=passing_results,
            ),
            patch("cli.commands.core.has_failures", return_value=False),
            patch("cli.commands.core.format_results", return_value="all ok"),
        ):
            await _startup(manager, settings, only=None, skip_preflight=False)
        manager.start_all.assert_awaited_once()

    async def test_startup_with_preflight_fail(self) -> None:
        manager = MagicMock()
        manager.start_all = AsyncMock()
        settings = CLISettings()

        failing_results = [MagicMock(passed=False, warn_only=False, name="test", message="bad")]
        with (
            patch(
                "cli.commands.core.run_preflight_checks",
                return_value=failing_results,
            ),
            patch("cli.commands.core.has_failures", return_value=True),
            patch("cli.commands.core.format_results", return_value="FAIL"),
            pytest.raises(click.exceptions.Exit),
        ):
            await _startup(manager, settings, only=None, skip_preflight=False)
        manager.start_all.assert_not_awaited()

    async def test_startup_skip_preflight(self) -> None:
        manager = MagicMock()
        manager.start_all = AsyncMock()
        settings = CLISettings()

        with patch("cli.commands.core.run_preflight_checks") as mock_preflight:
            await _startup(manager, settings, only=None, skip_preflight=True)
        mock_preflight.assert_not_called()
        manager.start_all.assert_awaited_once()

    async def test_startup_service_failure(self) -> None:
        manager = MagicMock()
        manager.start_all = AsyncMock(side_effect=StartupError("tyr", "health check failed"))
        settings = CLISettings()

        with pytest.raises(click.exceptions.Exit):
            await _startup(manager, settings, only=None, skip_preflight=True)

    async def test_startup_only_parameter(self) -> None:
        manager = MagicMock()
        manager.start_all = AsyncMock()
        settings = CLISettings()

        await _startup(manager, settings, only="volundr", skip_preflight=True)
        manager.start_all.assert_awaited_once_with(only="volundr", rollback_on_failure=True)


class TestShutdown:
    async def test_shutdown_calls_stop_all(self) -> None:
        manager = MagicMock()
        manager.stop_all = AsyncMock()
        await _shutdown(manager)
        manager.stop_all.assert_awaited_once()
