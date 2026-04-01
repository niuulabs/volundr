"""PostgreSQL implementation of ReviewerOutcomeRepository."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import asyncpg

from tyr.domain.models import ReviewerOutcome
from tyr.ports.reviewer_outcome_repository import (
    CalibrationSummary,
    ReviewerOutcomeRepository,
)


class PostgresReviewerOutcomeRepository(ReviewerOutcomeRepository):
    """Reviewer outcome persistence backed by asyncpg."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def record(self, outcome: ReviewerOutcome) -> None:
        await self._pool.execute(
            """
            INSERT INTO tyr_reviewer_outcomes
                (id, raid_id, owner_id, reviewer_decision, reviewer_confidence,
                 reviewer_issues_count, actual_outcome, decision_at, resolved_at, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            outcome.id,
            outcome.raid_id,
            outcome.owner_id,
            outcome.reviewer_decision,
            outcome.reviewer_confidence,
            outcome.reviewer_issues_count,
            outcome.actual_outcome,
            outcome.decision_at or datetime.now(UTC),
            outcome.resolved_at,
            outcome.notes,
        )

    async def resolve(self, raid_id: UUID, actual_outcome: str, notes: str | None = None) -> None:
        await self._pool.execute(
            """
            UPDATE tyr_reviewer_outcomes
            SET actual_outcome = $2, resolved_at = $3, notes = COALESCE($4, notes)
            WHERE raid_id = $1 AND resolved_at IS NULL
            """,
            raid_id,
            actual_outcome,
            datetime.now(UTC),
            notes,
        )

    async def list_recent(self, owner_id: str, limit: int = 100) -> list[ReviewerOutcome]:
        rows = await self._pool.fetch(
            """
            SELECT * FROM tyr_reviewer_outcomes
            WHERE owner_id = $1
            ORDER BY decision_at DESC
            LIMIT $2
            """,
            owner_id,
            limit,
        )
        return [self._row_to_outcome(row) for row in rows]

    async def divergence_rate(self, owner_id: str, window_days: int = 30) -> float:
        row = await self._pool.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (
                    WHERE actual_outcome IN ('reverted', 'abandoned')
                ) AS diverged,
                COUNT(*) AS total
            FROM tyr_reviewer_outcomes
            WHERE owner_id = $1
              AND reviewer_decision = 'auto_approved'
              AND actual_outcome IS NOT NULL
              AND decision_at >= now() - make_interval(days => $2)
            """,
            owner_id,
            window_days,
        )
        total = row["total"]
        if total == 0:
            return 0.0
        return row["diverged"] / total

    async def list_unresolved(self, owner_id: str) -> list[ReviewerOutcome]:
        rows = await self._pool.fetch(
            """
            SELECT * FROM tyr_reviewer_outcomes
            WHERE owner_id = $1
              AND actual_outcome IS NULL
            ORDER BY decision_at
            """,
            owner_id,
        )
        return [self._row_to_outcome(row) for row in rows]

    async def calibration_summary(self, owner_id: str, window_days: int = 30) -> CalibrationSummary:
        row = await self._pool.fetchrow(
            """
            SELECT
                COUNT(*) AS total_decisions,
                COUNT(*) FILTER (WHERE reviewer_decision = 'auto_approved') AS auto_approved,
                COUNT(*) FILTER (WHERE reviewer_decision = 'retried') AS retried,
                COUNT(*) FILTER (WHERE reviewer_decision = 'escalated') AS escalated,
                COUNT(*) FILTER (WHERE actual_outcome IS NULL) AS pending_resolution,
                COALESCE(AVG(reviewer_confidence) FILTER (
                    WHERE reviewer_decision = 'auto_approved'
                ), 0) AS avg_confidence_approved,
                COALESCE(AVG(reviewer_confidence) FILTER (
                    WHERE actual_outcome IN ('reverted', 'abandoned')
                ), 0) AS avg_confidence_reverted
            FROM tyr_reviewer_outcomes
            WHERE owner_id = $1
              AND decision_at >= now() - make_interval(days => $2)
            """,
            owner_id,
            window_days,
        )
        divergence = await self.divergence_rate(owner_id, window_days)
        return CalibrationSummary(
            window_days=window_days,
            total_decisions=row["total_decisions"],
            auto_approved=row["auto_approved"],
            retried=row["retried"],
            escalated=row["escalated"],
            divergence_rate=divergence,
            avg_confidence_approved=float(row["avg_confidence_approved"]),
            avg_confidence_reverted=float(row["avg_confidence_reverted"]),
            pending_resolution=row["pending_resolution"],
        )

    async def resolve_by_tracker_id(
        self, tracker_id: str, actual_outcome: str, notes: str | None = None
    ) -> int:
        result = await self._pool.execute(
            """
            UPDATE tyr_reviewer_outcomes
            SET actual_outcome = $2, resolved_at = $3, notes = COALESCE($4, notes)
            WHERE raid_id IN (
                SELECT id FROM raid_progress WHERE tracker_id = $1
                UNION
                SELECT id::uuid FROM raids WHERE tracker_id = $1
            )
              AND resolved_at IS NULL
            """,
            tracker_id,
            actual_outcome,
            datetime.now(UTC),
            notes,
        )
        # asyncpg returns "UPDATE N" string
        return int(result.split()[-1]) if result else 0

    async def list_unresolved_owner_ids(self) -> list[str]:
        rows = await self._pool.fetch(
            """
            SELECT DISTINCT owner_id
            FROM tyr_reviewer_outcomes
            WHERE actual_outcome IS NULL
            """
        )
        return [r["owner_id"] for r in rows]

    @staticmethod
    def _row_to_outcome(row: asyncpg.Record) -> ReviewerOutcome:
        return ReviewerOutcome(
            id=row["id"],
            raid_id=row["raid_id"],
            owner_id=row["owner_id"],
            reviewer_decision=row["reviewer_decision"],
            reviewer_confidence=row["reviewer_confidence"],
            reviewer_issues_count=row["reviewer_issues_count"],
            actual_outcome=row["actual_outcome"],
            decision_at=row["decision_at"],
            resolved_at=row["resolved_at"],
            notes=row["notes"],
        )
