"""Outcome port — interface for task outcome storage and lessons retrieval."""

from __future__ import annotations

from abc import ABC, abstractmethod

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
