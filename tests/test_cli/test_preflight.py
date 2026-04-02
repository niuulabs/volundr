"""Tests for cli.services.preflight — preflight checks."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from cli.services.preflight import (
    PreflightConfig,
    PreflightResult,
    check_api_key,
    check_claude_binary,
    check_database,
    check_disk_space,
    check_git,
    check_port_available,
    check_ports,
    check_workspace_dir,
    format_results,
    has_failures,
    run_preflight_checks,
)


@pytest.fixture
def default_config() -> PreflightConfig:
    return PreflightConfig()


class TestCheckClaudeBinary:
    def test_found_in_path(self, default_config: PreflightConfig) -> None:
        with patch("cli.services.preflight.shutil.which", return_value="/usr/bin/claude"):
            result = check_claude_binary(default_config)
        assert result.passed is True
        assert "/usr/bin/claude" in result.message

    def test_not_found(self, default_config: PreflightConfig) -> None:
        with patch("cli.services.preflight.shutil.which", return_value=None):
            result = check_claude_binary(default_config)
        assert result.passed is False
        assert "not found" in result.message

    def test_custom_binary_name(self) -> None:
        config = PreflightConfig(claude_binary="/opt/claude-custom")
        with patch("cli.services.preflight.shutil.which", return_value=None):
            result = check_claude_binary(config)
        assert result.passed is False
        assert "/opt/claude-custom" in result.message


class TestCheckApiKey:
    def test_key_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-validkey12345")
        result = check_api_key(PreflightConfig())
        assert result.passed is True

    def test_key_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        result = check_api_key(PreflightConfig())
        assert result.passed is False
        assert "not set" in result.message

    def test_key_too_short(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "short")
        result = check_api_key(PreflightConfig())
        assert result.passed is False
        assert "invalid" in result.message

    def test_custom_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CUSTOM_KEY", "sk-ant-api03-validkey12345")
        config = PreflightConfig(api_key_env="CUSTOM_KEY")
        result = check_api_key(config)
        assert result.passed is True


class TestCheckPortAvailable:
    def test_port_available(self) -> None:
        with patch("cli.services.preflight.socket.socket") as mock_sock:
            mock_instance = mock_sock.return_value.__enter__.return_value
            mock_instance.connect_ex.return_value = 1  # Connection refused = port free
            result = check_port_available(8080)
        assert result.passed is True
        assert "8080" in result.name

    def test_port_in_use(self) -> None:
        with patch("cli.services.preflight.socket.socket") as mock_sock:
            mock_instance = mock_sock.return_value.__enter__.return_value
            mock_instance.connect_ex.return_value = 0  # Connection success = port in use
            result = check_port_available(8080)
        assert result.passed is False
        assert "already in use" in result.message

    def test_socket_error_treated_as_available(self) -> None:
        with patch("cli.services.preflight.socket.socket") as mock_sock:
            mock_sock.return_value.__enter__.side_effect = OSError("network error")
            result = check_port_available(9100)
        assert result.passed is True

    def test_check_ports_multiple(self) -> None:
        config = PreflightConfig(ports=[8080, 8081])
        with patch("cli.services.preflight.socket.socket") as mock_sock:
            mock_instance = mock_sock.return_value.__enter__.return_value
            mock_instance.connect_ex.return_value = 1
            results = check_ports(config)
        assert len(results) == 2
        assert all(r.passed for r in results)


class TestCheckWorkspaceDir:
    def test_dir_exists_writable(self, tmp_path: Path) -> None:
        config = PreflightConfig(workspaces_dir=str(tmp_path))
        result = check_workspace_dir(config)
        assert result.passed is True

    def test_dir_created(self, tmp_path: Path) -> None:
        ws = tmp_path / "new_workspaces"
        config = PreflightConfig(workspaces_dir=str(ws))
        result = check_workspace_dir(config)
        assert result.passed is True
        assert ws.exists()

    def test_dir_not_writable(self, tmp_path: Path) -> None:
        config = PreflightConfig(workspaces_dir="/root/impossible_path_for_test")
        with patch("cli.services.preflight.Path.mkdir", side_effect=OSError("permission denied")):
            result = check_workspace_dir(config)
        assert result.passed is False
        assert "Cannot create" in result.message


class TestCheckDatabase:
    def test_embedded_with_pgserver(self) -> None:
        config = PreflightConfig(database_mode="embedded")
        with patch.dict("sys.modules", {"pgserver": type("module", (), {})}):
            result = check_database(config)
        assert result.passed is True
        assert "pgserver" in result.message

    def test_embedded_without_pgserver(self) -> None:
        config = PreflightConfig(database_mode="embedded")
        with patch("builtins.__import__", side_effect=ImportError("no pgserver")):
            result = check_database(config)
        assert result.passed is False
        assert "pgserver" in result.message

    def test_external_with_dsn(self) -> None:
        config = PreflightConfig(
            database_mode="external",
            database_dsn="postgresql://localhost:5432/niuu",
        )
        result = check_database(config)
        assert result.passed is True

    def test_external_without_dsn(self) -> None:
        config = PreflightConfig(database_mode="external", database_dsn="")
        result = check_database(config)
        assert result.passed is False
        assert "database_dsn" in result.message


class TestCheckGit:
    def test_git_and_gh_found(self) -> None:
        with patch("cli.services.preflight.shutil.which", side_effect=lambda x: f"/usr/bin/{x}"):
            result = check_git(PreflightConfig())
        assert result.passed is True
        assert "git and gh" in result.message

    def test_git_found_no_gh(self) -> None:
        def which_side_effect(binary: str) -> str | None:
            if binary == "git":
                return "/usr/bin/git"
            return None

        with patch("cli.services.preflight.shutil.which", side_effect=which_side_effect):
            result = check_git(PreflightConfig())
        assert result.passed is True
        assert result.warn_only is True
        assert "gh" in result.message

    def test_git_not_found(self) -> None:
        with patch("cli.services.preflight.shutil.which", return_value=None):
            result = check_git(PreflightConfig())
        assert result.passed is False
        assert "not installed" in result.message


class TestCheckDiskSpace:
    def test_sufficient_space(self, tmp_path: Path) -> None:
        config = PreflightConfig(workspaces_dir=str(tmp_path))
        # Real disk usually has > 1GB
        result = check_disk_space(config)
        assert result.passed is True

    def test_low_space_warning(self, tmp_path: Path) -> None:
        config = PreflightConfig(workspaces_dir=str(tmp_path))
        with patch(
            "cli.services.preflight.shutil.disk_usage",
            return_value=type(
                "Usage", (), {"free": 500_000_000, "total": 1_000_000_000, "used": 500_000_000}
            )(),
        ):
            result = check_disk_space(config)
        assert result.passed is True
        assert result.warn_only is True
        assert "Low disk space" in result.message

    def test_disk_usage_error(self, tmp_path: Path) -> None:
        config = PreflightConfig(workspaces_dir=str(tmp_path))
        with patch("cli.services.preflight.shutil.disk_usage", side_effect=OSError("no fs")):
            result = check_disk_space(config)
        assert result.passed is True
        assert result.warn_only is True


class TestRunPreflightChecks:
    def test_all_checks_run(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-validkey12345")
        config = PreflightConfig(
            workspaces_dir=str(tmp_path),
            ports=[8080],
        )
        with (
            patch("cli.services.preflight.shutil.which", return_value="/usr/bin/claude"),
            patch("cli.services.preflight.socket.socket") as mock_sock,
        ):
            mock_instance = mock_sock.return_value.__enter__.return_value
            mock_instance.connect_ex.return_value = 1
            results = run_preflight_checks(config)

        # Should have: claude, api_key, 1 port, workspace, database, git, disk
        assert len(results) >= 7

    def test_has_failures_with_failing_check(self) -> None:
        results = [
            PreflightResult(name="ok", passed=True, message="ok"),
            PreflightResult(name="fail", passed=False, message="bad"),
        ]
        assert has_failures(results) is True

    def test_has_failures_all_passing(self) -> None:
        results = [
            PreflightResult(name="ok", passed=True, message="ok"),
            PreflightResult(name="warn", passed=True, warn_only=True, message="warn"),
        ]
        assert has_failures(results) is False

    def test_has_failures_warn_only_not_counted(self) -> None:
        results = [
            PreflightResult(name="warn", passed=False, warn_only=True, message="warn"),
        ]
        assert has_failures(results) is False

    def test_format_results(self) -> None:
        results = [
            PreflightResult(name="test1", passed=True, message="all good"),
            PreflightResult(name="test2", passed=False, message="broken"),
            PreflightResult(name="test3", passed=True, warn_only=True, message="meh"),
        ]
        output = format_results(results)
        assert "[ OK ]" in output
        assert "[FAIL]" in output
        assert "[WARN]" in output
        assert "test1" in output
        assert "test2" in output
        assert "test3" in output
