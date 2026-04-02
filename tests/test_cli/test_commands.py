"""Tests for individual CLI commands."""

from __future__ import annotations

import argparse
from pathlib import Path
from unittest.mock import patch

from cli._commands.down import execute as down_execute
from cli._commands.migrate import execute as migrate_execute
from cli._commands.serve import execute as serve_execute
from cli._commands.status import execute as status_execute
from cli._commands.up import execute as up_execute


class TestUpCommand:
    def test_returns_zero(self):
        args = argparse.Namespace()
        assert up_execute(args) == 0


class TestDownCommand:
    def test_returns_zero(self):
        args = argparse.Namespace()
        assert down_execute(args) == 0


class TestStatusCommand:
    def test_returns_zero(self):
        args = argparse.Namespace()
        assert status_execute(args) == 0


class TestServeCommand:
    def test_returns_zero_when_dist_exists(self, tmp_path: Path):
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html></html>")

        args = argparse.Namespace(port=8080)
        with patch("cli._commands.serve.web_dist_dir", return_value=dist):
            assert serve_execute(args) == 0

    def test_returns_one_when_dist_missing(self):
        args = argparse.Namespace(port=8080)
        with patch(
            "cli._commands.serve.web_dist_dir",
            side_effect=FileNotFoundError("not found"),
        ):
            assert serve_execute(args) == 1


class TestMigrateCommand:
    def test_returns_zero_when_migrations_exist(self, tmp_path: Path):
        mig = tmp_path / "migrations"
        mig.mkdir()
        (mig / "000001_initial.up.sql").write_text("CREATE TABLE;")

        args = argparse.Namespace(target="latest")
        with patch("cli._commands.migrate.migration_dir", return_value=mig):
            assert migrate_execute(args) == 0

    def test_returns_one_when_dir_missing(self):
        args = argparse.Namespace(target="latest")
        with patch(
            "cli._commands.migrate.migration_dir",
            side_effect=FileNotFoundError("not found"),
        ):
            assert migrate_execute(args) == 1

    def test_returns_one_when_no_sql_files(self, tmp_path: Path):
        mig = tmp_path / "migrations"
        mig.mkdir()
        # No .up.sql files

        args = argparse.Namespace(target="latest")
        with patch("cli._commands.migrate.migration_dir", return_value=mig):
            assert migrate_execute(args) == 1
