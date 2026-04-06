"""SQLite episodic memory adapter.

Uses WAL mode for concurrent access, FTS5 for full-text search, and BM25
ranking for relevance.  Designed for low-resource environments (e.g. Pi).

When an ``EmbeddingPort`` is provided, query_episodes runs *hybrid retrieval*:
1. FTS5 keyword search → top-K BM25 candidates
2. Cosine similarity on stored episode embeddings → semantic candidates
3. Reciprocal Rank Fusion (RRF) to merge both ranking lists
4. Recency decay × outcome weight applied to normalised RRF score

Retry strategy: up to ``max_retries`` attempts on SQLite "database is locked"
errors with random jitter in [min_jitter_ms, max_jitter_ms] between attempts.
WAL passive checkpoint fires every ``checkpoint_interval`` writes.
"""

from __future__ import annotations

import asyncio
import json
import random
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path

from ravn.adapters.memory.scoring import (
    _AVG_EPISODE_CHARS,
    _CHARS_PER_TOKEN,
    _OUTCOME_WEIGHTS,
    _recency_score,
    build_prefetch_context,
    build_session_summaries,
    cosine_similarity,
    reciprocal_rank_fusion,
)
from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    Outcome,
    SessionSummary,
    SharedContext,
)
from ravn.ports.embedding import EmbeddingPort
from ravn.ports.memory import MemoryPort

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    episode_id      TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    summary         TEXT NOT NULL,
    task_description TEXT NOT NULL,
    tools_used      TEXT NOT NULL,
    outcome         TEXT NOT NULL,
    tags            TEXT NOT NULL,
    embedding       TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
    summary,
    task_description,
    tags,
    content=episodes,
    content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS episodes_ai
AFTER INSERT ON episodes BEGIN
    INSERT INTO episodes_fts(rowid, summary, task_description, tags)
    VALUES (new.rowid, new.summary, new.task_description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ad
AFTER DELETE ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, summary, task_description, tags)
    VALUES ('delete', old.rowid, old.summary, old.task_description, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS episodes_au
AFTER UPDATE ON episodes BEGIN
    INSERT INTO episodes_fts(episodes_fts, rowid, summary, task_description, tags)
    VALUES ('delete', old.rowid, old.summary, old.task_description, old.tags);
    INSERT INTO episodes_fts(rowid, summary, task_description, tags)
    VALUES (new.rowid, new.summary, new.task_description, new.tags);
END;
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sanitize_fts_query(query: str) -> str:
    """Escape FTS5 special characters and return a safe MATCH expression.

    Each whitespace-delimited token is wrapped in double quotes so that
    operators (AND, OR, NOT, -, *, ^) and hyphenated terms are treated as
    literals rather than FTS5 syntax.
    """
    tokens = query.split()
    if not tokens:
        return '""'
    sanitized = []
    for token in tokens:
        escaped = token.replace('"', '""')
        sanitized.append(f'"{escaped}"')
    return " ".join(sanitized)


def _row_to_episode(row: sqlite3.Row) -> Episode:
    """Convert a database row to an Episode dataclass."""
    ts_str: str = row["timestamp"]
    try:
        ts = datetime.fromisoformat(ts_str)
    except ValueError:
        ts = datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)

    tools: list[str] = json.loads(row["tools_used"])
    tags: list[str] = json.loads(row["tags"])
    emb_raw = row["embedding"]
    embedding: list[float] | None = json.loads(emb_raw) if emb_raw else None

    return Episode(
        episode_id=row["episode_id"],
        session_id=row["session_id"],
        timestamp=ts,
        summary=row["summary"],
        task_description=row["task_description"],
        tools_used=tools,
        outcome=Outcome(row["outcome"]),
        tags=tags,
        embedding=embedding,
    )


def _combined_score(
    bm25: float,
    max_abs_bm25: float,
    timestamp: datetime,
    outcome: Outcome,
    half_life_days: float,
) -> float:
    """Combine BM25 relevance, recency decay, and outcome weight into [0, 1]."""
    bm25_rel = abs(bm25) / max_abs_bm25 if max_abs_bm25 > 0 else 0.0
    recency = _recency_score(timestamp, half_life_days)
    weight = _OUTCOME_WEIGHTS.get(outcome, 0.5)
    return bm25_rel * recency * weight


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class SqliteMemoryAdapter(MemoryPort):
    """Episodic memory backed by a local SQLite database with FTS5 search.

    When *embedding_port* is supplied, ``query_episodes`` uses hybrid retrieval
    (FTS5 + cosine similarity on stored embeddings merged via RRF).  Without an
    embedding port the adapter falls back to FTS5-only search.
    """

    def __init__(
        self,
        path: str = "~/.ravn/memory.db",
        *,
        max_retries: int = 15,
        min_jitter_ms: float = 20.0,
        max_jitter_ms: float = 150.0,
        checkpoint_interval: int = 50,
        prefetch_budget: int = 2000,
        prefetch_limit: int = 5,
        prefetch_min_relevance: float = 0.3,
        recency_half_life_days: float = 14.0,
        session_search_truncate_chars: int = 100_000,
        embedding_port: EmbeddingPort | None = None,
        rrf_k: int = 60,
        semantic_candidate_limit: int = 50,
    ) -> None:
        self._path = Path(path).expanduser()
        self._max_retries = max_retries
        self._min_jitter_ms = min_jitter_ms
        self._max_jitter_ms = max_jitter_ms
        self._checkpoint_interval = checkpoint_interval
        self._prefetch_budget = prefetch_budget
        self._prefetch_limit = prefetch_limit
        self._prefetch_min_relevance = prefetch_min_relevance
        self._recency_half_life_days = recency_half_life_days
        self._session_search_truncate_chars = session_search_truncate_chars
        self._embedding_port = embedding_port
        self._rrf_k = rrf_k
        self._semantic_candidate_limit = semantic_candidate_limit
        self._write_count = 0
        self._shared_context: SharedContext | None = None
        self._init_db()

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Create the database directory and tables if they do not exist."""
        await asyncio.to_thread(self._init_db)

    async def record_episode(self, episode: Episode) -> None:
        await asyncio.to_thread(self._record_episode_sync, episode)

    async def query_episodes(
        self,
        query: str,
        *,
        limit: int = 5,
        min_relevance: float = 0.3,
    ) -> list[EpisodeMatch]:
        if self._embedding_port is not None:
            return await self._query_hybrid(query, limit=limit, min_relevance=min_relevance)
        return await asyncio.to_thread(self._query_fts_sync, query, limit, min_relevance)

    async def prefetch(self, context: str) -> str:
        matches = await self.query_episodes(
            context,
            limit=self._prefetch_limit,
            min_relevance=self._prefetch_min_relevance,
        )
        if not matches:
            return ""
        budget_chars = self._prefetch_budget * _CHARS_PER_TOKEN
        return build_prefetch_context(matches, budget_chars)

    async def search_sessions(
        self,
        query: str,
        *,
        limit: int = 3,
    ) -> list[SessionSummary]:
        return await asyncio.to_thread(self._search_sessions_sync, query, limit)

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared_context = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared_context

    # ------------------------------------------------------------------
    # Synchronous internals (run via to_thread)
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            conn.close()

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

    def _record_episode_sync(self, episode: Episode) -> None:
        def _do_insert() -> None:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO episodes
                        (episode_id, session_id, timestamp, summary,
                         task_description, tools_used, outcome, tags, embedding)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        episode.episode_id,
                        episode.session_id,
                        episode.timestamp.isoformat(),
                        episode.summary,
                        episode.task_description,
                        json.dumps(episode.tools_used),
                        episode.outcome.value,
                        json.dumps(episode.tags),
                        json.dumps(episode.embedding) if episode.embedding else None,
                    ),
                )
                conn.commit()
                self._write_count += 1
                if self._write_count % self._checkpoint_interval == 0:
                    conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
            finally:
                conn.close()

        self._with_retry(_do_insert)

    def _query_fts_sync(self, query: str, limit: int, min_relevance: float) -> list[EpisodeMatch]:
        """FTS5-only keyword search with BM25 + recency + outcome scoring."""
        safe_query = _sanitize_fts_query(query)

        def _do_query() -> list[EpisodeMatch]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT e.*, bm25(episodes_fts) AS bm25_score
                    FROM episodes_fts
                    JOIN episodes e ON e.rowid = episodes_fts.rowid
                    WHERE episodes_fts MATCH ?
                    ORDER BY bm25(episodes_fts)
                    LIMIT ?
                    """,
                    (safe_query, limit * 3),  # fetch extra for post-filter
                ).fetchall()
            finally:
                conn.close()

            if not rows:
                return []

            # bm25 scores are negative; most negative = best match.
            bm25_scores = [float(r["bm25_score"]) for r in rows]
            max_abs = max(abs(s) for s in bm25_scores) if bm25_scores else 1.0

            matches: list[EpisodeMatch] = []
            for row, bm25 in zip(rows, bm25_scores):
                episode = _row_to_episode(row)
                score = _combined_score(
                    bm25,
                    max_abs,
                    episode.timestamp,
                    episode.outcome,
                    self._recency_half_life_days,
                )
                if score >= min_relevance:
                    matches.append(EpisodeMatch(episode=episode, relevance=score))

            matches.sort(key=lambda m: m.relevance, reverse=True)
            return matches[:limit]

        return self._with_retry(_do_query)

    def _load_fts_episodes_sync(self, query: str, limit: int) -> list[tuple[Episode, float]]:
        """Return FTS5 candidates as (episode, bm25_score) pairs."""
        safe_query = _sanitize_fts_query(query)

        def _do_query() -> list[tuple[Episode, float]]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT e.*, bm25(episodes_fts) AS bm25_score
                    FROM episodes_fts
                    JOIN episodes e ON e.rowid = episodes_fts.rowid
                    WHERE episodes_fts MATCH ?
                    ORDER BY bm25(episodes_fts)
                    LIMIT ?
                    """,
                    (safe_query, limit),
                ).fetchall()
            finally:
                conn.close()

            return [(_row_to_episode(r), float(r["bm25_score"])) for r in rows]

        return self._with_retry(_do_query)

    def _load_embedded_episodes_sync(self, limit: int) -> list[Episode]:
        """Load episodes that have a stored embedding vector."""

        def _do_load() -> list[Episode]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT * FROM episodes
                    WHERE embedding IS NOT NULL
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            finally:
                conn.close()

            return [_row_to_episode(r) for r in rows]

        return self._with_retry(_do_load)

    async def _query_hybrid(
        self,
        query: str,
        *,
        limit: int,
        min_relevance: float,
    ) -> list[EpisodeMatch]:
        """Hybrid retrieval: FTS5 + semantic cosine similarity merged via RRF.

        Steps:
        1. FTS5 → top-(limit*3) keyword candidates
        2. Embed *query*, compute cosine similarity against episodes with stored
           embeddings (up to ``semantic_candidate_limit`` most recent)
        3. Build RRF ranking from both lists
        4. Apply recency decay × outcome weight to normalised RRF score
        5. Filter by *min_relevance* and return top *limit* matches
        """
        fts_pairs = await asyncio.to_thread(self._load_fts_episodes_sync, query, limit * 3)
        semantic_episodes = await asyncio.to_thread(
            self._load_embedded_episodes_sync, self._semantic_candidate_limit
        )

        # Embed query and compute cosine similarities.
        assert self._embedding_port is not None
        if semantic_episodes:
            query_vec = await self._embedding_port.embed(query)
            sem_scored: list[tuple[Episode, float]] = []
            for ep in semantic_episodes:
                if ep.embedding:
                    sim = cosine_similarity(query_vec, ep.embedding)
                    sem_scored.append((ep, sim))
            sem_scored.sort(key=lambda x: x[1], reverse=True)
            sem_scored = sem_scored[: limit * 3]
        else:
            sem_scored = []

        # Build episode pool (union of both candidate sets).
        all_episodes: dict[str, Episode] = {}
        for ep, _ in fts_pairs:
            all_episodes[ep.episode_id] = ep
        for ep, _ in sem_scored:
            all_episodes.setdefault(ep.episode_id, ep)

        if not all_episodes:
            return []

        fts_ranking = [ep.episode_id for ep, _ in fts_pairs]
        sem_ranking = [ep.episode_id for ep, _ in sem_scored]

        rrf_scores = reciprocal_rank_fusion(
            [fts_ranking, sem_ranking] if sem_ranking else [fts_ranking],
            k=self._rrf_k,
        )

        # Normalise RRF to [0,1] and apply recency + outcome weighting.
        max_rrf = max(rrf_scores.values()) if rrf_scores else 1.0

        matches: list[EpisodeMatch] = []
        for episode_id, rrf_score in rrf_scores.items():
            ep = all_episodes[episode_id]
            normalised = rrf_score / max_rrf
            recency = _recency_score(ep.timestamp, self._recency_half_life_days)
            weight = _OUTCOME_WEIGHTS.get(ep.outcome, 0.5)
            combined = normalised * recency * weight
            if combined >= min_relevance:
                matches.append(EpisodeMatch(episode=ep, relevance=combined))

        matches.sort(key=lambda m: m.relevance, reverse=True)
        return matches[:limit]

    def _search_sessions_sync(self, query: str, limit: int) -> list[SessionSummary]:
        safe_query = _sanitize_fts_query(query)

        def _do_search() -> list[SessionSummary]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT e.*
                    FROM episodes_fts
                    JOIN episodes e ON e.rowid = episodes_fts.rowid
                    WHERE episodes_fts MATCH ?
                    ORDER BY bm25(episodes_fts)
                    LIMIT ?
                    """,
                    (safe_query, self._session_search_truncate_chars // _AVG_EPISODE_CHARS),
                ).fetchall()
            finally:
                conn.close()

            if not rows:
                return []

            episodes = [_row_to_episode(row) for row in rows]
            return build_session_summaries(episodes, limit, self._session_search_truncate_chars)

        return self._with_retry(_do_search)
