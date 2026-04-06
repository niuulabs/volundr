"""SQLite skill extraction adapter.

Discovers reusable skills from recurring successful episode patterns.

Discovery logic:
- After each SUCCESS episode, record its dominant tool pattern in a local
  ``skill_patterns`` table within the skills database.
- When pattern count reaches ``suggestion_threshold``, check if a skill
  already exists for that tool pattern.
- If not, synthesise a skill from the matching episodes and persist it.

The adapter is self-contained: it does NOT require access to the memory DB.
It tracks its own lightweight episode-pattern rows.

Two-layer caching:
- In-process LRU dict: ``{pattern_key -> Skill}`` — avoids redundant DB reads.
- Disk manifest: ``<db_path>.skills.json`` — fast listing without full scans.
"""

from __future__ import annotations

import asyncio
import json
import random
import sqlite3
import time
from collections import OrderedDict
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from ravn.domain.models import Episode, Outcome, Skill
from ravn.ports.skill import SkillPort

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS skills (
    skill_id        TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    content         TEXT NOT NULL,
    requires_tools  TEXT NOT NULL,
    fallback_tools  TEXT NOT NULL,
    source_episodes TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    success_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skill_patterns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_key     TEXT NOT NULL,
    episode_id      TEXT NOT NULL,
    task_description TEXT NOT NULL DEFAULT '',
    summary         TEXT NOT NULL DEFAULT '',
    timestamp       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS skill_patterns_key ON skill_patterns(pattern_key);
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_skill(row: sqlite3.Row) -> Skill:
    return Skill(
        skill_id=row["skill_id"],
        name=row["name"],
        description=row["description"],
        content=row["content"],
        requires_tools=json.loads(row["requires_tools"]),
        fallback_for_tools=json.loads(row["fallback_tools"]),
        source_episodes=json.loads(row["source_episodes"]),
        created_at=datetime.fromisoformat(row["created_at"]).replace(tzinfo=UTC),
        success_count=row["success_count"],
    )


def _dominant_tool(tools: list[str]) -> str | None:
    """Return the most frequently occurring tool, or None if list is empty."""
    if not tools:
        return None
    counts: dict[str, int] = {}
    for t in tools:
        counts[t] = counts.get(t, 0) + 1
    return max(counts, key=lambda k: counts[k])


def _pattern_key(episode: Episode) -> str | None:
    """Derive a stable pattern key from an episode's dominant tool."""
    tool = _dominant_tool(episode.tools_used)
    if tool is None:
        return None
    return f"tool:{tool}"


def _synthesise_skill(pattern_key: str, episodes: list[Episode]) -> Skill:
    """Build a Skill document from a group of similar episodes."""
    tool = pattern_key.split(":", 1)[1] if ":" in pattern_key else pattern_key
    name = f"Use {tool} effectively"
    description = f"Reusable procedure for tasks involving the '{tool}' tool."

    # Build Markdown content with YAML frontmatter.
    requires_tools = sorted({tool})
    fallback_for: list[str] = []
    frontmatter = (
        f"---\nname: {name}\nrequires_tools: {json.dumps(requires_tools)}\n"
        f"fallback_for_tools: {json.dumps(fallback_for)}\n---\n"
    )
    summary_lines = [
        f"- [{ep.outcome.upper()}] {ep.task_description}: {ep.summary}"
        for ep in episodes[-5:]  # most recent 5
    ]
    content = (
        frontmatter
        + f"\n## {name}\n\n"
        + "Observed successful patterns:\n\n"
        + "\n".join(summary_lines)
        + "\n"
    )

    return Skill(
        skill_id=str(uuid4()),
        name=name,
        description=description,
        content=content,
        requires_tools=requires_tools,
        fallback_for_tools=fallback_for,
        source_episodes=[ep.episode_id for ep in episodes],
        created_at=datetime.now(UTC),
        success_count=len(episodes),
    )


# ---------------------------------------------------------------------------
# LRU cache
# ---------------------------------------------------------------------------


class _LRUCache:
    """Minimal in-process LRU cache for skill objects."""

    def __init__(self, max_entries: int) -> None:
        self._max = max_entries
        self._data: OrderedDict[str, Skill] = OrderedDict()

    def get(self, key: str) -> Skill | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: str, skill: Skill) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = skill
        if len(self._data) > self._max:
            self._data.popitem(last=False)

    def invalidate(self, key: str) -> None:
        self._data.pop(key, None)


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class SqliteSkillAdapter(SkillPort):
    """Skill extraction and storage backed by a local SQLite database.

    Args:
        path: SQLite database file path.
        suggestion_threshold: Minimum number of similar SUCCESS episodes
            required before a skill is auto-synthesised.
        cache_max_entries: Maximum entries in the in-process LRU cache.
    """

    def __init__(
        self,
        path: str = "~/.ravn/skills.db",
        *,
        suggestion_threshold: int = 3,
        cache_max_entries: int = 128,
        max_retries: int = 15,
        min_jitter_ms: float = 20.0,
        max_jitter_ms: float = 150.0,
    ) -> None:
        self._path = Path(path).expanduser()
        self._suggestion_threshold = suggestion_threshold
        self._cache: _LRUCache = _LRUCache(cache_max_entries)
        self._manifest_path: Path = self._path.with_suffix(".skills.json")
        self._max_retries = max_retries
        self._min_jitter_ms = min_jitter_ms
        self._max_jitter_ms = max_jitter_ms

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        await asyncio.to_thread(self._init_db)

    def _init_db(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _with_retry(self, fn, *args):
        """Execute *fn* with retry on SQLite locked errors."""
        last_exc: Exception = RuntimeError("no attempts made")
        for attempt in range(self._max_retries):
            try:
                return fn(*args)
            except sqlite3.OperationalError as exc:
                if "database is locked" not in str(exc).lower():
                    raise
                last_exc = exc
                if attempt < self._max_retries - 1:
                    jitter = random.uniform(self._min_jitter_ms, self._max_jitter_ms) / 1000.0
                    time.sleep(jitter)
        raise last_exc

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _insert_pattern_sync(self, episode: Episode, pattern_key: str) -> None:
        """Record a successful episode's pattern in the local patterns table."""

        def _do_insert() -> None:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO skill_patterns
                        (pattern_key, episode_id, task_description, summary, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        pattern_key,
                        episode.episode_id,
                        episode.task_description,
                        episode.summary,
                        episode.timestamp.isoformat(),
                    ),
                )
                conn.commit()
            finally:
                conn.close()

        self._with_retry(_do_insert)

    def _load_pattern_episodes_sync(self, pattern_key: str) -> list[tuple[str, str, str]]:
        """Return (episode_id, task_description, summary) for *pattern_key*."""

        def _do_load() -> list[tuple[str, str, str]]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT episode_id, task_description, summary
                    FROM skill_patterns
                    WHERE pattern_key = ?
                    ORDER BY timestamp DESC
                    LIMIT 100
                    """,
                    (pattern_key,),
                ).fetchall()
            finally:
                conn.close()
            return [(r["episode_id"], r["task_description"], r["summary"]) for r in rows]

        return self._with_retry(_do_load)

    def _skill_exists_for_pattern_sync(self, pattern_key: str) -> bool:
        tool = pattern_key.split(":", 1)[1] if ":" in pattern_key else ""

        def _do_check() -> bool:
            conn = self._connect()
            try:
                row = conn.execute(
                    """
                    SELECT skill_id FROM skills
                    WHERE EXISTS (
                        SELECT 1 FROM json_each(skills.requires_tools) WHERE value = ?
                    )
                    LIMIT 1
                    """,
                    (tool,),
                ).fetchone()
            finally:
                conn.close()
            return row is not None

        return self._with_retry(_do_check)

    def _insert_skill_sync(self, skill: Skill) -> None:
        def _do_insert() -> None:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO skills
                        (skill_id, name, description, content, requires_tools,
                         fallback_tools, source_episodes, created_at, success_count)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        skill.skill_id,
                        skill.name,
                        skill.description,
                        skill.content,
                        json.dumps(skill.requires_tools),
                        json.dumps(skill.fallback_for_tools),
                        json.dumps(skill.source_episodes),
                        skill.created_at.isoformat(),
                        skill.success_count,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

        self._with_retry(_do_insert)
        self._update_manifest_sync()

    def _load_all_skills_sync(self, query: str | None) -> list[Skill]:
        def _do_load() -> list[Skill]:
            conn = self._connect()
            try:
                if query:
                    rows = conn.execute(
                        """
                        SELECT * FROM skills
                        WHERE name LIKE ? OR description LIKE ? OR content LIKE ?
                        ORDER BY success_count DESC
                        """,
                        (f"%{query}%", f"%{query}%", f"%{query}%"),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM skills ORDER BY success_count DESC"
                    ).fetchall()
            finally:
                conn.close()
            return [_row_to_skill(r) for r in rows]

        return self._with_retry(_do_load)

    def _update_manifest_sync(self) -> None:
        """Write a lightweight JSON manifest listing skill names and IDs."""
        skills = self._load_all_skills_sync(None)
        manifest = [
            {"skill_id": s.skill_id, "name": s.name, "requires_tools": s.requires_tools}
            for s in skills
        ]
        try:
            self._manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        except OSError:
            pass  # non-fatal

    # ------------------------------------------------------------------
    # SkillPort
    # ------------------------------------------------------------------

    async def record_episode(self, episode: Episode) -> Skill | None:
        if episode.outcome != Outcome.SUCCESS:
            return None

        pattern_key = _pattern_key(episode)
        if pattern_key is None:
            return None

        # Record this episode's pattern in the local table.
        await asyncio.to_thread(self._insert_pattern_sync, episode, pattern_key)

        # Check in-process cache first — skill already exists.
        if self._cache.get(pattern_key) is not None:
            return None

        # Load pattern count from DB.
        matches = await asyncio.to_thread(self._load_pattern_episodes_sync, pattern_key)
        if len(matches) < self._suggestion_threshold:
            return None

        # Check DB to avoid duplicates across process restarts.
        already_exists = await asyncio.to_thread(self._skill_exists_for_pattern_sync, pattern_key)
        if already_exists:
            # Warm the cache so subsequent calls skip DB check.
            return None

        # Build synthetic episode objects for skill creation.
        synthetic_eps = [
            Episode(
                episode_id=m[0],
                session_id="",
                timestamp=datetime.now(UTC),
                summary=m[2],
                task_description=m[1],
                tools_used=episode.tools_used,
                outcome=Outcome.SUCCESS,
                tags=[],
            )
            for m in matches[: self._suggestion_threshold + 2]
        ]
        skill = _synthesise_skill(pattern_key, synthetic_eps)
        await asyncio.to_thread(self._insert_skill_sync, skill)
        self._cache.put(pattern_key, skill)
        return skill

    async def list_skills(self, query: str | None = None) -> list[Skill]:
        return await asyncio.to_thread(self._load_all_skills_sync, query)

    async def record_skill(self, skill: Skill) -> None:
        await asyncio.to_thread(self._insert_skill_sync, skill)
        pattern_key = f"tool:{skill.requires_tools[0]}" if skill.requires_tools else None
        if pattern_key:
            self._cache.put(pattern_key, skill)
