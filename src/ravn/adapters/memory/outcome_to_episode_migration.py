"""One-time data migration: copy task_outcomes records into episodes.

NIU-574: Merges the legacy ``task_outcomes`` table (SQLite) into ``episodes``
by matching rows on ``session_id`` and nearest timestamp.  Run once against
an existing database to preserve historical reflection data.

Usage::

    python -m ravn.adapters.memory.outcome_to_episode_migration \
        --db ~/.ravn/memory.db [--dry-run]
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path


def _open(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def migrate(db_path: Path, *, dry_run: bool = False) -> int:
    """Copy task_outcomes data into the episodes table.

    Matches each outcome to the episode with the same session_id and the
    closest timestamp (within 60 seconds).  Copies reflection, errors,
    cost_usd, and duration_seconds.

    Returns the number of episodes updated.
    """
    conn = _open(db_path)
    try:
        # Check that task_outcomes table exists.
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task_outcomes'"
        ).fetchone()
        if row is None:
            print("task_outcomes table not found — nothing to migrate.", file=sys.stderr)
            return 0

        outcomes = conn.execute(
            """
            SELECT task_id, task_summary, outcome, reflection, errors,
                   cost_usd, duration_seconds, timestamp
            FROM task_outcomes
            ORDER BY timestamp DESC
            """
        ).fetchall()

        if not outcomes:
            print("No rows in task_outcomes.", file=sys.stderr)
            return 0

        updated = 0
        for oc in outcomes:
            try:
                oc_ts = datetime.fromisoformat(oc["timestamp"])
            except (ValueError, TypeError):
                oc_ts = datetime.now(UTC)

            # Find the closest episode in the same session (within 60 s).
            ep_row = conn.execute(
                """
                SELECT episode_id,
                       ABS(
                           strftime('%s', timestamp) - strftime('%s', ?)
                       ) AS delta
                FROM episodes
                ORDER BY delta
                LIMIT 1
                """,
                (oc_ts.isoformat(),),
            ).fetchone()

            if ep_row is None or ep_row["delta"] > 60:
                continue  # No sufficiently close episode found

            episode_id = ep_row["episode_id"]
            errors_json = oc["errors"] if oc["errors"] else "[]"

            if not dry_run:
                conn.execute(
                    """
                    UPDATE episodes SET
                        reflection       = ?,
                        errors           = ?,
                        cost_usd         = ?,
                        duration_seconds = ?
                    WHERE episode_id = ?
                      AND reflection IS NULL
                    """,
                    (
                        oc["reflection"],
                        errors_json,
                        oc["cost_usd"],
                        oc["duration_seconds"],
                        episode_id,
                    ),
                )
                conn.commit()

            updated += 1
            print(f"  {'[dry-run] ' if dry_run else ''}Updated episode {episode_id}")

        return updated
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate task_outcomes data into episodes (NIU-574)."
    )
    parser.add_argument("--db", required=True, help="Path to the SQLite database file.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without writing anything.",
    )
    args = parser.parse_args()
    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    n = migrate(db_path, dry_run=args.dry_run)
    print(f"{'[dry-run] ' if args.dry_run else ''}Updated {n} episode(s).")


if __name__ == "__main__":
    main()
