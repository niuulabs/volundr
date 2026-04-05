"""Outcome port — interface for task outcome storage and lessons retrieval."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from ravn.domain.models import TaskOutcome


class OutcomePort(ABC):
    """Abstract interface for recording task outcomes and retrieving lessons.

    Implementations persist structured ``TaskOutcome`` records (including
    LLM-generated reflections) and expose a ``retrieve_lessons`` method that
    returns a condensed 'lessons learned' block for injection into the system
    prompt of future tasks.
    """

    @abstractmethod
    async def record_outcome(self, outcome: TaskOutcome) -> None:
        """Persist a completed task outcome to the backend."""
        ...

    @abstractmethod
    async def retrieve_lessons(
        self,
        task_description: str,
        *,
        limit: int = 3,
    ) -> str:
        """Return a formatted 'Lessons Learned' block for *task_description*.

        Searches stored outcomes for the most semantically relevant past tasks
        and formats their reflections as a Markdown block ready for injection
        into the system prompt.  Returns an empty string if no relevant
        outcomes are found.
        """
        ...

    async def count_all_outcomes(self) -> int:
        """Return the total number of stored outcomes.

        Returns 0 when the backend does not support counting.  Override in
        concrete adapters to provide an accurate count.
        """
        return 0

    async def list_recent_outcomes(
        self,
        limit: int = 50,
        *,
        since: datetime | None = None,
    ) -> list[TaskOutcome]:
        """Return recent task outcomes for pattern analysis.

        Returns an empty list when the backend does not support listing.
        Override in concrete adapters to provide actual data.

        Args:
            limit: Maximum number of outcomes to return.
            since: If provided, return only outcomes recorded after this timestamp.
        """
        raise NotImplementedError("list_recent_outcomes not supported by this backend")
