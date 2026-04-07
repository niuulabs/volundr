"""Memory port — interface for episodic memory backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    FactType,
    KnowledgeFact,
    KnowledgeRelationship,
    SessionState,
    SessionSummary,
    SharedContext,
)

if TYPE_CHECKING:
    from ravn.ports.tool import ToolPort


class MemoryPort(ABC):
    """Abstract interface for episodic memory storage and retrieval.

    Implementations provide persistence for agent episodes across sessions,
    enabling continuity of context and the ability to search past work.
    """

    @abstractmethod
    async def record_episode(self, episode: Episode) -> None:
        """Persist a completed episode to the memory store."""
        ...

    @abstractmethod
    async def query_episodes(
        self,
        query: str,
        *,
        limit: int = 5,
        min_relevance: float = 0.3,
    ) -> list[EpisodeMatch]:
        """Search for episodes relevant to *query*.

        Returns at most *limit* results with relevance >= *min_relevance*,
        ordered by descending combined score (relevance × recency × outcome).
        """
        ...

    @abstractmethod
    async def prefetch(self, context: str) -> str:
        """Return a formatted "Relevant Past Context" block for the system prompt.

        Searches memory using *context* (typically the current user input),
        applies recency and outcome weighting, respects the token budget, and
        formats the results as a Markdown block ready for injection.
        Returns an empty string if no relevant episodes are found.
        """
        ...

    @abstractmethod
    async def search_sessions(
        self,
        query: str,
        *,
        limit: int = 3,
    ) -> list[SessionSummary]:
        """Return per-session summaries for sessions matching *query*.

        Two-stage search: FTS5 keyword search across all episodes, then
        grouping and summarisation per session.
        """
        ...

    @abstractmethod
    def inject_shared_context(self, context: SharedContext) -> None:
        """Store a shared blackboard context for this adapter instance."""
        ...

    @abstractmethod
    def get_shared_context(self) -> SharedContext | None:
        """Return the most recently injected shared context, or None."""
        ...

    def extra_tools(self, session_id: str) -> list[ToolPort]:
        """Return any additional agent tools this memory adapter provides.

        Default implementation returns an empty list. Adapters that offer
        agent-facing tools (e.g. buri_recall, buri_facts) override this.
        Called once by _build_tools() alongside all other tool registration.
        No isinstance checks needed at the call site.
        """
        return []

    async def process_inline_facts(self, session_id: str, user_input: str) -> list:
        """Detect and persist inline fact patterns from *user_input*.

        Default implementation is a no-op returning an empty list.
        BuriMemoryAdapter overrides this for regex-based fact detection.
        Called unconditionally at the start of run_turn() — no isinstance
        check at the call site.
        """
        return []

    async def on_turn_complete(
        self,
        session_id: str,
        user_input: str,
        response_summary: str,
    ) -> None:
        """Hook called by the agent after every run_turn() completes.

        Default implementation is a no-op. BuriMemoryAdapter overrides this
        to update the rolling session summary (proto-RWKV).
        Called unconditionally on every turn — no isinstance check at the
        call site.
        """


class BuriMemoryPort(MemoryPort):
    """Extended memory port with typed fact graph, proto-RWKV session state,
    and proto-vMF embedding clusters (NIU-541).

    Builds on MemoryPort; all episodic memory methods are inherited and must
    still be implemented.  Concrete adapters only need to implement the Búri
    extensions declared here.
    """

    @abstractmethod
    async def ingest_fact(self, fact: KnowledgeFact) -> None:
        """Persist a typed knowledge fact.

        Supersession check (cosine > 0.85 + type match + entity overlap) is
        performed before writing; the old fact is invalidated if a match is
        found.  Cluster assignment is handled internally.
        """
        ...

    @abstractmethod
    async def query_facts(
        self,
        query: str,
        *,
        fact_type: FactType | None = None,
        limit: int = 10,
        include_superseded: bool = False,
    ) -> list[KnowledgeFact]:
        """Two-stage semantic retrieval: cluster centroids → within-cluster facts.

        Returns current facts (``valid_until IS NULL``) ordered by type-weighted
        score.  Pass ``include_superseded=True`` to include historical facts.
        """
        ...

    @abstractmethod
    async def get_facts_for_entity(
        self,
        entity: str,
        *,
        fact_type: FactType | None = None,
        include_superseded: bool = False,
    ) -> list[KnowledgeFact]:
        """Return all facts that reference *entity* in their entities list."""
        ...

    @abstractmethod
    async def supersede_fact(self, old_fact_id: str, new_fact: KnowledgeFact) -> None:
        """Mark *old_fact_id* as superseded and write *new_fact* as its replacement."""
        ...

    @abstractmethod
    async def forget_fact(self, query: str) -> KnowledgeFact | None:
        """Find the best-matching current fact by semantic search and invalidate it.

        Returns the invalidated fact, or None if no match was found.
        Takes a natural language description, not a raw ID.
        """
        ...

    @abstractmethod
    async def get_relationships(
        self,
        entity: str,
        *,
        hops: int = 2,
    ) -> list[KnowledgeRelationship]:
        """Return relationships involving *entity*, expanding up to *hops* hops."""
        ...

    @abstractmethod
    async def update_session_state(
        self,
        session_id: str,
        user_input: str,
        response_summary: str,
    ) -> None:
        """Update the proto-RWKV rolling summary for *session_id*.

        Called at the end of each ``run_turn()`` call.  Uses a cheap small-model
        LLM call to produce a concise updated state (≤ summary_max_tokens).
        """
        ...

    @abstractmethod
    async def get_session_state(self, session_id: str) -> SessionState | None:
        """Return the current session state for *session_id*, or None."""
        ...

    @abstractmethod
    async def build_knowledge_context(self, query: str) -> str:
        """Build the structured context block for system prompt injection.

        Returns a formatted block with sections:
        [DIRECTIVES], [CURRENT GOALS], [RELEVANT DECISIONS], [SESSION CONTEXT]
        """
        ...
