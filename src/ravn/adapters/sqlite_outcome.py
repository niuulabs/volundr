"""SQLite task-outcome adapter.

Persists ``TaskOutcome`` records in a ``task_outcomes`` table (with FTS5
full-text search) and exposes ``retrieve_lessons`` for system-prompt injection.

Uses WAL mode and the same retry-with-jitter strategy as the episodic memory
adapter so it can safely share the same database file.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path

from ravn.adapters.sqlite_common import CHARS_PER_TOKEN
from ravn.domain.models import TaskOutcome
from ravn.ports.outcome import OutcomePort

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS task_outcomes (
    task_id             TEXT PRIMARY KEY,
    task_summary        TEXT NOT NULL,
    outcome             TEXT NOT NULL,
    tools_used          TEXT NOT NULL,
    iterations_used     INTEGER NOT NULL,
    cost_usd            REAL NOT NULL,
    duration_seconds    REAL NOT NULL,
    errors              TEXT NOT NULL,
    reflection          TEXT NOT NULL,
    tags                TEXT NOT NULL,
    timestamp           TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS task_outcomes_fts USING fts5(
    task_summary,
    reflection,
    tags,
    content=task_outcomes,
    content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS task_outcomes_ai
AFTER INSERT ON task_outcomes BEGIN
    INSERT INTO task_outcomes_fts(rowid, task_summary, reflection, tags)
    VALUES (new.rowid, new.task_summary, new.reflection, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS task_outcomes_ad
AFTER DELETE ON task_outcomes BEGIN
    INSERT INTO task_outcomes_fts(task_outcomes_fts, rowid, task_summary, reflection, tags)
    VALUES ('delete', old.rowid, old.task_summary, old.reflection, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS task_outcomes_au
AFTER UPDATE ON task_outcomes BEGIN
    INSERT INTO task_outcomes_fts(task_outcomes_fts, rowid, task_summary, reflection, tags)
    VALUES ('delete', old.rowid, old.task_summary, old.reflection, old.tags);
    INSERT INTO task_outcomes_fts(rowid, task_summary, reflection, tags)
    VALUES (new.rowid, new.task_summary, new.reflection, new.tags);
END;
"""


class SQLiteOutcomeAdapter(OutcomePort):
    """SQLite-backed outcome store with FTS5 retrieval.

    Args:
        path: File path for the SQLite database.  Expanded with
            ``Path.expanduser()``.  Defaults to ``~/.ravn/memory.db``
            (shared with the episodic memory adapter).
        max_retries: Retry attempts on ``database is locked`` errors.
        min_jitter_ms: Minimum random jitter between retries (ms).
        max_jitter_ms: Maximum random jitter between retries (ms).
        lessons_token_budget: Maximum tokens of lessons content injected per
            turn (approximate; converted to chars using CHARS_PER_TOKEN).
    """

    def __init__(
        self,
        path: str = "~/.ravn/memory.db",
        *,
        max_retries: int = 15,
        min_jitter_ms: float = 20.0,
        max_jitter_ms: float = 150.0,
        lessons_token_budget: int = 1500,
    ) -> None:
        self._path = Path(path).expanduser()
        self._max_retries = max_retries
        self._min_jitter_ms = min_jitter_ms
        self._max_jitter_ms = max_jitter_ms
        self._lessons_token_budget = lessons_token_budget
        self._initialized = False

    # ------------------------------------------------------------------
    # OutcomePort interface
    # ------------------------------------------------------------------

    async def record_outcome(self, outcome: TaskOutcome) -> None:
        """Persist a task outcome, replacing any existing record with the same id."""
        await asyncio.to_thread(self._sync_record, outcome)

    async def count_all_outcomes(self) -> int:
        """Return the total number of stored outcomes."""
        return await asyncio.to_thread(self._sync_count)

    async def list_recent_outcomes(
        self,
        limit: int = 50,
        *,
        since: datetime | None = None,
    ) -> list[TaskOutcome]:
        """Return recent outcomes ordered by descending timestamp."""
        return await asyncio.to_thread(self._sync_list_recent, limit, since)

    async def retrieve_lessons(
        self,
        task_description: str,
        *,
        limit: int = 3,
    ) -> str:
        """Return a 'Lessons Learned' Markdown block for *task_description*.

        Searches the FTS5 index using sanitised terms from the description.
        Returns an empty string if no results are found or if the query
        contains no indexable terms.
        """
        query = _sanitise_fts_query(task_description)
        if not query:
            return ""
        rows = await asyncio.to_thread(self._sync_search, query, limit)
        if not rows:
            return ""
        return _format_lessons(rows, self._lessons_token_budget)

    # ------------------------------------------------------------------
    # Synchronous helpers (run in thread)
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        """Open a connection and set PRAGMAs; does not create the schema."""
        conn = sqlite3.connect(str(self._path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self) -> None:
        """Create the database directory and tables (called once on first use)."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _with_retry(self, fn):  # type: ignore[no-untyped-def]
        """Execute *fn(conn)* with retry on ``database is locked``."""
        if not self._initialized:
            self._init_db()
            self._initialized = True

        last_exc: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                conn = self._connect()
                try:
                    return fn(conn)
                finally:
                    conn.close()
            except sqlite3.OperationalError as exc:
                if "locked" not in str(exc).lower():
                    raise
                last_exc = exc
                jitter = random.uniform(self._min_jitter_ms, self._max_jitter_ms) / 1000.0
                time.sleep(jitter * (attempt + 1))
        raise RuntimeError(f"SQLite locked after {self._max_retries} retries") from last_exc

    def _sync_record(self, outcome: TaskOutcome) -> None:
        def _run(conn: sqlite3.Connection) -> None:
            conn.execute(
                """
                INSERT OR REPLACE INTO task_outcomes
                    (task_id, task_summary, outcome, tools_used, iterations_used,
                     cost_usd, duration_seconds, errors, reflection, tags, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    outcome.task_id,
                    outcome.task_summary,
                    outcome.outcome,
                    json.dumps(outcome.tools_used),
                    outcome.iterations_used,
                    outcome.cost_usd,
                    outcome.duration_seconds,
                    json.dumps(outcome.errors),
                    outcome.reflection,
                    json.dumps(outcome.tags),
                    outcome.timestamp.isoformat(),
                ),
            )
            conn.commit()

        self._with_retry(_run)

    def _sync_count(self) -> int:
        def _run(conn: sqlite3.Connection) -> int:
            try:
                row = conn.execute("SELECT COUNT(*) FROM task_outcomes").fetchone()
                return int(row[0]) if row else 0
            except sqlite3.OperationalError:
                return 0

        return self._with_retry(_run)

    def _sync_list_recent(
        self,
        limit: int,
        since: datetime | None,
    ) -> list[TaskOutcome]:
        def _run(conn: sqlite3.Connection) -> list[TaskOutcome]:
            try:
                if since is not None:
                    rows = conn.execute(
                        """
                        SELECT task_id, task_summary, outcome, tools_used,
                               iterations_used, cost_usd, duration_seconds,
                               errors, reflection, tags, timestamp
                        FROM task_outcomes
                        WHERE timestamp > ?
                        ORDER BY timestamp DESC
                        LIMIT ?
                        """,
                        (since.isoformat(), limit),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT task_id, task_summary, outcome, tools_used,
                               iterations_used, cost_usd, duration_seconds,
                               errors, reflection, tags, timestamp
                        FROM task_outcomes
                        ORDER BY timestamp DESC
                        LIMIT ?
                        """,
                        (limit,),
                    ).fetchall()
            except sqlite3.OperationalError:
                return []
            return [_row_to_outcome(row) for row in rows]

        return self._with_retry(_run)

    def _sync_search(self, query: str, limit: int) -> list[sqlite3.Row]:
        def _run(conn: sqlite3.Connection) -> list[sqlite3.Row]:
            try:
                rows = conn.execute(
                    """
                    SELECT t.task_id, t.task_summary, t.outcome, t.reflection,
                           t.tags, t.timestamp, t.errors
                    FROM task_outcomes_fts f
                    JOIN task_outcomes t ON t.rowid = f.rowid
                    WHERE task_outcomes_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                    (query, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                # FTS table may be empty or query may be invalid.
                rows = []
            return rows

        return self._with_retry(_run)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_outcome(row: sqlite3.Row) -> TaskOutcome:
    """Convert a ``task_outcomes`` row to a ``TaskOutcome`` dataclass."""
    try:
        ts = datetime.fromisoformat(row["timestamp"])
    except (ValueError, KeyError):
        ts = datetime.now(UTC)

    from ravn.domain.models import Outcome  # local import to avoid circular dependency

    return TaskOutcome(
        task_id=row["task_id"],
        task_summary=row["task_summary"],
        outcome=Outcome(row["outcome"]),
        tools_used=json.loads(row["tools_used"]),
        iterations_used=int(row["iterations_used"]),
        cost_usd=float(row["cost_usd"]),
        duration_seconds=float(row["duration_seconds"]),
        errors=json.loads(row["errors"]),
        reflection=row["reflection"],
        tags=json.loads(row["tags"]),
        timestamp=ts,
    )


def _sanitise_fts_query(text: str) -> str:
    """Convert free text into a safe FTS5 OR query (strips special chars)."""
    words = re.findall(r"[a-zA-Z0-9_]+", text)
    stopwords = {
        "a",
        "an",
        "the",
        "and",
        "or",
        "in",
        "on",
        "at",
        "to",
        "for",
        "of",
        "with",
        "by",
        "from",
        "up",
        "is",
        "it",
        "as",
        "be",
    }
    terms = [w.lower() for w in words if len(w) >= 3 and w.lower() not in stopwords]
    if not terms:
        return ""
    return " OR ".join(terms[:20])


def _format_lessons(rows: list[sqlite3.Row], lessons_token_budget: int = 1500) -> str:
    """Format a list of outcome rows as a Markdown 'Lessons Learned' block."""
    lines = ["## Lessons Learned\n"]
    budget = lessons_token_budget * CHARS_PER_TOKEN
    used = len(lines[0])

    for row in rows:
        try:
            ts = datetime.fromisoformat(row["timestamp"])
            date_str = ts.strftime("%Y-%m-%d")
        except (ValueError, KeyError):
            date_str = "unknown"

        outcome = row["outcome"]
        summary = row["task_summary"]
        reflection = row["reflection"]

        entry = f"\n**{date_str}** ({outcome}) {summary}\n{reflection}\n"
        if used + len(entry) > budget:
            break
        lines.append(entry)
        used += len(entry)

    if len(lines) == 1:
        return ""
    return "".join(lines)
