"""Unit tests for the migration runner helper.

These tests verify file discovery and ordering using a temporary directory
of mock `.sql` files — no database connection required.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.helpers.migrations import (
    MigrationError,
    apply_migrations,
    discover_migrations,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def migrations_dir(tmp_path: Path) -> Path:
    """Create a temp directory with mock migration files."""
    files = [
        "000001_initial_schema.up.sql",
        "000002_add_columns.up.sql",
        "000003_add_indexes.up.sql",
        "000001_initial_schema.down.sql",  # should be ignored
        "README.md",  # should be ignored
    ]
    for name in files:
        (tmp_path / name).write_text(f"-- {name}", encoding="utf-8")
    return tmp_path


@pytest.fixture()
def unordered_dir(tmp_path: Path) -> Path:
    """Migrations written in non-alphabetical filesystem order."""
    files = [
        "000010_late.up.sql",
        "000003_middle.up.sql",
        "000001_first.up.sql",
    ]
    for name in files:
        (tmp_path / name).write_text(f"-- {name}", encoding="utf-8")
    return tmp_path


# ---------------------------------------------------------------------------
# discover_migrations
# ---------------------------------------------------------------------------


class TestDiscoverMigrations:
    def test_discovers_only_up_sql_files(self, migrations_dir: Path) -> None:
        result = discover_migrations(migrations_dir)
        names = [p.name for p in result]
        assert names == [
            "000001_initial_schema.up.sql",
            "000002_add_columns.up.sql",
            "000003_add_indexes.up.sql",
        ]

    def test_ignores_down_and_non_sql(self, migrations_dir: Path) -> None:
        result = discover_migrations(migrations_dir)
        names = {p.name for p in result}
        assert "000001_initial_schema.down.sql" not in names
        assert "README.md" not in names

    def test_sorts_by_numeric_prefix(self, unordered_dir: Path) -> None:
        result = discover_migrations(unordered_dir)
        prefixes = [p.name[:6] for p in result]
        assert prefixes == ["000001", "000003", "000010"]

    def test_empty_directory(self, tmp_path: Path) -> None:
        result = discover_migrations(tmp_path)
        assert result == []

    def test_missing_directory_raises(self, tmp_path: Path) -> None:
        missing = tmp_path / "nonexistent"
        with pytest.raises(FileNotFoundError, match="nonexistent"):
            discover_migrations(missing)


# ---------------------------------------------------------------------------
# apply_migrations
# ---------------------------------------------------------------------------


class TestApplyMigrations:
    async def test_applies_all_in_order(self, migrations_dir: Path) -> None:
        conn = AsyncMock()
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

        applied = await apply_migrations(pool, migrations_dir)

        assert len(applied) == 3
        assert applied[0].name == "000001_initial_schema.up.sql"
        assert applied[2].name == "000003_add_indexes.up.sql"

        # Verify execute was called three times with the file contents
        assert conn.execute.call_count == 3
        first_sql = conn.execute.call_args_list[0].args[0]
        assert "000001_initial_schema.up.sql" in first_sql

    async def test_raises_migration_error_on_failure(self, migrations_dir: Path) -> None:
        conn = AsyncMock()
        conn.execute.side_effect = [None, RuntimeError("syntax error")]
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(MigrationError, match="000002_add_columns.up.sql") as exc:
            await apply_migrations(pool, migrations_dir)

        assert exc.value.file.name == "000002_add_columns.up.sql"
        assert isinstance(exc.value.cause, RuntimeError)

    async def test_missing_dir_raises(self, tmp_path: Path) -> None:
        pool = MagicMock()
        with pytest.raises(FileNotFoundError):
            await apply_migrations(pool, tmp_path / "nope")

    async def test_empty_dir_returns_empty(self, tmp_path: Path) -> None:
        conn = AsyncMock()
        pool = MagicMock()
        pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
        pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await apply_migrations(pool, tmp_path)

        assert result == []
        conn.execute.assert_not_called()
