"""Extended tests for cli.app — global flags, login flow, whoami, and _SortedGroup."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import click
import pytest
import typer
from typer.testing import CliRunner

from cli.app import _SortedGroup, build_app
from cli.config import CLISettings
from cli.registry import PluginRegistry

runner = CliRunner()


@pytest.fixture(autouse=True)
def _set_credential_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NIUU_CREDENTIAL_KEY", "test-secret-key-for-ci")


def _build_test_app() -> typer.Typer:
    return build_app(settings=CLISettings(), registry=PluginRegistry())


class TestSortedGroup:
    """Tests for _SortedGroup which sorts command names alphabetically."""

    def test_list_commands_returns_sorted(self) -> None:
        group = _SortedGroup(name="test")
        # Add commands in reverse alphabetical order
        cmd_z = click.Command("zebra", callback=lambda: None)
        cmd_a = click.Command("alpha", callback=lambda: None)
        cmd_m = click.Command("middle", callback=lambda: None)
        group.add_command(cmd_z)
        group.add_command(cmd_a)
        group.add_command(cmd_m)

        ctx = click.Context(group)
        result = group.list_commands(ctx)
        assert result == ["alpha", "middle", "zebra"]


class TestGlobalFlags:
    """Tests for --home and --config callback behavior."""

    def test_home_flag_sets_env(self, tmp_path: Path) -> None:
        saved_home = os.environ.pop("NIUU_HOME", None)
        saved_config = os.environ.pop("NIUU_CONFIG", None)
        try:
            app = _build_test_app()
            result = runner.invoke(app, ["--home", str(tmp_path), "version"])
            assert result.exit_code == 0
            assert os.environ.get("NIUU_HOME") == str(tmp_path)
            expected_config = str(tmp_path / "config.yaml")
            assert os.environ.get("NIUU_CONFIG") == expected_config
        finally:
            os.environ.pop("NIUU_HOME", None)
            os.environ.pop("NIUU_CONFIG", None)
            if saved_home is not None:
                os.environ["NIUU_HOME"] = saved_home
            if saved_config is not None:
                os.environ["NIUU_CONFIG"] = saved_config

    def test_config_flag_sets_env(self, tmp_path: Path) -> None:
        saved_config = os.environ.pop("NIUU_CONFIG", None)
        try:
            config_path = str(tmp_path / "my-config.yaml")
            app = _build_test_app()
            result = runner.invoke(app, ["--config", config_path, "version"])
            assert result.exit_code == 0
            assert os.environ.get("NIUU_CONFIG") == config_path
        finally:
            os.environ.pop("NIUU_CONFIG", None)
            if saved_config is not None:
                os.environ["NIUU_CONFIG"] = saved_config


class TestLoginCommand:
    """Tests for the login command — these exercise the code path but rely
    on mocking at the correct import boundary."""

    def test_login_requires_issuer(self) -> None:
        """login without --issuer should fail."""
        app = _build_test_app()
        result = runner.invoke(app, ["login"])
        assert result.exit_code == 1
        assert "issuer" in result.output.lower()


class TestWhoamiCommand:
    """Tests for the whoami command."""

    def test_whoami_authenticated(self, tmp_path: Path) -> None:
        app = _build_test_app()

        claims = {
            "sub": "user-123",
            "name": "Test User",
            "email": "test@example.com",
        }

        with patch("cli.auth.oidc.OIDCClient") as mock_oidc_cls:
            mock_client = MagicMock()
            mock_client.whoami.return_value = claims
            mock_oidc_cls.return_value = mock_client

            result = runner.invoke(app, ["whoami"])

        assert result.exit_code == 0
        assert "Test User" in result.output
        assert "test@example.com" in result.output
        assert "user-123" in result.output

    def test_whoami_authenticated_no_email(self) -> None:
        app = _build_test_app()

        claims = {
            "sub": "user-123",
            "preferred_username": "testuser",
        }

        with patch("cli.auth.oidc.OIDCClient") as mock_oidc_cls:
            mock_client = MagicMock()
            mock_client.whoami.return_value = claims
            mock_oidc_cls.return_value = mock_client

            result = runner.invoke(app, ["whoami"])

        assert result.exit_code == 0
        assert "testuser" in result.output
        # No email line should appear
        assert "Email:" not in result.output


class TestTuiCommand:
    """Tests for the tui command."""

    def test_tui_command_exists(self) -> None:
        app = _build_test_app()
        result = runner.invoke(app, ["tui", "--help"])
        assert result.exit_code == 0
        assert "tui" in result.output.lower()
