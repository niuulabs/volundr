"""SQLite-backed search adapter using FTS5 and optional embedding similarity.

When an ``embed_fn`` is provided at construction the adapter uses *hybrid
retrieval*:

1. FTS5 keyword search → top-K BM25 candidates
2. Cosine similarity on stored document embeddings → semantic candidates
3. Reciprocal Rank Fusion (RRF) to merge both ranking lists

Without ``embed_fn`` the adapter falls back to FTS5-only search.

The adapter maintains its own tables (``search_index`` and
``search_index_fts``) inside the given SQLite file and co-exists safely with
other tables in the same database.

Retry strategy: up to ``max_retries`` attempts on "database is locked" errors
with random jitter in ``[min_jitter_ms, max_jitter_ms]`` between attempts.
WAL passive checkpoint fires every ``checkpoint_interval`` writes.
"""

from __future__ import annotations

import asyncio
import json
import random
import sqlite3
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from niuu.adapters.search.rrf import cosine_similarity, reciprocal_rank_fusion
from niuu.ports.search import SearchPort, SearchResult

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS search_index (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    metadata    TEXT NOT NULL,
    embedding   TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
    content,
    content=search_index,
    content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS search_index_ai
AFTER INSERT ON search_index BEGIN
    INSERT INTO search_index_fts(rowid, content)
    VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS search_index_ad
AFTER DELETE ON search_index BEGIN
    INSERT INTO search_index_fts(search_index_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS search_index_au
AFTER UPDATE ON search_index BEGIN
    INSERT INTO search_index_fts(search_index_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO search_index_fts(rowid, content)
    VALUES (new.rowid, new.content);
END;
"""

# Default RRF smoothing constant.
_DEFAULT_RRF_K = 60

# How many recent embedded documents to consider for semantic search.
_DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sanitize_fts_query(query: str) -> str:
    """Escape FTS5 special characters and return a safe MATCH expression.

    Each whitespace-delimited token is wrapped in double quotes so that FTS5
    operators (AND, OR, NOT, -, *, ^) and hyphenated terms are treated as
    literals rather than syntax.
    """
    tokens = query.split()
    if not tokens:
        return '""'
    sanitized = []
    for token in tokens:
        escaped = token.replace('"', '""')
        sanitized.append(f'"{escaped}"')
    return " ".join(sanitized)


def _row_to_result(row: sqlite3.Row, score: float) -> SearchResult:
    metadata: dict[str, Any] = json.loads(row["metadata"])
    return SearchResult(
        id=row["id"],
        content=row["content"],
        score=score,
        metadata=metadata,
    )


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class SqliteSearchAdapter(SearchPort):
    """Full-text and semantic search backed by a local SQLite database.

    Uses FTS5 for keyword search with BM25 ranking.  When *embed_fn* is
    supplied, hybrid retrieval is used (FTS5 + cosine similarity merged via
    RRF).

    Args:
        path: Path to the SQLite database file (expanded via ``Path.expanduser``).
        embed_fn: Async callable that maps a text string to its embedding
            vector.  When provided, documents are embedded at index time and
            queries use hybrid retrieval.  When ``None``, FTS5-only search is
            used.
        rrf_k: RRF smoothing constant (default 60).
        semantic_candidate_limit: Maximum number of embedded documents to
            consider for cosine similarity at query time.
        max_retries: Maximum retry attempts on "database is locked" errors.
        min_jitter_ms: Minimum retry jitter in milliseconds.
        max_jitter_ms: Maximum retry jitter in milliseconds.
        checkpoint_interval: Number of writes between WAL passive checkpoints.
    """

    def __init__(
        self,
        path: str = "~/.niuu/search.db",
        *,
        embed_fn: Callable[[str], Awaitable[list[float]]] | None = None,
        rrf_k: int = _DEFAULT_RRF_K,
        semantic_candidate_limit: int = _DEFAULT_SEMANTIC_CANDIDATE_LIMIT,
        max_retries: int = 15,
        min_jitter_ms: float = 20.0,
        max_jitter_ms: float = 150.0,
        checkpoint_interval: int = 50,
    ) -> None:
        self._path = Path(path).expanduser()
        self._embed_fn = embed_fn
        self._rrf_k = rrf_k
        self._semantic_candidate_limit = semantic_candidate_limit
        self._max_retries = max_retries
        self._min_jitter_ms = min_jitter_ms
        self._max_jitter_ms = max_jitter_ms
        self._checkpoint_interval = checkpoint_interval
        self._write_count = 0
        self._init_db()

    # ------------------------------------------------------------------
    # SearchPort implementation
    # ------------------------------------------------------------------

    async def index(
        self,
        id: str,
        content: str,
        metadata: dict[str, Any],
        *,
        embedding: list[float] | None = None,
    ) -> None:
        """Index a document, computing its embedding if ``embed_fn`` is set.

        If *embedding* is supplied it is stored directly, bypassing
        ``embed_fn``.  This allows callers with pre-computed embeddings to
        avoid redundant model inference.
        """
        resolved_embedding = embedding
        if resolved_embedding is None and self._embed_fn is not None:
            resolved_embedding = await self._embed_fn(content)

        await asyncio.to_thread(self._index_sync, id, content, metadata, resolved_embedding)

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        if not query.strip():
            return []

        if self._embed_fn is not None:
            return await self._search_hybrid(query, limit=limit)
        return await asyncio.to_thread(self._search_fts_sync, query, limit)

    async def remove(self, id: str) -> None:
        await asyncio.to_thread(self._remove_sync, id)

    async def rebuild(self) -> None:
        await asyncio.to_thread(self._rebuild_sync)

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

    def _index_sync(
        self,
        id: str,
        content: str,
        metadata: dict[str, Any],
        embedding: list[float] | None,
    ) -> None:
        def _do() -> None:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO search_index (id, content, metadata, embedding)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        content   = EXCLUDED.content,
                        metadata  = EXCLUDED.metadata,
                        embedding = EXCLUDED.embedding
                    """,
                    (
                        id,
                        content,
                        json.dumps(metadata),
                        json.dumps(embedding) if embedding is not None else None,
                    ),
                )
                conn.commit()
                self._write_count += 1
                if self._write_count % self._checkpoint_interval == 0:
                    conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
            finally:
                conn.close()

        self._with_retry(_do)

    def _remove_sync(self, id: str) -> None:
        def _do() -> None:
            conn = self._connect()
            try:
                conn.execute("DELETE FROM search_index WHERE id = ?", (id,))
                conn.commit()
            finally:
                conn.close()

        self._with_retry(_do)

    def _rebuild_sync(self) -> None:
        def _do() -> None:
            conn = self._connect()
            try:
                conn.execute("INSERT INTO search_index_fts(search_index_fts) VALUES ('rebuild')")
                conn.commit()
            finally:
                conn.close()

        self._with_retry(_do)

    def _search_fts_sync(self, query: str, limit: int) -> list[SearchResult]:
        safe_query = _sanitize_fts_query(query)

        def _do() -> list[SearchResult]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT s.id, s.content, s.metadata, bm25(search_index_fts) AS bm25_score
                    FROM search_index_fts
                    JOIN search_index s ON s.rowid = search_index_fts.rowid
                    WHERE search_index_fts MATCH ?
                    ORDER BY bm25(search_index_fts)
                    LIMIT ?
                    """,
                    (safe_query, limit),
                ).fetchall()
            finally:
                conn.close()

            if not rows:
                return []

            # BM25 scores are negative; most negative = best match.
            bm25_scores = [float(r["bm25_score"]) for r in rows]
            max_abs = max(abs(s) for s in bm25_scores) if bm25_scores else 1.0

            results: list[SearchResult] = []
            for row, bm25 in zip(rows, bm25_scores):
                normalised = abs(bm25) / max_abs if max_abs > 0 else 0.0
                results.append(_row_to_result(row, normalised))

            return results

        return self._with_retry(_do)

    def _load_fts_candidates_sync(self, query: str, limit: int) -> list[tuple[str, float]]:
        """Return FTS5 candidates as (id, normalised_bm25) pairs."""
        safe_query = _sanitize_fts_query(query)

        def _do() -> list[tuple[str, float]]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT s.id, bm25(search_index_fts) AS bm25_score
                    FROM search_index_fts
                    JOIN search_index s ON s.rowid = search_index_fts.rowid
                    WHERE search_index_fts MATCH ?
                    ORDER BY bm25(search_index_fts)
                    LIMIT ?
                    """,
                    (safe_query, limit),
                ).fetchall()
            finally:
                conn.close()

            if not rows:
                return []

            bm25_scores = [float(r["bm25_score"]) for r in rows]
            max_abs = max(abs(s) for s in bm25_scores) if bm25_scores else 1.0
            return [(r["id"], abs(bm25) / max_abs) for r, bm25 in zip(rows, bm25_scores)]

        return self._with_retry(_do)

    def _load_embedded_candidates_sync(
        self, limit: int
    ) -> list[tuple[str, str, dict[str, Any], list[float]]]:
        """Load documents with stored embeddings: (id, content, metadata, embedding)."""

        def _do() -> list[tuple[str, str, dict[str, Any], list[float]]]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    """
                    SELECT id, content, metadata, embedding
                    FROM search_index
                    WHERE embedding IS NOT NULL
                    ORDER BY rowid DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            finally:
                conn.close()

            results = []
            for r in rows:
                emb = json.loads(r["embedding"])
                meta = json.loads(r["metadata"])
                results.append((r["id"], r["content"], meta, emb))
            return results

        return self._with_retry(_do)

    def _load_docs_by_ids_sync(self, ids: list[str]) -> dict[str, SearchResult]:
        """Fetch full document rows for a list of IDs."""
        if not ids:
            return {}

        placeholders = ",".join("?" for _ in ids)

        def _do() -> dict[str, SearchResult]:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT id, content, metadata FROM search_index WHERE id IN ("
                    + placeholders
                    + ")",
                    ids,
                ).fetchall()
            finally:
                conn.close()

            return {
                r["id"]: SearchResult(
                    id=r["id"],
                    content=r["content"],
                    score=0.0,
                    metadata=json.loads(r["metadata"]),
                )
                for r in rows
            }

        return self._with_retry(_do)

    async def _search_hybrid(self, query: str, *, limit: int) -> list[SearchResult]:
        """Hybrid retrieval: FTS5 + cosine similarity merged via RRF.

        Steps:
        1. FTS5 → top-(limit*3) keyword candidates (ids + normalised scores)
        2. Embed query, compute cosine similarity against embedded documents
        3. Build RRF ranking from both lists; normalise to [0, 1]
        4. Return top *limit* results ordered by RRF score
        """
        assert self._embed_fn is not None

        fts_pairs = await asyncio.to_thread(self._load_fts_candidates_sync, query, limit * 3)
        embedded_docs = await asyncio.to_thread(
            self._load_embedded_candidates_sync, self._semantic_candidate_limit
        )

        # Compute cosine similarities.
        query_vec = await self._embed_fn(query)
        sem_scored: list[tuple[str, float]] = []
        for doc_id, _content, _meta, emb in embedded_docs:
            sim = cosine_similarity(query_vec, emb)
            sem_scored.append((doc_id, sim))
        sem_scored.sort(key=lambda x: x[1], reverse=True)
        sem_scored = sem_scored[: limit * 3]

        fts_ranking = [doc_id for doc_id, _ in fts_pairs]
        sem_ranking = [doc_id for doc_id, _ in sem_scored]

        all_ids = list(dict.fromkeys(fts_ranking + sem_ranking))

        if not all_ids:
            return []

        rrf_scores = reciprocal_rank_fusion(
            [fts_ranking, sem_ranking] if sem_ranking else [fts_ranking],
            k=self._rrf_k,
        )

        max_rrf = max(rrf_scores.values()) if rrf_scores else 1.0

        # Load full docs for all candidate IDs.
        docs = await asyncio.to_thread(self._load_docs_by_ids_sync, all_ids)

        results: list[SearchResult] = []
        for doc_id, raw_score in rrf_scores.items():
            doc = docs.get(doc_id)
            if doc is None:
                continue
            doc.score = raw_score / max_rrf
            results.append(doc)

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]
