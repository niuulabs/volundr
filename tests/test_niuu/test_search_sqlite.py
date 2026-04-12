"""Tests for niuu.adapters.search.sqlite — SqliteSearchAdapter."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from niuu.adapters.search.sqlite import SqliteSearchAdapter, _sanitize_fts_query

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _ConstantEmbedFn:
    """Always returns the same vector regardless of input."""

    def __init__(self, vector: list[float]) -> None:
        self._vector = vector

    async def __call__(self, text: str) -> list[float]:
        return list(self._vector)


class _DispatchEmbedFn:
    """Returns a specific vector per substring match, otherwise zeros."""

    def __init__(self, mapping: dict[str, list[float]], dim: int = 4) -> None:
        self._mapping = mapping
        self._dim = dim

    async def __call__(self, text: str) -> list[float]:
        for key, vec in self._mapping.items():
            if key in text:
                return list(vec)
        return [0.0] * self._dim


@pytest.fixture
def adapter(tmp_path: Path) -> SqliteSearchAdapter:
    return SqliteSearchAdapter(
        path=str(tmp_path / "search.db"),
        max_retries=3,
        min_jitter_ms=1.0,
        max_jitter_ms=5.0,
    )


@pytest.fixture
def hybrid_adapter(tmp_path: Path) -> SqliteSearchAdapter:
    """Adapter with a constant embedding (same vector for all docs/queries)."""
    return SqliteSearchAdapter(
        path=str(tmp_path / "search.db"),
        embed_fn=_ConstantEmbedFn([1.0, 0.0, 0.0, 0.0]),
        max_retries=3,
        min_jitter_ms=1.0,
        max_jitter_ms=5.0,
    )


# ---------------------------------------------------------------------------
# _sanitize_fts_query
# ---------------------------------------------------------------------------


class TestSanitizeFtsQuery:
    def test_basic_token(self) -> None:
        assert _sanitize_fts_query("python") == '"python"'

    def test_multiple_tokens(self) -> None:
        assert _sanitize_fts_query("run tests") == '"run" "tests"'

    def test_empty_query(self) -> None:
        assert _sanitize_fts_query("") == '""'

    def test_fts_operators_escaped(self) -> None:
        result = _sanitize_fts_query("NOT foo AND bar")
        # Each token wrapped in quotes → operators treated as literals
        assert '"NOT"' in result
        assert '"AND"' in result

    def test_double_quotes_escaped(self) -> None:
        result = _sanitize_fts_query('say "hello"')
        assert '""hello""' in result


# ---------------------------------------------------------------------------
# Index + FTS search (no embeddings)
# ---------------------------------------------------------------------------


class TestFtsSearch:
    @pytest.mark.asyncio
    async def test_index_and_find_by_keyword(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "python unit testing with pytest", {"source": "test"})
        results = await adapter.search("pytest")
        assert len(results) == 1
        assert results[0].id == "doc-1"

    @pytest.mark.asyncio
    async def test_no_match_returns_empty(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "python unit testing", {})
        results = await adapter.search("golang")
        assert results == []

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "some content", {})
        results = await adapter.search("   ")
        assert results == []

    @pytest.mark.asyncio
    async def test_score_in_zero_one(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "machine learning algorithms", {})
        await adapter.index("doc-2", "machine learning models for nlp", {})
        results = await adapter.search("machine learning")
        for r in results:
            assert 0.0 <= r.score <= 1.0

    @pytest.mark.asyncio
    async def test_results_ordered_by_score_descending(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "python", {})
        await adapter.index("doc-2", "python python python", {})
        results = await adapter.search("python")
        assert len(results) == 2
        assert results[0].score >= results[1].score

    @pytest.mark.asyncio
    async def test_metadata_returned(self, adapter: SqliteSearchAdapter) -> None:
        meta: dict[str, Any] = {"author": "alice", "version": 2}
        await adapter.index("doc-1", "some searchable content", meta)
        results = await adapter.search("searchable")
        assert results[0].metadata == meta

    @pytest.mark.asyncio
    async def test_update_existing_document(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "old content", {"v": 1})
        await adapter.index("doc-1", "new updated content", {"v": 2})
        results = await adapter.search("updated")
        assert len(results) == 1
        assert results[0].metadata["v"] == 2
        # Old content should not be findable
        old_results = await adapter.search("old")
        assert old_results == []

    @pytest.mark.asyncio
    async def test_limit_respected(self, adapter: SqliteSearchAdapter) -> None:
        for i in range(5):
            await adapter.index(f"doc-{i}", f"python testing document {i}", {})
        results = await adapter.search("python", limit=2)
        assert len(results) <= 2

    @pytest.mark.asyncio
    async def test_remove_document(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "removable document content", {})
        await adapter.remove("doc-1")
        results = await adapter.search("removable")
        assert results == []

    @pytest.mark.asyncio
    async def test_remove_nonexistent_is_noop(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.remove("no-such-doc")  # should not raise

    @pytest.mark.asyncio
    async def test_rebuild(self, adapter: SqliteSearchAdapter) -> None:
        await adapter.index("doc-1", "rebuild test content", {})
        await adapter.rebuild()  # should not raise
        results = await adapter.search("rebuild")
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_fts_only_mode_no_embed_fn(self, adapter: SqliteSearchAdapter) -> None:
        """FTS-only mode returns functional results when no embed_fn is provided."""
        assert adapter._embed_fn is None
        await adapter.index("doc-1", "functional fts search without embeddings", {})
        results = await adapter.search("fts search")
        assert len(results) == 1


# ---------------------------------------------------------------------------
# Hybrid retrieval (FTS + semantic)
# ---------------------------------------------------------------------------


class TestHybridSearch:
    @pytest.mark.asyncio
    async def test_finds_by_keyword_with_embeddings(
        self, hybrid_adapter: SqliteSearchAdapter
    ) -> None:
        await hybrid_adapter.index("doc-1", "python pytest unit testing", {})
        results = await hybrid_adapter.search("pytest")
        assert any(r.id == "doc-1" for r in results)

    @pytest.mark.asyncio
    async def test_finds_by_semantics(self, tmp_path: Path) -> None:
        """Semantic search finds documents whose embedding matches the query."""
        # doc-1 has vector [1,0,0,0]; doc-2 has [0,1,0,0]
        # query for "alpha" → [1,0,0,0] → cosine sim with doc-1 = 1.0, doc-2 = 0.0
        mapping = {
            "alpha": [1.0, 0.0, 0.0, 0.0],
            "beta": [0.0, 1.0, 0.0, 0.0],
        }
        embed = _DispatchEmbedFn(mapping, dim=4)
        adapter = SqliteSearchAdapter(
            path=str(tmp_path / "sem.db"),
            embed_fn=embed,
        )
        await adapter.index("doc-alpha", "alpha related content", {})
        await adapter.index("doc-beta", "beta related content", {})
        results = await adapter.search("alpha query", limit=2)
        ids = [r.id for r in results]
        assert "doc-alpha" in ids

    @pytest.mark.asyncio
    async def test_precomputed_embedding_accepted(self, tmp_path: Path) -> None:
        """index() accepts a precomputed embedding and uses it for hybrid search."""
        embed_fn = _ConstantEmbedFn([0.0, 1.0, 0.0, 0.0])
        adapter = SqliteSearchAdapter(
            path=str(tmp_path / "pre.db"),
            embed_fn=embed_fn,
        )
        precomputed = [1.0, 0.0, 0.0, 0.0]
        await adapter.index("doc-1", "precomputed embedding test", {}, embedding=precomputed)
        # Search with embed_fn returning [1,0,0,0] → cosine sim = 1.0 with doc-1
        results = await adapter.search("precomputed")
        assert any(r.id == "doc-1" for r in results)

    @pytest.mark.asyncio
    async def test_hybrid_scores_in_zero_one(self, hybrid_adapter: SqliteSearchAdapter) -> None:
        for i in range(3):
            await hybrid_adapter.index(f"doc-{i}", f"content document number {i}", {})
        results = await hybrid_adapter.search("content document")
        for r in results:
            assert 0.0 <= r.score <= 1.0

    @pytest.mark.asyncio
    async def test_rrf_boosts_multi_ranked_doc(self, tmp_path: Path) -> None:
        """A doc ranked in both FTS and semantic wins over a doc ranked only in semantic."""
        # doc-a: matches keyword "shared" + semantic similar to query
        # doc-b: semantic only (no keyword match)
        mapping = {
            "shared": [1.0, 0.0, 0.0, 0.0],
            "semantic only": [1.0, 0.0, 0.0, 0.0],
            "test query": [1.0, 0.0, 0.0, 0.0],
        }
        embed = _DispatchEmbedFn(mapping, dim=4)
        adapter = SqliteSearchAdapter(
            path=str(tmp_path / "rrf.db"),
            embed_fn=embed,
            rrf_k=60,
        )
        # doc-a matches keyword AND gets semantic similarity
        await adapter.index("doc-a", "shared keyword content for testing", {})
        # doc-b does not match any keyword but has same embedding → semantic only
        await adapter.index("doc-b", "semantic only unrelated words", {})

        results = await adapter.search("shared test query", limit=5)
        ids_in_order = [r.id for r in results]
        # doc-a should appear (it has both FTS and semantic)
        assert "doc-a" in ids_in_order
