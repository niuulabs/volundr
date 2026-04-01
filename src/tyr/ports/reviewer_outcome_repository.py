"""Reviewer outcome repository port — persistence for reviewer decision audit log."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from uuid import UUID

from tyr.domain.models import ReviewerOutcome


@dataclass(frozen=True)
class CalibrationSummary:
    """Aggregate calibration statistics for a time window."""

    window_days: int
    total_decisions: int
    auto_approved: int
    retried: int
    escalated: int
    divergence_rate: float
    avg_confidence_approved: float
    avg_confidence_reverted: float
    pending_resolution: int


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

    @abstractmethod
    async def list_unresolved(self, owner_id: str) -> list[ReviewerOutcome]:
        """Return outcomes whose actual_outcome is still NULL."""
        ...

    @abstractmethod
    async def calibration_summary(self, owner_id: str, window_days: int = 30) -> CalibrationSummary:
        """Return aggregate calibration statistics for the given time window."""
        ...

    @abstractmethod
    async def resolve_by_tracker_id(
        self, tracker_id: str, actual_outcome: str, notes: str | None = None
    ) -> int:
        """Resolve outcomes by tracker_id instead of raid_id. Returns count resolved."""
        ...

    @abstractmethod
    async def list_unresolved_owner_ids(self) -> list[str]:
        """Return distinct owner_ids that have unresolved outcomes."""
        ...
