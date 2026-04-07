"""Búri memory adapter — typed fact graph with proto-RWKV session state and
proto-vMF embedding clusters (NIU-541).

Architecture:
  - Typed facts stored in ``knowledge_facts`` with temporal validity bounds.
  - Proto-vMF clusters in ``memory_clusters``; new facts merge into existing
    clusters when cosine distance < cluster_merge_threshold.
  - Proto-RWKV rolling text summary per session in ``session_states``.
  - Two-stage retrieval: cluster centroids → within-cluster facts → 2-hop
    graph expansion → type-weighted scoring → structured context block.
  - Mid-session auto-detection of preference/directive/decision patterns.
  - Fact extraction via structured LLM call using the cheap reflection model.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import asyncpg

from ravn.adapters.memory.postgres import _row_to_episode
from ravn.adapters.memory.scoring import (
    _AVG_EPISODE_CHARS,
    _CHARS_PER_TOKEN,
    _OUTCOME_WEIGHTS,
    _recency_score,
    build_prefetch_context,
    build_session_summaries,
    cosine_similarity,
)
from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    FactType,
    KnowledgeFact,
    KnowledgeRelationship,
    MemoryCluster,
    SessionState,
    SessionSummary,
    SharedContext,
)
from ravn.ports.memory import BuriMemoryPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type-weight scoring constants
# ---------------------------------------------------------------------------

_TYPE_WEIGHTS: dict[str, float] = {
    FactType.DIRECTIVE: 3.0,
    FactType.DECISION: 2.0,
    FactType.GOAL: 2.0,
    FactType.PREFERENCE: 1.5,
    FactType.RELATIONSHIP: 1.0,
    FactType.OBSERVATION: 0.5,
}

# Patterns for mid-session auto-detection (compiled once at module load)
_REMEMBER_PAT = re.compile(r"\b(remember\s+that|note\s+that|don[''']t\s+forget)\b", re.IGNORECASE)
_PREFER_PAT = re.compile(
    r"\b(i\s+prefer|i\s+like|i\s+don[''']t\s+like|i\s+hate|i\s+love)\b", re.IGNORECASE
)
_DECISION_PAT = re.compile(
    r"\b(we\s+decided|let[''']s\s+go\s+with|we[''']re\s+going\s+with|we\s+chose|we\s+picked)\b",
    re.IGNORECASE,
)
_FORGET_PAT = re.compile(
    r"\b(forget\s+that|actually\s+no|ignore\s+what\s+i\s+said|scratch\s+that)\b",
    re.IGNORECASE,
)

# Maximum characters before truncating input for extraction prompts
_MAX_EXTRACTION_INPUT_CHARS = 8_000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unit_normalise(vec: list[float]) -> list[float]:
    """Return the unit-normalised version of *vec*."""
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0:
        return vec
    return [x / norm for x in vec]


def _running_mean(old_centroid: list[float], new_vec: list[float], count: int) -> list[float]:
    """Update a running mean centroid with a new observation."""
    return [(old * count + new) / (count + 1) for old, new in zip(old_centroid, new_vec)]


def _row_to_fact(row: asyncpg.Record | dict[str, Any]) -> KnowledgeFact:
    """Convert an asyncpg Record to a KnowledgeFact dataclass."""
    embedding_raw = row["embedding"]
    embedding: list[float] | None = None
    if embedding_raw is not None:
        if isinstance(embedding_raw, str):
            embedding = json.loads(embedding_raw)
        elif isinstance(embedding_raw, list):
            embedding = list(embedding_raw)

    ts_from = row["valid_from"]
    if isinstance(ts_from, str):
        ts_from = datetime.fromisoformat(ts_from)
    if ts_from.tzinfo is None:
        ts_from = ts_from.replace(tzinfo=UTC)

    ts_until = row.get("valid_until")
    if ts_until is not None and isinstance(ts_until, str):
        ts_until = datetime.fromisoformat(ts_until)
    if ts_until is not None and ts_until.tzinfo is None:
        ts_until = ts_until.replace(tzinfo=UTC)

    entities = row["entities"]
    if isinstance(entities, str):
        entities = json.loads(entities)

    tags = row["tags"]
    if isinstance(tags, str):
        tags = json.loads(tags)

    return KnowledgeFact(
        fact_id=row["fact_id"],
        fact_type=FactType(row["fact_type"]),
        content=row["content"],
        entities=list(entities),
        confidence=float(row["confidence"]),
        source=row["source"],
        valid_from=ts_from,
        embedding=embedding,
        valid_until=ts_until,
        superseded_by=row.get("superseded_by"),
        source_context=row.get("source_context", ""),
        cluster_id=row.get("cluster_id"),
        tags=list(tags),
    )


def _row_to_cluster(row: asyncpg.Record | dict[str, Any]) -> MemoryCluster:
    """Convert an asyncpg Record to a MemoryCluster dataclass."""
    centroid_raw = row["centroid"]
    if isinstance(centroid_raw, str):
        centroid = json.loads(centroid_raw)
    else:
        centroid = list(centroid_raw)
    return MemoryCluster(
        cluster_id=row["cluster_id"],
        centroid=centroid,
        radius=float(row["radius"] or 0.0),
        member_count=int(row["member_count"]),
        dominant_type=row.get("dominant_type"),
        label=row.get("label"),
    )


def _row_to_rel(row: asyncpg.Record | dict[str, Any]) -> KnowledgeRelationship:
    ts_from = row["valid_from"]
    if isinstance(ts_from, str):
        ts_from = datetime.fromisoformat(ts_from)
    if ts_from.tzinfo is None:
        ts_from = ts_from.replace(tzinfo=UTC)

    ts_until = row.get("valid_until")
    if ts_until is not None and isinstance(ts_until, str):
        ts_until = datetime.fromisoformat(ts_until)

    return KnowledgeRelationship(
        rel_id=row["rel_id"],
        from_entity=row["from_entity"],
        relation=row["relation"],
        to_entity=row["to_entity"],
        valid_from=ts_from,
        fact_id=row.get("fact_id"),
        valid_until=ts_until,
    )


def _extract_entities_from_content(content: str) -> list[str]:
    """Simple heuristic entity extraction — capitalised words and quoted phrases."""
    entities: list[str] = []
    # Quoted phrases
    for m in re.finditer(r'"([^"]{2,50})"', content):
        entities.append(m.group(1))
    # Capitalised words (proper nouns), excluding sentence starts
    for m in re.finditer(r"\b([A-Z][a-zA-Z]{2,})\b", content):
        word = m.group(1)
        if word not in {"I", "The", "This", "That", "We", "You", "He", "She", "It"}:
            entities.append(word)
    # Deduplicate preserving order
    seen: set[str] = set()
    result: list[str] = []
    for e in entities:
        if e not in seen:
            seen.add(e)
            result.append(e)
    return result[:10]  # cap at 10 entities per fact


def _detect_inline_fact_type(text: str) -> FactType | None:
    """Return a FactType if *text* matches a mid-session auto-detection pattern."""
    if _FORGET_PAT.search(text):
        return None  # handled separately
    if _DECISION_PAT.search(text):
        return FactType.DECISION
    if _PREFER_PAT.search(text):
        return FactType.PREFERENCE
    if _REMEMBER_PAT.search(text):
        return FactType.DIRECTIVE
    return None


# ---------------------------------------------------------------------------
# BuriMemoryAdapter
# ---------------------------------------------------------------------------


class BuriMemoryAdapter(BuriMemoryPort):
    """Búri knowledge memory: typed fact graph + proto-RWKV + proto-vMF.

    Requires PostgreSQL with pgvector extension (for VECTOR columns and
    cosine similarity).  The episodic memory tables are shared with the
    PostgreSQL adapter — this adapter extends those with three new tables:
    ``knowledge_facts``, ``knowledge_relationships``, ``session_states``,
    and ``memory_clusters`` (see migration 000029_buri_knowledge_facts.up.sql).

    Configuration (ravn.yaml)::

        memory:
          backend: buri
          dsn_env: RAVN_DB_DSN

        buri:
          enabled: true
          cluster_merge_threshold: 0.15
          extraction_model: ""     # empty = use agent.outcome.reflection_model
          min_confidence: 0.6
          session_summary_max_tokens: 400
    """

    def __init__(
        self,
        dsn: str = "",
        *,
        dsn_env: str = "",
        pool_min_size: int = 1,
        pool_max_size: int = 5,
        prefetch_budget: int = 2000,
        prefetch_limit: int = 5,
        prefetch_min_relevance: float = 0.3,
        recency_half_life_days: float = 14.0,
        session_search_truncate_chars: int = 100_000,
        # Búri-specific
        cluster_merge_threshold: float = 0.15,
        extraction_model: str = "",
        reflection_model: str = "claude-haiku-4-5-20251001",
        min_confidence: float = 0.6,
        session_summary_max_tokens: int = 400,
        supersession_cosine_threshold: float = 0.85,
        llm: Any = None,
    ) -> None:
        resolved_dsn = os.environ.get(dsn_env, dsn) if dsn_env else dsn
        if not resolved_dsn:
            raise ValueError(
                "PostgreSQL DSN is required. Provide dsn= or set dsn_env= to an env var name."
            )

        self._dsn = resolved_dsn
        self._pool_min_size = pool_min_size
        self._pool_max_size = pool_max_size
        self._prefetch_budget = prefetch_budget
        self._prefetch_limit = prefetch_limit
        self._prefetch_min_relevance = prefetch_min_relevance
        self._recency_half_life_days = recency_half_life_days
        self._session_search_truncate_chars = session_search_truncate_chars
        self._cluster_merge_threshold = cluster_merge_threshold
        self._extraction_model = extraction_model or reflection_model
        self._min_confidence = min_confidence
        self._session_summary_max_tokens = session_summary_max_tokens
        self._supersession_cosine_threshold = supersession_cosine_threshold
        self._llm = llm
        self._pool: asyncpg.Pool | None = None
        self._shared_context: SharedContext | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Create the connection pool."""
        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=self._pool_min_size,
            max_size=self._pool_max_size,
        )

    async def close(self) -> None:
        """Close the connection pool gracefully."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    # ------------------------------------------------------------------
    # MemoryPort — episodic memory (delegate to postgres logic)
    # ------------------------------------------------------------------

    async def record_episode(self, episode: Episode) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ravn_episodes
                    (episode_id, session_id, timestamp, summary,
                     task_description, tools_used, outcome, tags, embedding)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (episode_id) DO UPDATE SET
                    session_id       = EXCLUDED.session_id,
                    timestamp        = EXCLUDED.timestamp,
                    summary          = EXCLUDED.summary,
                    task_description = EXCLUDED.task_description,
                    tools_used       = EXCLUDED.tools_used,
                    outcome          = EXCLUDED.outcome,
                    tags             = EXCLUDED.tags,
                    embedding        = EXCLUDED.embedding
                """,
                episode.episode_id,
                episode.session_id,
                episode.timestamp,
                episode.summary,
                episode.task_description,
                episode.tools_used,
                episode.outcome.value,
                episode.tags,
                json.dumps(episode.embedding) if episode.embedding is not None else None,
            )

        # After storing the episode, extract facts from the session state
        try:
            await self._extract_facts_from_episode(episode)
        except Exception:
            logger.warning("Fact extraction from episode failed; continuing.", exc_info=True)

    async def query_episodes(
        self,
        query: str,
        *,
        limit: int = 5,
        min_relevance: float = 0.3,
    ) -> list[EpisodeMatch]:
        if not query.strip():
            return []

        pool = self._require_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
                SELECT
                    episode_id, session_id, timestamp, summary,
                    task_description, tools_used, outcome, tags, embedding,
                    ts_rank(search_vector, q.tsq) AS rank_score
                FROM ravn_episodes, q
                WHERE search_vector @@ q.tsq
                ORDER BY rank_score DESC
                LIMIT $2
                """,
                query,
                limit * 3,
            )

        if not rows:
            return []

        matches: list[EpisodeMatch] = []
        for row in rows:
            episode = _row_to_episode(row)
            ts_rank_val = float(row["rank_score"])
            recency = _recency_score(episode.timestamp, self._recency_half_life_days)
            weight = _OUTCOME_WEIGHTS.get(episode.outcome, 0.5)
            score = ts_rank_val * recency * weight
            if score >= min_relevance:
                matches.append(EpisodeMatch(episode=episode, relevance=score))

        matches.sort(key=lambda m: m.relevance, reverse=True)
        return matches[:limit]

    async def prefetch(self, context: str) -> str:
        """Return combined episodic + knowledge context block."""
        episodic = await self._prefetch_episodic(context)
        knowledge = await self.build_knowledge_context(context)
        if not episodic and not knowledge:
            return ""
        parts = []
        if knowledge:
            parts.append(knowledge)
        if episodic:
            parts.append(episodic)
        return "\n\n".join(parts)

    async def _prefetch_episodic(self, context: str) -> str:
        matches = await self.query_episodes(
            context,
            limit=self._prefetch_limit,
            min_relevance=self._prefetch_min_relevance,
        )
        if not matches:
            return ""
        budget_chars = self._prefetch_budget * _CHARS_PER_TOKEN
        return build_prefetch_context(matches, budget_chars)

    async def search_sessions(self, query: str, *, limit: int = 3) -> list[SessionSummary]:
        if not query.strip():
            return []

        pool = self._require_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
                SELECT
                    episode_id, session_id, timestamp, summary,
                    task_description, tools_used, outcome, tags, embedding
                FROM ravn_episodes, q
                WHERE search_vector @@ q.tsq
                ORDER BY ts_rank(search_vector, q.tsq) DESC
                LIMIT $2
                """,
                query,
                self._session_search_truncate_chars // _AVG_EPISODE_CHARS,
            )

        if not rows:
            return []

        episodes: list[Episode] = []
        for row in rows:
            episodes.append(_row_to_episode(row))

        return build_session_summaries(episodes, limit, self._session_search_truncate_chars)

    def inject_shared_context(self, context: SharedContext) -> None:
        self._shared_context = context

    def get_shared_context(self) -> SharedContext | None:
        return self._shared_context

    # ------------------------------------------------------------------
    # BuriMemoryPort — typed fact graph
    # ------------------------------------------------------------------

    async def ingest_fact(self, fact: KnowledgeFact) -> None:
        """Persist a typed fact with supersession check and cluster assignment."""
        # Check for supersession before writing
        existing = await self._find_supersedable_fact(fact)
        if existing is not None:
            await self.supersede_fact(existing.fact_id, fact)
            return

        # Assign to cluster
        cluster_id = await self._assign_cluster(fact)
        fact = _with_cluster(fact, cluster_id)

        await self._write_fact(fact)

    async def query_facts(
        self,
        query: str,
        *,
        fact_type: FactType | None = None,
        limit: int = 10,
        include_superseded: bool = False,
    ) -> list[KnowledgeFact]:
        """Two-stage retrieval: cluster centroids → within-cluster → type-weight."""
        pool = self._require_pool()

        # Stage 1: find candidate cluster IDs by text search on content
        async with pool.acquire() as conn:
            validity_clause = "" if include_superseded else "AND valid_until IS NULL"
            type_clause = "AND fact_type = $2" if fact_type else ""
            params: list[Any] = [f"%{query}%"]
            if fact_type:
                params.append(fact_type.value)

            rows = await conn.fetch(
                f"""
                SELECT DISTINCT cluster_id
                FROM knowledge_facts
                WHERE content ILIKE $1
                  {type_clause}
                  {validity_clause}
                LIMIT 20
                """,
                *params,
            )
            cluster_ids = [r["cluster_id"] for r in rows if r["cluster_id"] is not None]

            # Stage 2: fetch facts within those clusters + direct text matches
            all_params: list[Any] = [f"%{query}%"]
            cluster_filter = ""
            if cluster_ids:
                all_params.append(cluster_ids)
                cluster_filter = "OR cluster_id = ANY($2)"

            fact_rows = await conn.fetch(
                f"""
                SELECT *
                FROM knowledge_facts
                WHERE (content ILIKE $1 {cluster_filter})
                  {validity_clause}
                ORDER BY confidence DESC
                LIMIT ${"3" if cluster_ids else "2"}
                """,
                *all_params,
                limit * 3,
            )

        facts = [_row_to_fact(r) for r in fact_rows]

        # Apply type-weighted scoring
        scored = [(f, _TYPE_WEIGHTS.get(f.fact_type, 1.0) * f.confidence) for f in facts]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [f for f, _ in scored[:limit]]

    async def get_facts_for_entity(
        self,
        entity: str,
        *,
        fact_type: FactType | None = None,
        include_superseded: bool = False,
    ) -> list[KnowledgeFact]:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            validity_clause = "" if include_superseded else "AND valid_until IS NULL"
            type_clause = "AND fact_type = $2" if fact_type else ""
            params: list[Any] = [entity]
            if fact_type:
                params.append(fact_type.value)
            rows = await conn.fetch(
                f"""
                SELECT * FROM knowledge_facts
                WHERE $1 = ANY(entities)
                  {type_clause}
                  {validity_clause}
                ORDER BY valid_from DESC
                """,
                *params,
            )
        return [_row_to_fact(r) for r in rows]

    async def supersede_fact(self, old_fact_id: str, new_fact: KnowledgeFact) -> None:
        """Invalidate *old_fact_id* and write *new_fact* as its replacement."""
        now = datetime.now(UTC)
        pool = self._require_pool()

        # Assign cluster for the new fact
        cluster_id = await self._assign_cluster(new_fact)
        new_fact = _with_cluster(new_fact, cluster_id)

        async with pool.acquire() as conn:
            async with conn.transaction():
                # Write the new fact first so the FK reference is valid
                await self._write_fact_conn(conn, new_fact)
                # Invalidate the old fact
                await conn.execute(
                    """
                    UPDATE knowledge_facts
                    SET valid_until = $1, superseded_by = $2
                    WHERE fact_id = $3
                    """,
                    now,
                    new_fact.fact_id,
                    old_fact_id,
                )

    async def forget_fact(self, query: str) -> KnowledgeFact | None:
        """Find the best-matching current fact by text search and invalidate it."""
        facts = await self.query_facts(query, limit=1)
        if not facts:
            return None

        target = facts[0]
        now = datetime.now(UTC)
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE knowledge_facts SET valid_until = $1 WHERE fact_id = $2",
                now,
                target.fact_id,
            )
        return target

    async def get_relationships(
        self,
        entity: str,
        *,
        hops: int = 2,
    ) -> list[KnowledgeRelationship]:
        """Return relationships involving *entity*, expanding up to *hops* hops."""
        pool = self._require_pool()
        visited: set[str] = set()
        frontier: set[str] = {entity}
        all_rels: list[KnowledgeRelationship] = []

        for _ in range(hops):
            if not frontier:
                break
            next_frontier: set[str] = set()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT * FROM knowledge_relationships
                    WHERE (from_entity = ANY($1) OR to_entity = ANY($1))
                      AND valid_until IS NULL
                    """,
                    list(frontier),
                )
            for row in rows:
                rel = _row_to_rel(row)
                all_rels.append(rel)
                next_frontier.add(rel.from_entity)
                next_frontier.add(rel.to_entity)

            visited.update(frontier)
            frontier = next_frontier - visited

        return all_rels

    # ------------------------------------------------------------------
    # BuriMemoryPort — proto-RWKV session state
    # ------------------------------------------------------------------

    async def update_session_state(
        self,
        session_id: str,
        user_input: str,
        response_summary: str,
    ) -> None:
        """Update the rolling session summary using a cheap LLM call."""
        existing = await self.get_session_state(session_id)
        current_summary = existing.rolling_summary if existing else ""

        new_summary = await self._compress_session_state(
            current_summary=current_summary,
            user_input=user_input[:200],
            response_summary=response_summary[:200],
        )

        now = datetime.now(UTC)
        pool = self._require_pool()

        # Extract entities from the combined text
        combined = f"{user_input} {response_summary}"
        new_entities = _extract_entities_from_content(combined)
        existing_entities = existing.active_entities if existing else []
        merged_entities = list(dict.fromkeys(existing_entities + new_entities))[:50]

        turn_count = (existing.turn_count + 1) if existing else 1

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO session_states
                    (session_id, rolling_summary, active_entities, turn_count, last_updated)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (session_id) DO UPDATE SET
                    rolling_summary = EXCLUDED.rolling_summary,
                    active_entities = EXCLUDED.active_entities,
                    turn_count      = EXCLUDED.turn_count,
                    last_updated    = EXCLUDED.last_updated
                """,
                session_id,
                new_summary,
                merged_entities,
                turn_count,
                now,
            )

    async def get_session_state(self, session_id: str) -> SessionState | None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM session_states WHERE session_id = $1",
                session_id,
            )
        if row is None:
            return None

        ts = row["last_updated"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)

        entities = row["active_entities"]
        if isinstance(entities, str):
            entities = json.loads(entities)

        return SessionState(
            session_id=row["session_id"],
            rolling_summary=row["rolling_summary"],
            active_entities=list(entities),
            turn_count=int(row["turn_count"]),
            last_updated=ts,
        )

    # ------------------------------------------------------------------
    # BuriMemoryPort — structured context block
    # ------------------------------------------------------------------

    async def build_knowledge_context(self, query: str) -> str:
        """Build the structured [DIRECTIVES] / [GOALS] / [DECISIONS] / [SESSION CONTEXT] block."""
        pool = self._require_pool()

        # Fetch current directives (always included, highest weight)
        async with pool.acquire() as conn:
            directive_rows = await conn.fetch(
                """
                SELECT * FROM knowledge_facts
                WHERE fact_type = 'directive' AND valid_until IS NULL
                ORDER BY confidence DESC
                LIMIT 10
                """,
            )
            goal_rows = await conn.fetch(
                """
                SELECT * FROM knowledge_facts
                WHERE fact_type = 'goal' AND valid_until IS NULL
                ORDER BY valid_from DESC
                LIMIT 5
                """,
            )

        # Semantic query for decisions and preferences
        relevant_facts = await self.query_facts(
            query,
            limit=5,
            include_superseded=False,
        )

        directives = [_row_to_fact(r) for r in directive_rows]
        goals = [_row_to_fact(r) for r in goal_rows]
        decisions = [f for f in relevant_facts if f.fact_type == FactType.DECISION]

        sections: list[str] = []

        if directives:
            items = "\n".join(f"• {f.content}" for f in directives)
            sections.append(f"[DIRECTIVES]\n{items}")

        if goals:
            items = "\n".join(f"• {f.content}" for f in goals)
            sections.append(f"[CURRENT GOALS]\n{items}")

        if decisions:
            items = "\n".join(
                f"• {f.content} ({f.valid_from.strftime('%B %Y')})" for f in decisions
            )
            sections.append(f"[RELEVANT DECISIONS]\n{items}")

        # Session context from proto-RWKV state
        # We don't have session_id here; caller must inject via prefetch
        shared = self._shared_context
        if shared and shared.data.get("session_id"):
            state = await self.get_session_state(str(shared.data["session_id"]))
            if state and state.rolling_summary:
                sections.append(f"[SESSION CONTEXT]\n{state.rolling_summary}")

        return "\n\n".join(sections)

    # ------------------------------------------------------------------
    # Mid-session auto-detection
    # ------------------------------------------------------------------

    async def process_inline_facts(
        self,
        session_id: str,
        user_input: str,
    ) -> list[KnowledgeFact]:
        """Detect and persist inline fact patterns from *user_input*.

        Called at the start of run_turn() for fast, regex-based detection.
        Returns the list of facts written (may be empty).
        """
        written: list[KnowledgeFact] = []

        if _FORGET_PAT.search(user_input):
            # Find and invalidate the most relevant current fact
            try:
                forgotten = await self.forget_fact(user_input)
                if forgotten:
                    logger.debug("Auto-forgot fact: %s", forgotten.fact_id)
            except Exception:
                logger.warning("Auto-forget failed.", exc_info=True)
            return written

        detected_type = _detect_inline_fact_type(user_input)
        if detected_type is None:
            return written

        fact = KnowledgeFact(
            fact_id=str(uuid.uuid4()),
            fact_type=detected_type,
            content=user_input.strip(),
            entities=_extract_entities_from_content(user_input),
            confidence=0.9,  # High confidence for explicit statements
            source=f"session:{session_id}",
            valid_from=datetime.now(UTC),
            source_context="mid-session auto-detection",
        )
        try:
            await self.ingest_fact(fact)
            written.append(fact)
        except Exception:
            logger.warning("Auto-fact ingest failed.", exc_info=True)

        return written

    # ------------------------------------------------------------------
    # MemoryPort hook overrides
    # ------------------------------------------------------------------

    def extra_tools(self, session_id: str) -> list:
        """Return the five Búri agent tools for this adapter."""
        from ravn.adapters.tools.buri_tools import (
            BuriFactsTool,
            BuriForgetTool,
            BuriHistoryTool,
            BuriRecallTool,
            BuriRememberTool,
        )

        return [
            BuriRecallTool(self),
            BuriFactsTool(self),
            BuriHistoryTool(self),
            BuriRememberTool(self, session_id=session_id),
            BuriForgetTool(self),
        ]

    async def on_turn_complete(
        self,
        session_id: str,
        user_input: str,
        response_summary: str,
    ) -> None:
        """Update the proto-RWKV rolling summary after each turn."""
        await self.update_session_state(session_id, user_input, response_summary)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _require_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("BuriMemoryAdapter not initialized. Call initialize() first.")
        return self._pool

    async def _find_supersedable_fact(self, new_fact: KnowledgeFact) -> KnowledgeFact | None:
        """Find an existing fact that should be superseded by *new_fact*.

        Criteria: same fact_type + at least one overlapping entity + cosine
        similarity of embeddings > supersession_cosine_threshold.
        Falls back to entity+type match if either fact lacks an embedding.
        """
        if not new_fact.entities:
            return None

        pool = self._require_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM knowledge_facts
                WHERE fact_type = $1
                  AND entities && $2
                  AND valid_until IS NULL
                """,
                new_fact.fact_type.value,
                new_fact.entities,
            )

        if not rows:
            return None

        candidates = [_row_to_fact(r) for r in rows]

        if new_fact.embedding is None:
            # No embedding: fall back to entity+type match (first candidate)
            return candidates[0] if candidates else None

        best: KnowledgeFact | None = None
        best_score = 0.0
        for candidate in candidates:
            if candidate.embedding is None:
                continue
            sim = cosine_similarity(new_fact.embedding, candidate.embedding)
            if sim > best_score:
                best_score = sim
                best = candidate

        if best_score >= self._supersession_cosine_threshold:
            return best
        return None

    async def _assign_cluster(self, fact: KnowledgeFact) -> str | None:
        """Assign *fact* to an existing cluster or create a new one.

        Returns the cluster_id string, or None if fact has no embedding.
        """
        if not fact.embedding:
            return None

        unit_vec = _unit_normalise(fact.embedding)
        pool = self._require_pool()

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM memory_clusters ORDER BY member_count DESC LIMIT 200"
            )

        clusters = [_row_to_cluster(r) for r in rows]

        best_cluster: MemoryCluster | None = None
        best_distance = float("inf")
        for cluster in clusters:
            sim = cosine_similarity(unit_vec, cluster.centroid)
            distance = 1.0 - sim
            if distance < best_distance:
                best_distance = distance
                best_cluster = cluster

        if best_cluster is not None and best_distance < self._cluster_merge_threshold:
            # Merge into existing cluster
            new_centroid = _unit_normalise(
                _running_mean(best_cluster.centroid, unit_vec, best_cluster.member_count)
            )
            new_radius = max(best_cluster.radius, best_distance)
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE memory_clusters
                    SET centroid = $1, radius = $2, member_count = member_count + 1
                    WHERE cluster_id = $3
                    """,
                    json.dumps(new_centroid),
                    new_radius,
                    best_cluster.cluster_id,
                )
            return best_cluster.cluster_id

        # Create new cluster
        cluster_id = str(uuid.uuid4())
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO memory_clusters
                    (cluster_id, centroid, radius, member_count, dominant_type)
                VALUES ($1, $2, $3, $4, $5)
                """,
                cluster_id,
                json.dumps(unit_vec),
                0.0,
                1,
                fact.fact_type.value,
            )
        return cluster_id

    async def _write_fact(self, fact: KnowledgeFact) -> None:
        pool = self._require_pool()
        async with pool.acquire() as conn:
            await self._write_fact_conn(conn, fact)

    async def _write_fact_conn(self, conn: asyncpg.Connection, fact: KnowledgeFact) -> None:
        await conn.execute(
            """
            INSERT INTO knowledge_facts
                (fact_id, fact_type, content, entities, embedding, confidence,
                 valid_from, valid_until, superseded_by, source, source_context,
                 cluster_id, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (fact_id) DO NOTHING
            """,
            fact.fact_id,
            fact.fact_type.value,
            fact.content,
            fact.entities,
            json.dumps(fact.embedding) if fact.embedding is not None else None,
            fact.confidence,
            fact.valid_from,
            fact.valid_until,
            fact.superseded_by,
            fact.source,
            fact.source_context,
            fact.cluster_id,
            fact.tags,
        )

    async def _extract_facts_from_episode(self, episode: Episode) -> None:
        """Use a cheap LLM call to extract typed facts from the episode summary."""
        if self._llm is None:
            return

        # Use rolling summary if available, else fall back to episode summary
        state = await self.get_session_state(episode.session_id)
        source_text = state.rolling_summary if state and state.rolling_summary else episode.summary

        if not source_text.strip():
            return

        prompt = (
            "Extract structured facts from the following session content. "
            "Return a JSON array where each item has:\n"
            '  "type": one of preference|decision|goal|directive|relationship|observation\n'
            '  "content": the fact as a clear statement\n'
            '  "entities": list of named entities mentioned\n'
            '  "confidence": 0.0–1.0\n\n'
            "Return ONLY the JSON array, no other text.\n\n"
            f"Content:\n{source_text[:_MAX_EXTRACTION_INPUT_CHARS]}"
        )

        try:
            from ravn.domain.models import Message as RavnMessage

            response = await self._llm.complete(
                model=self._extraction_model,
                system="You are a fact extraction assistant. Return only valid JSON.",
                messages=[RavnMessage(role="user", content=prompt)],
                max_tokens=self._session_summary_max_tokens * 2,
            )
            raw = response.content.strip()
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)

            extracted = json.loads(raw)
        except Exception:
            logger.warning("Fact extraction LLM call failed.", exc_info=True)
            return

        if not isinstance(extracted, list):
            return

        now = datetime.now(UTC)
        for item in extracted:
            if not isinstance(item, dict):
                continue
            raw_type = item.get("type", "observation")
            confidence = float(item.get("confidence", 0.5))
            content = str(item.get("content", "")).strip()
            entities = list(item.get("entities", []))

            if not content:
                continue

            # Downgrade low-confidence items to observation
            if confidence < self._min_confidence:
                raw_type = "observation"

            try:
                fact_type = FactType(raw_type)
            except ValueError:
                fact_type = FactType.OBSERVATION

            fact = KnowledgeFact(
                fact_id=str(uuid.uuid4()),
                fact_type=fact_type,
                content=content,
                entities=entities,
                confidence=confidence,
                source=f"session:{episode.session_id}",
                valid_from=now,
                source_context=episode.episode_id,
            )
            try:
                await self.ingest_fact(fact)
            except Exception:
                logger.warning("Failed to ingest extracted fact.", exc_info=True)

    async def _compress_session_state(
        self,
        current_summary: str,
        user_input: str,
        response_summary: str,
    ) -> str:
        """Produce an updated rolling summary with a cheap LLM call."""
        if self._llm is None:
            # Fallback: simple concatenation truncated to budget
            combined = f"{current_summary}\n\nLatest: {user_input} → {response_summary}"
            chars_budget = self._session_summary_max_tokens * _CHARS_PER_TOKEN
            return combined[-int(chars_budget) :]

        prompt = (
            f"Current state (max {self._session_summary_max_tokens} tokens):\n"
            f"{current_summary}\n\n"
            f"Latest turn:\n{user_input} → {response_summary}\n\n"
            f"Update the state. Be concise. Max {self._session_summary_max_tokens} tokens."
        )

        try:
            from ravn.domain.models import Message as RavnMessage

            response = await self._llm.complete(
                model=self._extraction_model,
                system=(
                    "You are a concise state tracker. Return only the updated state, no commentary."
                ),
                messages=[RavnMessage(role="user", content=prompt)],
                max_tokens=self._session_summary_max_tokens,
            )
            return response.content.strip()
        except Exception:
            logger.warning("Session state compression LLM call failed.", exc_info=True)
            combined = f"{current_summary}\n\nLatest: {user_input} → {response_summary}"
            chars_budget = self._session_summary_max_tokens * _CHARS_PER_TOKEN
            return combined[-int(chars_budget) :]


# ---------------------------------------------------------------------------
# Helpers that operate on frozen dataclasses
# ---------------------------------------------------------------------------


def _with_cluster(fact: KnowledgeFact, cluster_id: str | None) -> KnowledgeFact:
    """Return a copy of *fact* with *cluster_id* set."""
    return replace(fact, cluster_id=cluster_id)
