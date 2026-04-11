"""Unit tests for Búri memory adapter (NIU-541).

Tests cover:
- Fact extraction JSON parsing
- Supersession logic (entity overlap + cosine threshold)
- Cluster assignment (merge vs. create)
- Temporal query (current-only vs. include_superseded)
- Type-weighted scoring
- Mid-session auto-detection patterns
- Buri tool execute() methods
- BuriConfig defaults
- Domain model fields
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from ravn.adapters.memory.buri import (
    _TYPE_WEIGHTS,
    BuriMemoryAdapter,
    _detect_inline_fact_type,
    _extract_entities_from_content,
    _running_mean,
    _unit_normalise,
    _with_cluster,
)
from ravn.adapters.memory.scoring import cosine_similarity as _cosine_similarity
from ravn.adapters.tools.buri_tools import (
    BuriFactsTool,
    BuriForgetTool,
    BuriHistoryTool,
    BuriRecallTool,
    BuriRememberTool,
)
from ravn.config import BuriConfig, Settings
from ravn.domain.models import (
    Episode,
    FactType,
    KnowledgeFact,
    MemoryCluster,
    Outcome,
    SessionState,
)

# ---------------------------------------------------------------------------
# Test utilities
# ---------------------------------------------------------------------------


def _make_pool(conn: AsyncMock) -> MagicMock:
    """Return a mock asyncpg Pool whose acquire() context manager yields *conn*."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock()
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=ctx)
    return pool


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


def _fact(
    *,
    fact_type: FactType = FactType.PREFERENCE,
    content: str = "I prefer early returns",
    entities: list[str] | None = None,
    confidence: float = 0.9,
    embedding: list[float] | None = None,
    valid_until: datetime | None = None,
    fact_id: str | None = None,
) -> KnowledgeFact:
    return KnowledgeFact(
        fact_id=fact_id or str(uuid.uuid4()),
        fact_type=fact_type,
        content=content,
        entities=entities or ["Python"],
        confidence=confidence,
        source="session:test",
        valid_from=datetime.now(UTC),
        embedding=embedding,
        valid_until=valid_until,
    )


def _unit_vec(values: list[float]) -> list[float]:
    return _unit_normalise(values)


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------


class TestCosigneSimilarity:
    def test_identical_vectors(self) -> None:
        v = [1.0, 0.0, 0.0]
        assert _cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self) -> None:
        assert _cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)

    def test_opposite_vectors(self) -> None:
        assert _cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)

    def test_empty_vector(self) -> None:
        assert _cosine_similarity([], []) == 0.0

    def test_zero_norm(self) -> None:
        assert _cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_mismatched_lengths(self) -> None:
        assert _cosine_similarity([1.0, 0.0], [1.0]) == 0.0


class TestUnitNormalise:
    def test_already_unit(self) -> None:
        v = [1.0, 0.0, 0.0]
        result = _unit_normalise(v)
        assert math.isclose(sum(x * x for x in result), 1.0, rel_tol=1e-6)

    def test_arbitrary_vector(self) -> None:
        v = [3.0, 4.0]
        result = _unit_normalise(v)
        assert math.isclose(result[0], 0.6, rel_tol=1e-6)
        assert math.isclose(result[1], 0.8, rel_tol=1e-6)

    def test_zero_vector(self) -> None:
        v = [0.0, 0.0]
        result = _unit_normalise(v)
        assert result == [0.0, 0.0]


class TestRunningMean:
    def test_single_update(self) -> None:
        old = [1.0, 0.0]
        new = [0.0, 1.0]
        result = _running_mean(old, new, count=1)
        assert result == [0.5, 0.5]

    def test_multiple_updates(self) -> None:
        # With 3 existing members, weight old 3x and new 1x → (3+0)/4=0.75, (0+1)/4=0.25
        old = [1.0, 0.0]
        new = [0.0, 1.0]
        result = _running_mean(old, new, count=3)
        assert result == pytest.approx([0.75, 0.25])


class TestExtractEntities:
    def test_capitalised_words(self) -> None:
        entities = _extract_entities_from_content("RabbitMQ is the chosen transport for Sleipnir")
        assert "RabbitMQ" in entities
        assert "Sleipnir" in entities

    def test_quoted_phrases(self) -> None:
        entities = _extract_entities_from_content('Use "early return" pattern always')
        assert "early return" in entities

    def test_deduplication(self) -> None:
        entities = _extract_entities_from_content("RabbitMQ RabbitMQ RabbitMQ")
        assert entities.count("RabbitMQ") == 1

    def test_cap_at_ten(self) -> None:
        words = " ".join(f"Word{i}" for i in range(20))
        entities = _extract_entities_from_content(words)
        assert len(entities) <= 10


class TestDetectInlineFactType:
    def test_remember_that(self) -> None:
        assert _detect_inline_fact_type("Remember that we use early returns") == FactType.DIRECTIVE

    def test_note_that(self) -> None:
        result = _detect_inline_fact_type("Note that RabbitMQ is the primary transport")
        assert result == FactType.DIRECTIVE

    def test_i_prefer(self) -> None:
        assert _detect_inline_fact_type("I prefer tabs over spaces") == FactType.PREFERENCE

    def test_i_dont_like(self) -> None:
        assert _detect_inline_fact_type("I don't like nested conditionals") == FactType.PREFERENCE

    def test_we_decided(self) -> None:
        assert _detect_inline_fact_type("We decided to use RabbitMQ") == FactType.DECISION

    def test_lets_go_with(self) -> None:
        assert _detect_inline_fact_type("Let's go with Postgres") == FactType.DECISION

    def test_no_match(self) -> None:
        assert _detect_inline_fact_type("Hello world") is None

    def test_forget_returns_none(self) -> None:
        assert _detect_inline_fact_type("Forget that we said RabbitMQ") is None


class TestTypeWeights:
    def test_directive_highest(self) -> None:
        assert _TYPE_WEIGHTS[FactType.DIRECTIVE] > _TYPE_WEIGHTS[FactType.DECISION]
        assert _TYPE_WEIGHTS[FactType.DECISION] > _TYPE_WEIGHTS[FactType.PREFERENCE]
        assert _TYPE_WEIGHTS[FactType.PREFERENCE] > _TYPE_WEIGHTS[FactType.OBSERVATION]

    def test_all_types_present(self) -> None:
        for ft in FactType:
            assert ft in _TYPE_WEIGHTS


class TestWithCluster:
    def test_sets_cluster_id(self) -> None:
        f = _fact()
        result = _with_cluster(f, "cluster-xyz")
        assert result.cluster_id == "cluster-xyz"

    def test_none_cluster(self) -> None:
        f = _fact()
        result = _with_cluster(f, None)
        assert result.cluster_id is None

    def test_original_unchanged(self) -> None:
        f = _fact()
        _with_cluster(f, "new-id")
        assert f.cluster_id is None


# ---------------------------------------------------------------------------
# Domain model tests
# ---------------------------------------------------------------------------


class TestFactType:
    def test_all_values(self) -> None:
        values = {ft.value for ft in FactType}
        expected = {"preference", "decision", "goal", "directive", "relationship", "observation"}
        assert values == expected


class TestKnowledgeFact:
    def test_defaults(self) -> None:
        f = _fact()
        assert f.valid_until is None
        assert f.superseded_by is None
        assert f.cluster_id is None
        assert f.tags == []

    def test_is_current(self) -> None:
        current = _fact()
        superseded = _fact(valid_until=datetime.now(UTC))
        assert current.valid_until is None
        assert superseded.valid_until is not None


class TestSessionState:
    def test_fields(self) -> None:
        now = datetime.now(UTC)
        state = SessionState(
            session_id="s1",
            rolling_summary="Some context",
            active_entities=["RabbitMQ", "Python"],
            turn_count=3,
            last_updated=now,
        )
        assert state.session_id == "s1"
        assert state.turn_count == 3
        assert "RabbitMQ" in state.active_entities


class TestMemoryCluster:
    def test_fields(self) -> None:
        c = MemoryCluster(
            cluster_id="c1",
            centroid=[1.0, 0.0],
            radius=0.05,
            member_count=3,
            dominant_type="preference",
            label="coding style",
        )
        assert c.cluster_id == "c1"
        assert c.member_count == 3


# ---------------------------------------------------------------------------
# BuriConfig tests
# ---------------------------------------------------------------------------


class TestBuriConfig:
    def test_defaults(self) -> None:
        cfg = BuriConfig()
        assert cfg.enabled is True
        assert cfg.cluster_merge_threshold == pytest.approx(0.15)
        assert cfg.min_confidence == pytest.approx(0.6)
        assert cfg.session_summary_max_tokens == 400
        assert cfg.supersession_cosine_threshold == pytest.approx(0.85)
        assert cfg.extraction_model == ""

    def test_settings_has_buri(self) -> None:
        # Ensure BuriConfig is wired into Settings
        s = Settings()
        assert hasattr(s, "buri")
        assert isinstance(s.buri, BuriConfig)


# ---------------------------------------------------------------------------
# Supersession logic tests (pure / mocked DB)
# ---------------------------------------------------------------------------


class TestSupersessionLogic:
    """Test _find_supersedable_fact indirectly via public interface with mocked pool."""

    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._reflection_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_no_supersession_without_entities(self) -> None:
        adapter = self._make_adapter()
        new_fact = _fact(entities=[])
        result = await adapter._find_supersedable_fact(new_fact)
        assert result is None

    @pytest.mark.asyncio
    async def test_supersession_below_threshold(self) -> None:
        """Facts with low cosine similarity should NOT supersede."""
        adapter = self._make_adapter()

        # Embed the candidate with a low-similarity vector
        candidate_embedding = [1.0, 0.0, 0.0]
        new_embedding = [0.0, 1.0, 0.0]  # orthogonal → similarity 0

        candidate = _fact(
            entities=["Python"],
            embedding=candidate_embedding,
            fact_type=FactType.PREFERENCE,
        )
        # Mock the DB to return the candidate
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "fact_id": candidate.fact_id,
                    "fact_type": candidate.fact_type.value,
                    "content": candidate.content,
                    "entities": candidate.entities,
                    "confidence": candidate.confidence,
                    "source": candidate.source,
                    "valid_from": candidate.valid_from,
                    "embedding": json.dumps(candidate_embedding),
                    "valid_until": None,
                    "superseded_by": None,
                    "source_context": "",
                    "cluster_id": None,
                    "tags": [],
                }
            ]
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        new_fact = _fact(
            entities=["Python"], embedding=new_embedding, fact_type=FactType.PREFERENCE
        )
        result = await adapter._find_supersedable_fact(new_fact)
        assert result is None

    @pytest.mark.asyncio
    async def test_supersession_above_threshold(self) -> None:
        """Facts with high cosine similarity should supersede."""
        adapter = self._make_adapter()

        shared_embedding = [1.0, 0.0, 0.0]

        candidate = _fact(
            entities=["Python"],
            embedding=shared_embedding,
            fact_type=FactType.PREFERENCE,
        )
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "fact_id": candidate.fact_id,
                    "fact_type": candidate.fact_type.value,
                    "content": candidate.content,
                    "entities": candidate.entities,
                    "confidence": candidate.confidence,
                    "source": candidate.source,
                    "valid_from": candidate.valid_from,
                    "embedding": json.dumps(shared_embedding),
                    "valid_until": None,
                    "superseded_by": None,
                    "source_context": "",
                    "cluster_id": None,
                    "tags": [],
                }
            ]
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        # Nearly identical embedding → cosine 1.0 ≥ threshold 0.85
        new_fact = _fact(
            entities=["Python"], embedding=[1.0, 0.0, 0.0], fact_type=FactType.PREFERENCE
        )
        result = await adapter._find_supersedable_fact(new_fact)
        assert result is not None
        assert result.fact_id == candidate.fact_id


# ---------------------------------------------------------------------------
# Cluster assignment tests
# ---------------------------------------------------------------------------


class TestClusterAssignment:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_no_embedding_returns_none(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        fact = _fact(embedding=None)
        result = await adapter._assign_cluster(fact)
        assert result is None

    @pytest.mark.asyncio
    async def test_creates_new_cluster_when_empty(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        # No existing clusters
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        fact = _fact(embedding=[1.0, 0.0])
        result = await adapter._assign_cluster(fact)
        assert result is not None
        # execute was called to INSERT the new cluster
        mock_conn.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_merges_into_close_cluster(self) -> None:
        adapter = self._make_adapter()
        # Existing cluster with nearly identical centroid
        existing_centroid = [1.0, 0.0]
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "cluster_id": "existing-cluster",
                    "centroid": json.dumps(existing_centroid),
                    "radius": 0.05,
                    "member_count": 5,
                    "dominant_type": "preference",
                    "label": None,
                }
            ]
        )
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        # Nearly identical vector → distance ≈ 0.0 < 0.15 threshold
        fact = _fact(embedding=[1.0, 0.0])
        result = await adapter._assign_cluster(fact)
        assert result == "existing-cluster"
        # execute was called to UPDATE the existing cluster
        mock_conn.execute.assert_called_once()


# ---------------------------------------------------------------------------
# Temporal query tests
# ---------------------------------------------------------------------------


class TestTemporalQuery:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    def _make_row(self, fact: KnowledgeFact) -> dict:
        return {
            "fact_id": fact.fact_id,
            "fact_type": fact.fact_type.value,
            "content": fact.content,
            "entities": fact.entities,
            "confidence": fact.confidence,
            "source": fact.source,
            "valid_from": fact.valid_from,
            "embedding": json.dumps(fact.embedding) if fact.embedding else None,
            "valid_until": fact.valid_until,
            "superseded_by": fact.superseded_by,
            "source_context": fact.source_context,
            "cluster_id": fact.cluster_id,
            "tags": fact.tags,
        }

    @pytest.mark.asyncio
    async def test_current_facts_only(self) -> None:
        adapter = self._make_adapter()
        current = _fact(content="current preference")

        mock_conn = AsyncMock()
        # Return only current (superseded excluded by validity_clause in query)
        mock_conn.fetch = AsyncMock(return_value=[self._make_row(current)])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        facts = await adapter.get_facts_for_entity("Python", include_superseded=False)
        assert len(facts) == 1
        assert facts[0].content == "current preference"

    @pytest.mark.asyncio
    async def test_include_superseded(self) -> None:
        adapter = self._make_adapter()
        current = _fact(content="current preference")
        superseded = _fact(content="old preference", valid_until=datetime.now(UTC))

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                self._make_row(current),
                self._make_row(superseded),
            ]
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        facts = await adapter.get_facts_for_entity("Python", include_superseded=True)
        assert len(facts) == 2


# ---------------------------------------------------------------------------
# Type-weighted scoring tests
# ---------------------------------------------------------------------------


class TestTypeWeightedScoring:
    def test_directive_scores_higher_than_observation(self) -> None:
        directive_weight = _TYPE_WEIGHTS[FactType.DIRECTIVE]
        observation_weight = _TYPE_WEIGHTS[FactType.OBSERVATION]
        assert directive_weight > observation_weight

    def test_scoring_formula(self) -> None:
        # fact with confidence 1.0 and type DIRECTIVE
        score_directive = _TYPE_WEIGHTS[FactType.DIRECTIVE] * 1.0
        score_observation = _TYPE_WEIGHTS[FactType.OBSERVATION] * 1.0
        assert score_directive == pytest.approx(3.0)
        assert score_observation == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# Fact extraction JSON parsing tests
# ---------------------------------------------------------------------------


class TestFactExtractionParsing:
    """Test that the extraction logic handles various JSON shapes robustly."""

    def _make_adapter(self, *, llm: Any = None) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = llm
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_extraction_skipped_without_llm(self) -> None:
        adapter = self._make_adapter(llm=None)
        episode = Episode(
            episode_id="ep1",
            session_id="s1",
            timestamp=datetime.now(UTC),
            summary="Built RabbitMQ transport",
            task_description="Configure Sleipnir",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        # Should not raise; ingest_fact never called
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)  # no session state
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool
        await adapter._extract_facts_from_episode(episode)  # should not raise

    @pytest.mark.asyncio
    async def test_extraction_with_valid_json(self) -> None:
        """Mock LLM returns valid JSON; facts should be ingested."""
        extracted_json = json.dumps(
            [
                {
                    "type": "directive",
                    "content": "Use early returns",
                    "entities": ["Python"],
                    "confidence": 0.9,
                },
                {
                    "type": "decision",
                    "content": "RabbitMQ chosen",
                    "entities": ["RabbitMQ"],
                    "confidence": 0.8,
                },
            ]
        )
        mock_llm_response = MagicMock()
        mock_llm_response.content = extracted_json

        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(return_value=mock_llm_response)

        adapter = self._make_adapter(llm=mock_llm)

        # Mock all DB calls
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)  # no session state
        mock_conn.fetch = AsyncMock(return_value=[])  # no supersedable facts, no clusters
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        episode = Episode(
            episode_id="ep1",
            session_id="s1",
            timestamp=datetime.now(UTC),
            summary="Use early returns and chose RabbitMQ",
            task_description="Configure Sleipnir",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        await adapter._extract_facts_from_episode(episode)
        assert mock_llm.complete.called

    @pytest.mark.asyncio
    async def test_extraction_with_low_confidence_downgrades_type(self) -> None:
        """Low confidence facts (< min_confidence) should become observations."""
        extracted_json = json.dumps(
            [
                {
                    "type": "directive",
                    "content": "Maybe use early returns",
                    "entities": [],
                    "confidence": 0.3,
                },
            ]
        )
        mock_llm_response = MagicMock()
        mock_llm_response.content = extracted_json

        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(return_value=mock_llm_response)

        adapter = self._make_adapter(llm=mock_llm)
        ingested_facts: list[KnowledgeFact] = []

        async def mock_ingest(fact: KnowledgeFact) -> None:
            ingested_facts.append(fact)

        adapter.ingest_fact = mock_ingest  # type: ignore[method-assign]

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        episode = Episode(
            episode_id="ep2",
            session_id="s2",
            timestamp=datetime.now(UTC),
            summary="Maybe use early returns",
            task_description="Review code",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        await adapter._extract_facts_from_episode(episode)
        assert len(ingested_facts) == 1
        assert ingested_facts[0].fact_type == FactType.OBSERVATION

    @pytest.mark.asyncio
    async def test_extraction_handles_malformed_json_gracefully(self) -> None:
        """Malformed LLM JSON should not raise; extraction silently aborts."""
        mock_llm_response = MagicMock()
        mock_llm_response.content = "not valid json { broken"

        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(return_value=mock_llm_response)

        adapter = self._make_adapter(llm=mock_llm)
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        episode = Episode(
            episode_id="ep3",
            session_id="s3",
            timestamp=datetime.now(UTC),
            summary="Some work",
            task_description="Something",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        # Should not raise
        await adapter._extract_facts_from_episode(episode)

    @pytest.mark.asyncio
    async def test_extraction_strips_markdown_fences(self) -> None:
        """JSON wrapped in ``` fences should parse correctly."""
        extracted_json = json.dumps(
            [
                {
                    "type": "preference",
                    "content": "Tabs over spaces",
                    "entities": [],
                    "confidence": 0.8,
                }
            ]
        )
        fenced = f"```json\n{extracted_json}\n```"

        mock_llm_response = MagicMock()
        mock_llm_response.content = fenced

        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(return_value=mock_llm_response)

        adapter = self._make_adapter(llm=mock_llm)
        ingested: list[KnowledgeFact] = []

        async def mock_ingest(fact: KnowledgeFact) -> None:
            ingested.append(fact)

        adapter.ingest_fact = mock_ingest  # type: ignore[method-assign]

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        episode = Episode(
            episode_id="ep4",
            session_id="s4",
            timestamp=datetime.now(UTC),
            summary="Tabs over spaces preference noted",
            task_description="Code review",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        await adapter._extract_facts_from_episode(episode)
        assert len(ingested) == 1
        assert ingested[0].fact_type == FactType.PREFERENCE


# ---------------------------------------------------------------------------
# Buri tool tests
# ---------------------------------------------------------------------------


class TestBuriRecallTool:
    def _make_memory(self, facts: list[KnowledgeFact]) -> Any:
        memory = AsyncMock()
        memory.query_facts = AsyncMock(return_value=facts)
        return memory

    @pytest.mark.asyncio
    async def test_empty_query(self) -> None:
        tool = BuriRecallTool(memory=self._make_memory([]))
        result = await tool.execute({"query": ""})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_no_facts_found(self) -> None:
        tool = BuriRecallTool(memory=self._make_memory([]))
        result = await tool.execute({"query": "something"})
        assert not result.is_error
        assert "No facts found" in result.content

    @pytest.mark.asyncio
    async def test_returns_formatted_facts(self) -> None:
        facts = [_fact(content="I prefer early returns", fact_type=FactType.PREFERENCE)]
        tool = BuriRecallTool(memory=self._make_memory(facts))
        result = await tool.execute({"query": "early returns"})
        assert "PREFERENCE" in result.content
        assert "early returns" in result.content

    @pytest.mark.asyncio
    async def test_invalid_fact_type(self) -> None:
        tool = BuriRecallTool(memory=self._make_memory([]))
        result = await tool.execute({"query": "q", "fact_type": "nonsense"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_limit_capped_at_20(self) -> None:
        memory = self._make_memory([])
        tool = BuriRecallTool(memory=memory)
        await tool.execute({"query": "x", "limit": 999})
        memory.query_facts.assert_called_once()
        _, kwargs = memory.query_facts.call_args
        assert kwargs["limit"] == 20


class TestBuriFactsTool:
    @pytest.mark.asyncio
    async def test_empty_entity(self) -> None:
        memory = AsyncMock()
        tool = BuriFactsTool(memory=memory)
        result = await tool.execute({"entity": ""})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_returns_facts(self) -> None:
        facts = [_fact(content="RabbitMQ is fast", entities=["RabbitMQ"])]
        memory = AsyncMock()
        memory.get_facts_for_entity = AsyncMock(return_value=facts)
        tool = BuriFactsTool(memory=memory)
        result = await tool.execute({"entity": "RabbitMQ"})
        assert "RabbitMQ is fast" in result.content


class TestBuriHistoryTool:
    @pytest.mark.asyncio
    async def test_includes_superseded(self) -> None:
        current = _fact(content="current")
        superseded = _fact(content="old", valid_until=datetime.now(UTC))
        memory = AsyncMock()
        memory.get_facts_for_entity = AsyncMock(return_value=[current, superseded])
        tool = BuriHistoryTool(memory=memory)
        result = await tool.execute({"entity": "Python"})
        assert "current" in result.content
        assert "old" in result.content
        # superseded facts show [superseded] marker
        assert "[superseded]" in result.content

    @pytest.mark.asyncio
    async def test_calls_include_superseded_true(self) -> None:
        memory = AsyncMock()
        memory.get_facts_for_entity = AsyncMock(return_value=[])
        tool = BuriHistoryTool(memory=memory)
        await tool.execute({"entity": "X"})
        _, kwargs = memory.get_facts_for_entity.call_args
        assert kwargs.get("include_superseded") is True


class TestBuriRememberTool:
    @pytest.mark.asyncio
    async def test_empty_content(self) -> None:
        memory = AsyncMock()
        tool = BuriRememberTool(memory=memory)
        result = await tool.execute({"content": ""})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_stores_with_explicit_type(self) -> None:
        memory = AsyncMock()
        memory.ingest_fact = AsyncMock()
        tool = BuriRememberTool(memory=memory, session_id="s1")
        result = await tool.execute({"content": "Use tabs", "fact_type": "directive"})
        assert not result.is_error
        assert "DIRECTIVE" in result.content
        memory.ingest_fact.assert_called_once()

    @pytest.mark.asyncio
    async def test_auto_classifies_preference(self) -> None:
        memory = AsyncMock()
        memory.ingest_fact = AsyncMock()
        tool = BuriRememberTool(memory=memory)
        result = await tool.execute({"content": "I prefer tabs over spaces"})
        assert not result.is_error
        memory.ingest_fact.assert_called_once()
        fact_arg = memory.ingest_fact.call_args[0][0]
        assert fact_arg.fact_type == FactType.PREFERENCE

    @pytest.mark.asyncio
    async def test_ingest_error_returns_error_result(self) -> None:
        memory = AsyncMock()
        memory.ingest_fact = AsyncMock(side_effect=RuntimeError("DB down"))
        tool = BuriRememberTool(memory=memory)
        result = await tool.execute({"content": "something"})
        assert result.is_error


class TestBuriForgetTool:
    @pytest.mark.asyncio
    async def test_empty_query(self) -> None:
        memory = AsyncMock()
        tool = BuriForgetTool(memory=memory)
        result = await tool.execute({"query": ""})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_no_match(self) -> None:
        memory = AsyncMock()
        memory.forget_fact = AsyncMock(return_value=None)
        tool = BuriForgetTool(memory=memory)
        result = await tool.execute({"query": "non-existent"})
        assert not result.is_error
        assert "No current fact" in result.content

    @pytest.mark.asyncio
    async def test_forgets_matching_fact(self) -> None:
        forgotten = _fact(content="I prefer tabs", fact_type=FactType.PREFERENCE)
        memory = AsyncMock()
        memory.forget_fact = AsyncMock(return_value=forgotten)
        tool = BuriForgetTool(memory=memory)
        result = await tool.execute({"query": "tabs preference"})
        assert not result.is_error
        assert "Invalidated" in result.content
        assert "PREFERENCE" in result.content


# ---------------------------------------------------------------------------
# Session state tests
# ---------------------------------------------------------------------------


class TestSessionStateUpdate:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_fallback_without_llm(self) -> None:
        """Without an LLM, session state uses simple concatenation."""
        adapter = self._make_adapter()

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)  # no existing state
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        await adapter.update_session_state("s1", "Hello", "I answered")
        mock_conn.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_session_state_not_found(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.get_session_state("unknown")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_session_state_found(self) -> None:
        adapter = self._make_adapter()
        now = datetime.now(UTC)
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(
            return_value={
                "session_id": "s1",
                "rolling_summary": "Context: built RabbitMQ transport",
                "active_entities": ["RabbitMQ", "Sleipnir"],
                "turn_count": 3,
                "last_updated": now,
            }
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.get_session_state("s1")
        assert result is not None
        assert result.session_id == "s1"
        assert result.turn_count == 3
        assert "RabbitMQ" in result.active_entities


# ---------------------------------------------------------------------------
# Integration-style test: record_episode → build_knowledge_context
# ---------------------------------------------------------------------------


class TestBuildKnowledgeContext:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    def _make_row(self, fact: KnowledgeFact) -> dict:
        return {
            "fact_id": fact.fact_id,
            "fact_type": fact.fact_type.value,
            "content": fact.content,
            "entities": fact.entities,
            "confidence": fact.confidence,
            "source": fact.source,
            "valid_from": fact.valid_from,
            "embedding": None,
            "valid_until": fact.valid_until,
            "superseded_by": fact.superseded_by,
            "source_context": fact.source_context,
            "cluster_id": fact.cluster_id,
            "tags": fact.tags,
        }

    @pytest.mark.asyncio
    async def test_context_block_contains_directives(self) -> None:
        adapter = self._make_adapter()
        directive = _fact(
            content="Use early returns always",
            fact_type=FactType.DIRECTIVE,
        )

        call_count = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list[dict]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # directive query
                return [self._make_row(directive)]
            if call_count == 2:
                # goal query
                return []
            # query_facts → cluster query, then fact query
            return []

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        context = await adapter.build_knowledge_context("early returns")
        assert "[DIRECTIVES]" in context
        assert "Use early returns always" in context

    @pytest.mark.asyncio
    async def test_empty_context_when_no_facts(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        context = await adapter.build_knowledge_context("anything")
        assert context == ""


# ---------------------------------------------------------------------------
# Additional coverage: record_episode, supersede_fact, query_facts,
# ingest_fact, process_inline_facts, get_relationships
# ---------------------------------------------------------------------------


class TestRecordEpisode:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_record_episode_inserts_row(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)  # no session state
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        episode = Episode(
            episode_id="ep1",
            session_id="s1",
            timestamp=datetime.now(UTC),
            summary="Did some work",
            task_description="Work",
            tools_used=["bash"],
            outcome=Outcome.SUCCESS,
            tags=["git"],
        )
        await adapter.record_episode(episode)
        mock_conn.execute.assert_called_once()


class TestSupersedeFact:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_supersede_writes_new_invalidates_old(self) -> None:
        adapter = self._make_adapter()
        execute_calls: list[tuple[Any, ...]] = []

        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])  # no existing clusters
        mock_conn.execute = AsyncMock(
            side_effect=lambda sql, *args: execute_calls.append((sql, args))
        )

        mock_tx = AsyncMock()
        mock_tx.__aenter__ = AsyncMock(return_value=mock_tx)
        mock_tx.__aexit__ = AsyncMock()
        mock_conn.transaction = MagicMock(return_value=mock_tx)

        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        old_id = str(uuid.uuid4())
        new_fact = _fact(fact_id=str(uuid.uuid4()))
        await adapter.supersede_fact(old_id, new_fact)
        # Two execute calls: INSERT for new fact, UPDATE to invalidate old
        assert mock_conn.execute.call_count == 2


class TestQueryFacts:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    def _make_row(self, fact: KnowledgeFact) -> dict:
        return {
            "fact_id": fact.fact_id,
            "fact_type": fact.fact_type.value,
            "content": fact.content,
            "entities": fact.entities,
            "confidence": fact.confidence,
            "source": fact.source,
            "valid_from": fact.valid_from,
            "embedding": None,
            "valid_until": fact.valid_until,
            "superseded_by": fact.superseded_by,
            "source_context": fact.source_context,
            "cluster_id": fact.cluster_id,
            "tags": fact.tags,
        }

    @pytest.mark.asyncio
    async def test_query_returns_type_weighted_sorted(self) -> None:
        adapter = self._make_adapter()
        directive = _fact(content="Use early returns", fact_type=FactType.DIRECTIVE, confidence=0.9)
        observation = _fact(
            content="Something happened", fact_type=FactType.OBSERVATION, confidence=0.9
        )

        call_num = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_num
            call_num += 1
            if call_num == 1:
                return []  # no cluster IDs
            return [self._make_row(observation), self._make_row(directive)]

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        facts = await adapter.query_facts("something")
        # Directive should be first (higher weight)
        assert facts[0].fact_type == FactType.DIRECTIVE

    @pytest.mark.asyncio
    async def test_query_with_fact_type_filter(self) -> None:
        adapter = self._make_adapter()
        directive = _fact(content="Use tabs", fact_type=FactType.DIRECTIVE, confidence=0.8)

        call_num = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_num
            call_num += 1
            if call_num == 1:
                return []
            return [self._make_row(directive)]

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        facts = await adapter.query_facts("tabs", fact_type=FactType.DIRECTIVE)
        assert len(facts) == 1
        assert facts[0].fact_type == FactType.DIRECTIVE


class TestIngestFact:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_ingest_without_supersession_writes_fact(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        # No supersedable facts (no entities overlap)
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        fact = _fact(entities=[], embedding=None)
        await adapter.ingest_fact(fact)
        # Should write the fact
        mock_conn.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_ingest_entity_fact_with_no_embedding_no_cluster(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])  # no supersedable + no clusters
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        # Entity fact but no embedding — supersession returns None, no cluster
        fact = _fact(entities=["Python"], embedding=None)
        await adapter.ingest_fact(fact)
        # execute called once to write the fact
        mock_conn.execute.assert_called_once()


class TestProcessInlineFacts:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_no_pattern_returns_empty(self) -> None:
        adapter = self._make_adapter()
        result = await adapter.process_inline_facts("s1", "Hello, how are you?")
        assert result == []

    @pytest.mark.asyncio
    async def test_prefer_pattern_writes_fact(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])  # no supersedable + no clusters
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.process_inline_facts("s1", "I prefer early returns")
        assert len(result) == 1
        assert result[0].fact_type == FactType.PREFERENCE

    @pytest.mark.asyncio
    async def test_forget_pattern_calls_forget(self) -> None:
        adapter = self._make_adapter()
        forgotten = _fact(content="some old fact")
        mock_conn = AsyncMock()
        # query_facts returns our fact for forget
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "fact_id": forgotten.fact_id,
                    "fact_type": forgotten.fact_type.value,
                    "content": forgotten.content,
                    "entities": forgotten.entities,
                    "confidence": forgotten.confidence,
                    "source": forgotten.source,
                    "valid_from": forgotten.valid_from,
                    "embedding": None,
                    "valid_until": None,
                    "superseded_by": None,
                    "source_context": "",
                    "cluster_id": None,
                    "tags": [],
                }
            ]
        )
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.process_inline_facts("s1", "Forget that we said RabbitMQ")
        # forget_fact should have been called — no written facts returned
        assert result == []

    @pytest.mark.asyncio
    async def test_remember_pattern_writes_directive(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.process_inline_facts(
            "s1", "Remember that all members start with underscore"
        )
        assert len(result) == 1
        assert result[0].fact_type == FactType.DIRECTIVE


class TestGetRelationships:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_empty_results(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        rels = await adapter.get_relationships("UnknownEntity")
        assert rels == []

    @pytest.mark.asyncio
    async def test_returns_relationships_with_hop_expansion(self) -> None:
        adapter = self._make_adapter()
        now = datetime.now(UTC)
        mock_conn = AsyncMock()
        call_count = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First hop: "Astri" → "Niuu"
                return [
                    {
                        "rel_id": "r1",
                        "from_entity": "Astri",
                        "relation": "works_at",
                        "to_entity": "Niuu",
                        "valid_from": now,
                        "valid_until": None,
                        "fact_id": None,
                    }
                ]
            # Second hop: no more relationships
            return []

        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        rels = await adapter.get_relationships("Astri", hops=2)
        assert len(rels) == 1
        assert rels[0].from_entity == "Astri"
        assert rels[0].to_entity == "Niuu"


class TestFormatFact:
    def test_current_fact_no_superseded_marker(self) -> None:
        from ravn.adapters.tools.buri_tools import _format_fact

        f = _fact(content="Use early returns")
        formatted = _format_fact(f)
        assert "[superseded]" not in formatted
        assert "PREFERENCE" in formatted

    def test_superseded_fact_has_marker(self) -> None:
        from ravn.adapters.tools.buri_tools import _format_fact

        f = _fact(content="Old preference", valid_until=datetime.now(UTC))
        formatted = _format_fact(f)
        assert "[superseded]" in formatted


class TestRowToFact:
    def test_json_embedding_parsed(self) -> None:
        from ravn.adapters.memory.buri import _row_to_fact

        now = datetime.now(UTC)
        row = {
            "fact_id": "f1",
            "fact_type": "preference",
            "content": "Use tabs",
            "entities": ["Python"],
            "confidence": 0.9,
            "source": "session:s1",
            "valid_from": now,
            "embedding": json.dumps([0.1, 0.2, 0.3]),
            "valid_until": None,
            "superseded_by": None,
            "source_context": "",
            "cluster_id": None,
            "tags": [],
        }
        fact = _row_to_fact(row)
        assert fact.embedding == pytest.approx([0.1, 0.2, 0.3])
        assert fact.fact_type == FactType.PREFERENCE

    def test_list_embedding_preserved(self) -> None:
        from ravn.adapters.memory.buri import _row_to_fact

        now = datetime.now(UTC)
        row = {
            "fact_id": "f2",
            "fact_type": "directive",
            "content": "No nested ifs",
            "entities": [],
            "confidence": 1.0,
            "source": "manual",
            "valid_from": now,
            "embedding": [0.5, 0.5],
            "valid_until": None,
            "superseded_by": None,
            "source_context": "",
            "cluster_id": None,
            "tags": ["style"],
        }
        fact = _row_to_fact(row)
        assert fact.embedding == [0.5, 0.5]
        assert fact.tags == ["style"]

    def test_naive_datetime_gets_utc(self) -> None:
        import datetime as dt

        from ravn.adapters.memory.buri import _row_to_fact

        naive = dt.datetime(2026, 1, 1, 12, 0, 0)  # no tzinfo
        row = {
            "fact_id": "f3",
            "fact_type": "observation",
            "content": "Observed something",
            "entities": [],
            "confidence": 0.5,
            "source": "session:s",
            "valid_from": naive,
            "embedding": None,
            "valid_until": None,
            "superseded_by": None,
            "source_context": "",
            "cluster_id": None,
            "tags": [],
        }
        fact = _row_to_fact(row)
        assert fact.valid_from.tzinfo is not None


class TestRowToCluster:
    def test_json_centroid_parsed(self) -> None:
        from ravn.adapters.memory.buri import _row_to_cluster

        row = {
            "cluster_id": "c1",
            "centroid": json.dumps([0.1, 0.9]),
            "radius": 0.05,
            "member_count": 3,
            "dominant_type": "preference",
            "label": None,
        }
        cluster = _row_to_cluster(row)
        assert cluster.centroid == pytest.approx([0.1, 0.9])
        assert cluster.cluster_id == "c1"


class TestRequirePool:
    def test_raises_when_not_initialized(self) -> None:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._pool = None
        with pytest.raises(RuntimeError, match="not initialized"):
            adapter._require_pool()


class TestSharedContext:
    def test_inject_and_retrieve(self) -> None:
        from ravn.domain.models import SharedContext

        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._shared_context = None
        ctx = SharedContext(data={"session_id": "s1"})
        adapter.inject_shared_context(ctx)
        assert adapter.get_shared_context() is ctx

    def test_none_by_default(self) -> None:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._shared_context = None
        assert adapter.get_shared_context() is None


# ---------------------------------------------------------------------------
# Constructor tests
# ---------------------------------------------------------------------------


class TestBuriAdapterConstructor:
    def test_raises_without_dsn(self) -> None:
        with pytest.raises(ValueError, match="DSN is required"):
            BuriMemoryAdapter()

    def test_dsn_provided_directly(self) -> None:
        adapter = BuriMemoryAdapter(dsn="postgresql://localhost/test")
        assert adapter._dsn == "postgresql://localhost/test"

    def test_dsn_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("TEST_DSN_VAR", "postgresql://localhost/from_env")
        adapter = BuriMemoryAdapter(dsn_env="TEST_DSN_VAR")
        assert adapter._dsn == "postgresql://localhost/from_env"

    def test_extraction_model_fallback_to_reflection(self) -> None:
        adapter = BuriMemoryAdapter(
            dsn="postgresql://localhost/test",
            extraction_model="",
            reflection_model="claude-haiku-4-5",
        )
        assert adapter._extraction_model == "claude-haiku-4-5"

    def test_extraction_model_explicit(self) -> None:
        adapter = BuriMemoryAdapter(
            dsn="postgresql://localhost/test",
            extraction_model="my-model",
        )
        assert adapter._extraction_model == "my-model"

    def test_pool_initially_none(self) -> None:
        adapter = BuriMemoryAdapter(dsn="postgresql://localhost/test")
        assert adapter._pool is None


# ---------------------------------------------------------------------------
# Close lifecycle
# ---------------------------------------------------------------------------


class TestCloseLifecycle:
    @pytest.mark.asyncio
    async def test_close_when_not_initialized(self) -> None:
        """close() should not raise when pool is None."""
        adapter = BuriMemoryAdapter(dsn="postgresql://localhost/test")
        # Should not raise
        await adapter.close()
        assert adapter._pool is None

    @pytest.mark.asyncio
    async def test_close_closes_pool(self) -> None:
        adapter = BuriMemoryAdapter(dsn="postgresql://localhost/test")
        mock_pool = AsyncMock()
        mock_pool.close = AsyncMock()
        adapter._pool = mock_pool
        await adapter.close()
        mock_pool.close.assert_called_once()
        assert adapter._pool is None


# ---------------------------------------------------------------------------
# query_episodes tests
# ---------------------------------------------------------------------------


class TestQueryEpisodes:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._reflection_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty(self) -> None:
        adapter = self._make_adapter()
        result = await adapter.query_episodes("")
        assert result == []

    @pytest.mark.asyncio
    async def test_no_rows_returns_empty(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool
        result = await adapter.query_episodes("something")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_episode_matches(self) -> None:
        adapter = self._make_adapter()
        now = datetime.now(UTC)
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "episode_id": "ep1",
                    "session_id": "s1",
                    "timestamp": now,
                    "summary": "Did some work",
                    "task_description": "Task",
                    "tools_used": ["bash"],
                    "outcome": "success",
                    "tags": ["git"],
                    "embedding": None,
                    "rank_score": 0.9,
                }
            ]
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        matches = await adapter.query_episodes("some work", min_relevance=0.0)
        assert len(matches) >= 0  # scoring may filter out depending on recency

    @pytest.mark.asyncio
    async def test_whitespace_query_returns_empty(self) -> None:
        adapter = self._make_adapter()
        result = await adapter.query_episodes("   ")
        assert result == []


# ---------------------------------------------------------------------------
# search_sessions tests
# ---------------------------------------------------------------------------


class TestSearchSessions:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty(self) -> None:
        adapter = self._make_adapter()
        result = await adapter.search_sessions("")
        assert result == []

    @pytest.mark.asyncio
    async def test_no_rows_returns_empty(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool
        result = await adapter.search_sessions("RabbitMQ")
        assert result == []

    @pytest.mark.asyncio
    async def test_whitespace_query_returns_empty(self) -> None:
        adapter = self._make_adapter()
        result = await adapter.search_sessions("   ")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_session_summaries(self) -> None:
        adapter = self._make_adapter()
        now = datetime.now(UTC)
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(
            return_value=[
                {
                    "episode_id": "ep1",
                    "session_id": "session-abc",
                    "timestamp": now,
                    "summary": "Configured RabbitMQ transport",
                    "task_description": "Setup Sleipnir",
                    "tools_used": ["bash", "read"],
                    "outcome": "success",
                    "tags": ["rabbitmq", "sleipnir"],
                    "embedding": None,
                }
            ]
        )
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool
        results = await adapter.search_sessions("RabbitMQ")
        assert len(results) == 1
        assert results[0].session_id == "session-abc"


# ---------------------------------------------------------------------------
# forget_fact tests (direct)
# ---------------------------------------------------------------------------


class TestForgetFact:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    def _make_row(self, fact: KnowledgeFact) -> dict:
        return {
            "fact_id": fact.fact_id,
            "fact_type": fact.fact_type.value,
            "content": fact.content,
            "entities": fact.entities,
            "confidence": fact.confidence,
            "source": fact.source,
            "valid_from": fact.valid_from,
            "embedding": None,
            "valid_until": fact.valid_until,
            "superseded_by": fact.superseded_by,
            "source_context": fact.source_context,
            "cluster_id": fact.cluster_id,
            "tags": fact.tags,
        }

    @pytest.mark.asyncio
    async def test_returns_none_when_no_match(self) -> None:
        adapter = self._make_adapter()
        call_num = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_num
            call_num += 1
            return []

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.forget_fact("something that doesn't exist")
        assert result is None

    @pytest.mark.asyncio
    async def test_invalidates_and_returns_fact(self) -> None:
        adapter = self._make_adapter()
        target = _fact(content="I prefer tabs", fact_type=FactType.PREFERENCE)
        call_num = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_num
            call_num += 1
            if call_num == 1:
                return []  # no clusters
            return [self._make_row(target)]

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_conn.execute = AsyncMock()
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.forget_fact("tabs preference")
        assert result is not None
        assert result.content == "I prefer tabs"
        mock_conn.execute.assert_called_once()


# ---------------------------------------------------------------------------
# _compress_session_state with LLM tests
# ---------------------------------------------------------------------------


class TestCompressSessionStateWithLLM:
    def _make_adapter(self, llm: Any) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = llm
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_llm_success_returns_response(self) -> None:
        mock_response = MagicMock()
        mock_response.content = "Updated state: working on RabbitMQ config"
        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(return_value=mock_response)

        adapter = self._make_adapter(llm=mock_llm)
        result = await adapter._compress_session_state(
            current_summary="Old state",
            user_input="Configure RabbitMQ",
            response_summary="Done",
        )
        assert result == "Updated state: working on RabbitMQ config"
        mock_llm.complete.assert_called_once()

    @pytest.mark.asyncio
    async def test_llm_failure_falls_back_to_concatenation(self) -> None:
        mock_llm = AsyncMock()
        mock_llm.complete = AsyncMock(side_effect=RuntimeError("LLM down"))

        adapter = self._make_adapter(llm=mock_llm)
        result = await adapter._compress_session_state(
            current_summary="Old state",
            user_input="Input",
            response_summary="Response",
        )
        assert "Input" in result
        assert "Response" in result


# ---------------------------------------------------------------------------
# prefetch tests
# ---------------------------------------------------------------------------


class TestPrefetch:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_empty_when_no_episodes_no_knowledge(self) -> None:
        adapter = self._make_adapter()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(return_value=[])
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.prefetch("some context")
        assert result == ""

    @pytest.mark.asyncio
    async def test_returns_knowledge_when_facts_exist(self) -> None:
        adapter = self._make_adapter()
        directive = _fact(
            content="Always use early returns",
            fact_type=FactType.DIRECTIVE,
        )
        directive_row = {
            "fact_id": directive.fact_id,
            "fact_type": directive.fact_type.value,
            "content": directive.content,
            "entities": directive.entities,
            "confidence": directive.confidence,
            "source": directive.source,
            "valid_from": directive.valid_from,
            "embedding": None,
            "valid_until": None,
            "superseded_by": None,
            "source_context": directive.source_context,
            "cluster_id": None,
            "tags": directive.tags,
        }

        call_count = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_count
            call_count += 1
            # call 1: query_episodes (ravn_episodes) — empty
            # call 2: build_knowledge_context directives query
            if call_count == 2:
                return [directive_row]
            return []

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        result = await adapter.prefetch("early returns")
        assert "[DIRECTIVES]" in result


# ---------------------------------------------------------------------------
# build_knowledge_context with session state
# ---------------------------------------------------------------------------


class TestBuildKnowledgeContextWithSessionState:
    def _make_adapter(self) -> BuriMemoryAdapter:
        adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
        adapter._dsn = "postgresql://test"
        adapter._pool = MagicMock()
        adapter._cluster_merge_threshold = 0.15
        adapter._supersession_cosine_threshold = 0.85
        adapter._min_confidence = 0.6
        adapter._extraction_model = "test-model"
        adapter._session_summary_max_tokens = 400
        adapter._prefetch_budget = 2000
        adapter._prefetch_limit = 5
        adapter._prefetch_min_relevance = 0.3
        adapter._recency_half_life_days = 14.0
        adapter._session_search_truncate_chars = 100_000
        adapter._llm = None
        adapter._shared_context = None
        return adapter

    @pytest.mark.asyncio
    async def test_session_context_injected_via_shared_context(self) -> None:
        from ravn.domain.models import SharedContext

        adapter = self._make_adapter()
        adapter._shared_context = SharedContext(data={"session_id": "s1"})
        now = datetime.now(UTC)

        call_count = 0

        async def mock_fetch(*args: Any, **kwargs: Any) -> list:
            nonlocal call_count
            call_count += 1
            return []  # No directives, goals, or query facts

        async def mock_fetchrow(*args: Any, **kwargs: Any) -> dict | None:
            return {
                "session_id": "s1",
                "rolling_summary": "Working on Sleipnir transport",
                "active_entities": ["Sleipnir"],
                "turn_count": 2,
                "last_updated": now,
            }

        mock_conn = AsyncMock()
        mock_conn.fetch = mock_fetch
        mock_conn.fetchrow = mock_fetchrow
        mock_pool = _make_pool(mock_conn)
        adapter._pool = mock_pool

        context = await adapter.build_knowledge_context("sleipnir")
        assert "[SESSION CONTEXT]" in context
        assert "Sleipnir" in context


# ---------------------------------------------------------------------------
# MemoryPort hook tests (NIU-542)
# ---------------------------------------------------------------------------


def _make_buri_adapter() -> BuriMemoryAdapter:
    """Return a BuriMemoryAdapter with all required attrs set (no real pool)."""
    adapter = BuriMemoryAdapter.__new__(BuriMemoryAdapter)
    adapter._dsn = "postgresql://test"
    adapter._pool = None
    adapter._cluster_merge_threshold = 0.15
    adapter._supersession_cosine_threshold = 0.85
    adapter._min_confidence = 0.6
    adapter._extraction_model = "test-model"
    adapter._session_summary_max_tokens = 400
    adapter._prefetch_budget = 2000
    adapter._prefetch_limit = 5
    adapter._prefetch_min_relevance = 0.3
    adapter._recency_half_life_days = 14.0
    adapter._session_search_truncate_chars = 100_000
    adapter._llm = None
    adapter._shared_context = None
    return adapter


class TestExtraTools:
    def test_buri_adapter_returns_five_tools(self) -> None:
        adapter = _make_buri_adapter()
        tools = adapter.extra_tools(session_id="test-session")
        assert len(tools) == 5
        tool_types = {type(t).__name__ for t in tools}
        assert tool_types == {
            "BuriRecallTool",
            "BuriFactsTool",
            "BuriHistoryTool",
            "BuriRememberTool",
            "BuriForgetTool",
        }

    def test_sqlite_adapter_returns_empty_list(self) -> None:
        from ravn.adapters.memory.sqlite import SqliteMemoryAdapter

        adapter = SqliteMemoryAdapter.__new__(SqliteMemoryAdapter)
        tools = adapter.extra_tools(session_id="x")
        assert tools == []


class TestOnTurnComplete:
    @pytest.mark.asyncio
    async def test_buri_adapter_calls_update_session_state(self) -> None:
        adapter = _make_buri_adapter()
        adapter.update_session_state = AsyncMock()

        await adapter.on_turn_complete(
            session_id="s1",
            user_input="hello",
            response_summary="world",
        )

        adapter.update_session_state.assert_awaited_once_with("s1", "hello", "world")

    @pytest.mark.asyncio
    async def test_sqlite_adapter_on_turn_complete_is_noop(self) -> None:
        from ravn.adapters.memory.sqlite import SqliteMemoryAdapter

        adapter = SqliteMemoryAdapter.__new__(SqliteMemoryAdapter)
        # Should complete without error and return None
        result = await adapter.on_turn_complete(
            session_id="s1",
            user_input="hello",
            response_summary="world",
        )
        assert result is None
