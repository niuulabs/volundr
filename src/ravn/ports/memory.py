"""Memory port — interface for episodic memory backends."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ravn.domain.models import Episode, EpisodeMatch, SessionSummary, SharedContext


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
