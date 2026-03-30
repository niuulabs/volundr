"""Reviewer outcome repository port — persistence for reviewer decision audit log."""

from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from tyr.domain.models import ReviewerOutcome


class ReviewerOutcomeRepository(ABC):
    """Abstract persistence for reviewer outcome records."""

    @abstractmethod
    async def record(self, outcome: ReviewerOutcome) -> None:
        """Append a reviewer decision to the audit log."""
        ...

    @abstractmethod
    async def resolve(self, raid_id: UUID, actual_outcome: str, notes: str | None = None) -> None:
        """Mark all unresolved outcomes for a raid with the actual outcome."""
        ...

    @abstractmethod
    async def list_recent(self, owner_id: str, limit: int = 100) -> list[ReviewerOutcome]:
        """Return the most recent outcomes for an owner, newest first."""
        ...

    @abstractmethod
    async def divergence_rate(self, owner_id: str, window_days: int = 30) -> float:
        """Fraction of auto_approved decisions where actual_outcome is reverted or abandoned.

        Denominator = auto_approved with non-null actual_outcome only.
        Returns 0.0 when denominator is zero.
        """
        ...
