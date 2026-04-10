"""One-way SQLite → PostgreSQL episode migration tool.

When a Ravn instance transitions from Pi mode (SQLite) to infra mode
(PostgreSQL), this module migrates all recorded episodes to the shared
Volundr database.  The migration is idempotent: episodes already present
in PostgreSQL (matched by ``episode_id``) are skipped via
``ON CONFLICT DO NOTHING``.

Usage::

    import asyncio
    from ravn.adapters.memory.migrate import migrate_sqlite_to_postgres

    count = asyncio.run(
        migrate_sqlite_to_postgres(
            sqlite_path="~/.ravn/memory.db",
            postgres_dsn="postgresql://user:pass@host/db",
        )
    )
    print(f"Migrated {count} episodes")

Or via the CLI::

    python -m ravn.adapters.memory.migrate \\
        --sqlite ~/.ravn/memory.db \\
        --dsn "postgresql://user:pass@host/db"
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import asyncpg


async def migrate_sqlite_to_postgres(
    sqlite_path: str | Path,
    postgres_dsn: str,
    *,
    batch_size: int = 100,
    on_progress: Callable[[int, int], None] | None = None,
) -> int:
    """Migrate all episodes from a SQLite memory database to PostgreSQL.

    Episodes already present in PostgreSQL are skipped (idempotent).

    Args:
        sqlite_path: Path to the SQLite memory database (e.g. ``~/.ravn/memory.db``).
        postgres_dsn: asyncpg-compatible PostgreSQL DSN.
        batch_size: Number of episodes inserted per transaction.
        on_progress: Optional callback receiving ``(migrated_so_far, total)``
            after each batch.

    Returns:
        Number of episodes successfully inserted (skips are not counted).
    """
    path = Path(sqlite_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"SQLite database not found: {path}")

    sqlite_conn = sqlite3.connect(str(path), check_same_thread=False)
    sqlite_conn.row_factory = sqlite3.Row

    try:
        rows = sqlite_conn.execute(
            "SELECT episode_id, session_id, timestamp, summary, "
            "task_description, tools_used, outcome, tags, embedding "
            "FROM episodes"
        ).fetchall()
    finally:
        sqlite_conn.close()

    total = len(rows)
    if total == 0:
        return 0

    pool = await asyncpg.create_pool(postgres_dsn, min_size=1, max_size=3)
    inserted = 0

    try:
        for batch_start in range(0, total, batch_size):
            batch = rows[batch_start : batch_start + batch_size]
            async with pool.acquire() as conn:
                async with conn.transaction():
                    for row in batch:
                        tools_used = json.loads(row["tools_used"] or "[]")
                        tags = json.loads(row["tags"] or "[]")
                        ts_str = row["timestamp"]
                        try:
                            ts = datetime.fromisoformat(ts_str)
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=UTC)
                        except (ValueError, TypeError):
                            ts = datetime.now(UTC)

                        result = await conn.execute(
                            """
                            INSERT INTO ravn_episodes
                                (episode_id, session_id, timestamp, summary,
                                 task_description, tools_used, outcome, tags, embedding)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                            ON CONFLICT (episode_id) DO NOTHING
                            """,
                            row["episode_id"],
                            row["session_id"],
                            ts,
                            row["summary"],
                            row["task_description"],
                            tools_used,
                            row["outcome"],
                            tags,
                            row["embedding"],  # TEXT (JSON), stored as-is
                        )
                        # asyncpg returns "INSERT 0 N" — check if row was inserted.
                        if result == "INSERT 0 1":
                            inserted += 1

            if on_progress is not None:
                on_progress(min(batch_start + batch_size, total), total)
    finally:
        await pool.close()

    return inserted


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _main() -> None:
    import argparse
    import asyncio
    import sys

    parser = argparse.ArgumentParser(
        description="Migrate Ravn episodes from SQLite to PostgreSQL.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--sqlite",
        default="~/.ravn/memory.db",
        help="Path to the SQLite memory database.",
    )
    parser.add_argument(
        "--dsn",
        required=True,
        help="PostgreSQL DSN (e.g. postgresql://user:pass@host/db).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Episodes per transaction batch.",
    )
    args = parser.parse_args()

    def _progress(done: int, total: int) -> None:
        print(f"  {done}/{total} episodes processed…", flush=True)

    print(f"Migrating {args.sqlite} → PostgreSQL …")
    try:
        count = asyncio.run(
            migrate_sqlite_to_postgres(
                sqlite_path=args.sqlite,
                postgres_dsn=args.dsn,
                batch_size=args.batch_size,
                on_progress=_progress,
            )
        )
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Done. {count} episodes inserted.")


if __name__ == "__main__":
    _main()
