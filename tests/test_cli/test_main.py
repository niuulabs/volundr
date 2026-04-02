"""Tests for the Niuu CLI entry point."""

from __future__ import annotations

import io
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

import pytest

from cli.main import build_parser, main


class TestBuildParser:
    """Tests for argument parser construction."""

    def test_parser_has_version_flag(self):
        parser = build_parser()
        # --version triggers SystemExit(0) with version string
        with pytest.raises(SystemExit) as exc_info:
            parser.parse_args(["--version"])
        assert exc_info.value.code == 0

    def test_parser_has_subcommands(self):
        parser = build_parser()
        # Parser should parse known subcommands without error
        args = parser.parse_args(["up"])
        assert args.command == "up"

    def test_parser_all_commands_registered(self):
        parser = build_parser()
        expected = ["up", "down", "migrate", "status", "serve"]
        for cmd in expected:
            args = parser.parse_args([cmd])
            assert args.command == cmd

    def test_migrate_accepts_target(self):
        parser = build_parser()
        args = parser.parse_args(["migrate", "--target", "000005"])
        assert args.command == "migrate"
        assert args.target == "000005"

    def test_migrate_default_target(self):
        parser = build_parser()
        args = parser.parse_args(["migrate"])
        assert args.target == "latest"

    def test_serve_accepts_port(self):
        parser = build_parser()
        args = parser.parse_args(["serve", "--port", "8080"])
        assert args.command == "serve"
        assert args.port == 8080

    def test_serve_default_port(self):
        parser = build_parser()
        args = parser.parse_args(["serve"])
        assert args.port == 5174


class TestMain:
    """Tests for the main() dispatch function."""

    def test_no_args_prints_help_returns_zero(self):
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            rc = main([])
        assert rc == 0
        assert "niuu" in stdout.getvalue().lower() or "usage" in stdout.getvalue().lower()

    def test_version_exits_zero(self):
        with pytest.raises(SystemExit) as exc_info:
            main(["--version"])
        assert exc_info.value.code == 0

    def test_up_dispatches_to_plugin(self):
        with patch("cli._commands.up.execute", return_value=0) as mock_exec:
            rc = main(["up"])
        assert rc == 0
        mock_exec.assert_called_once()

    def test_down_dispatches_to_plugin(self):
        with patch("cli._commands.down.execute", return_value=0) as mock_exec:
            rc = main(["down"])
        assert rc == 0
        mock_exec.assert_called_once()

    def test_status_dispatches_to_plugin(self):
        with patch("cli._commands.status.execute", return_value=0) as mock_exec:
            rc = main(["status"])
        assert rc == 0
        mock_exec.assert_called_once()

    def test_serve_dispatches_to_plugin(self):
        with patch("cli._commands.serve.execute", return_value=0) as mock_exec:
            rc = main(["serve"])
        assert rc == 0
        mock_exec.assert_called_once()

    def test_migrate_dispatches_to_plugin(self):
        with patch("cli._commands.migrate.execute", return_value=0) as mock_exec:
            rc = main(["migrate"])
        assert rc == 0
        mock_exec.assert_called_once()

    def test_plugin_returning_nonzero_propagated(self):
        with patch("cli._commands.up.execute", return_value=1):
            rc = main(["up"])
        assert rc == 1

    def test_unknown_command_shows_help(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            with pytest.raises(SystemExit) as exc_info:
                main(["nonexistent"])
        assert exc_info.value.code == 2
