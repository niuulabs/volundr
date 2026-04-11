"""Migration runner helper for integration tests.

Discovers and applies `*.up.sql` migration files against a real PostgreSQL
database, sorted by their 6-digit numeric prefix.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import asyncpg

_PREFIX_RE = re.compile(r"^(\d{6})_.*\.up\.sql$")


class MigrationError(Exception):
    """Raised when a migration file fails to apply."""

    def __init__(self, file: Path, cause: Exception) -> None:
        self.file = file
        self.cause = cause
        super().__init__(f"Migration failed: {file.name} — {cause}")


def discover_migrations(migrations_dir: Path) -> list[Path]:
    """Return `*.up.sql` files sorted by their 6-digit numeric prefix.

    Raises ``FileNotFoundError`` if *migrations_dir* does not exist.
    """
    if not migrations_dir.is_dir():
        raise FileNotFoundError(f"Migrations directory not found: {migrations_dir}")

    files: list[tuple[str, Path]] = []
    for path in migrations_dir.iterdir():
        m = _PREFIX_RE.match(path.name)
        if m:
            files.append((m.group(1), path))

    files.sort(key=lambda t: t[0])
    return [path for _, path in files]


async def apply_migrations(
    pool: asyncpg.Pool,
    migrations_dir: Path,
) -> list[Path]:
    """Apply all ``*.up.sql`` migrations in *migrations_dir* sequentially.

    Parameters
    ----------
    pool:
        An ``asyncpg`` connection pool.
    migrations_dir:
        Directory containing ``NNNNNN_*.up.sql`` migration files.

    Returns
    -------
    list[Path]
        The ordered list of migration files that were applied.

    Raises
    ------
    MigrationError
        If any migration file fails to execute, wrapping the original
        exception and identifying the failing file.
    FileNotFoundError
        If *migrations_dir* does not exist.
    """
    migration_files = discover_migrations(migrations_dir)

    async with pool.acquire() as conn:
        for file in migration_files:
            sql = file.read_text(encoding="utf-8")
            try:
                await conn.execute(sql)
            except Exception as exc:
                raise MigrationError(file, exc) from exc

    return migration_files
