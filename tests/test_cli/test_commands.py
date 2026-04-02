"""Tests for individual CLI commands (_commands/ modules)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from cli._commands.migrate import execute as migrate_execute
from cli._commands.serve import execute as serve_execute


class TestServeCommand:
    def test_returns_zero_when_dist_exists(self, tmp_path: Path):
        dist = tmp_path / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<html></html>")

        with patch("cli._commands.serve.web_dist_dir", return_value=dist):
            assert serve_execute(port=8080) == 0

    def test_returns_one_when_dist_missing(self):
        with patch(
            "cli._commands.serve.web_dist_dir",
            side_effect=FileNotFoundError("not found"),
        ):
            assert serve_execute(port=8080) == 1


class TestMigrateCommand:
    def test_returns_zero_when_migrations_exist(self, tmp_path: Path):
        mig = tmp_path / "migrations"
        mig.mkdir()
        (mig / "000001_initial.up.sql").write_text("CREATE TABLE;")

        with patch("cli._commands.migrate.migration_dir", return_value=mig):
            assert migrate_execute(target="latest") == 0

    def test_returns_one_when_dir_missing(self):
        with patch(
            "cli._commands.migrate.migration_dir",
            side_effect=FileNotFoundError("not found"),
        ):
            assert migrate_execute(target="latest") == 1

    def test_returns_one_when_no_sql_files(self, tmp_path: Path):
        mig = tmp_path / "migrations"
        mig.mkdir()
        # No .up.sql files

        with patch("cli._commands.migrate.migration_dir", return_value=mig):
            assert migrate_execute(target="latest") == 1
