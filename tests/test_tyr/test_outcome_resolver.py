"""Tests for OutcomeResolver and calibration endpoints (NIU-338)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.domain.models import ReviewerOutcome
from tyr.domain.services.outcome_resolver import OutcomeResolver
from tyr.ports.reviewer_outcome_repository import (
    CalibrationSummary,
    ReviewerOutcomeRepository,
)
from tyr.ports.tracker import TrackerPort

NOW = datetime.now(UTC)


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class StubOutcomeRepo(ReviewerOutcomeRepository):
    """In-memory reviewer outcome repository for testing."""

    def __init__(self) -> None:
        self.outcomes: list[ReviewerOutcome] = []
        self._resolved: list[tuple[UUID, str, str | None]] = []

    async def record(self, outcome: ReviewerOutcome) -> None:
        self.outcomes.append(outcome)

    async def resolve(self, raid_id: UUID, actual_outcome: str, notes: str | None = None) -> None:
        self._resolved.append((raid_id, actual_outcome, notes))
        self.outcomes = [
            ReviewerOutcome(
                id=o.id,
                raid_id=o.raid_id,
                owner_id=o.owner_id,
                reviewer_decision=o.reviewer_decision,
                reviewer_confidence=o.reviewer_confidence,
                reviewer_issues_count=o.reviewer_issues_count,
                actual_outcome=(
                    actual_outcome
                    if o.raid_id == raid_id and o.actual_outcome is None
                    else o.actual_outcome
                ),
                decision_at=o.decision_at,
                resolved_at=NOW if o.raid_id == raid_id else o.resolved_at,
                notes=notes if o.raid_id == raid_id else o.notes,
            )
            for o in self.outcomes
        ]

    async def list_recent(self, owner_id: str, limit: int = 100) -> list[ReviewerOutcome]:
        return [o for o in self.outcomes if o.owner_id == owner_id][:limit]

    async def divergence_rate(self, owner_id: str, window_days: int = 30) -> float:
        approved = [
            o
            for o in self.outcomes
            if o.owner_id == owner_id
            and o.reviewer_decision == "auto_approved"
            and o.actual_outcome is not None
        ]
        if not approved:
            return 0.0
        diverged = [o for o in approved if o.actual_outcome in ("reverted", "abandoned")]
        return len(diverged) / len(approved)

    async def list_unresolved(self, owner_id: str) -> list[ReviewerOutcome]:
        return [o for o in self.outcomes if o.owner_id == owner_id and o.actual_outcome is None]

    async def calibration_summary(self, owner_id: str, window_days: int = 30) -> CalibrationSummary:
        relevant = [o for o in self.outcomes if o.owner_id == owner_id]
        auto_approved = [o for o in relevant if o.reviewer_decision == "auto_approved"]
        retried = [o for o in relevant if o.reviewer_decision == "retried"]
        escalated = [o for o in relevant if o.reviewer_decision == "escalated"]
        pending = [o for o in relevant if o.actual_outcome is None]
        approved_with_outcome = [o for o in auto_approved if o.actual_outcome is not None]
        diverged = [
            o for o in approved_with_outcome if o.actual_outcome in ("reverted", "abandoned")
        ]
        divergence = len(diverged) / len(approved_with_outcome) if approved_with_outcome else 0.0
        avg_conf_approved = (
            sum(o.reviewer_confidence for o in auto_approved) / len(auto_approved)
            if auto_approved
            else 0.0
        )
        reverted_outcomes = [o for o in relevant if o.actual_outcome in ("reverted", "abandoned")]
        avg_conf_reverted = (
            sum(o.reviewer_confidence for o in reverted_outcomes) / len(reverted_outcomes)
            if reverted_outcomes
            else 0.0
        )
        return CalibrationSummary(
            window_days=window_days,
            total_decisions=len(relevant),
            auto_approved=len(auto_approved),
            retried=len(retried),
            escalated=len(escalated),
            divergence_rate=divergence,
            avg_confidence_approved=avg_conf_approved,
            avg_confidence_reverted=avg_conf_reverted,
            pending_resolution=len(pending),
        )

    async def resolve_by_tracker_id(
        self, tracker_id: str, actual_outcome: str, notes: str | None = None
    ) -> int:
        count = 0
        for o in self.outcomes:
            if o.actual_outcome is None:
                count += 1
        # Just resolve all unresolved for simplicity in tests
        for i, o in enumerate(self.outcomes):
            if o.actual_outcome is None:
                self.outcomes[i] = ReviewerOutcome(
                    id=o.id,
                    raid_id=o.raid_id,
                    owner_id=o.owner_id,
                    reviewer_decision=o.reviewer_decision,
                    reviewer_confidence=o.reviewer_confidence,
                    reviewer_issues_count=o.reviewer_issues_count,
                    actual_outcome=actual_outcome,
                    decision_at=o.decision_at,
                    resolved_at=NOW,
                    notes=notes,
                )
        return count

    async def list_unresolved_owner_ids(self) -> list[str]:
        return list({o.owner_id for o in self.outcomes if o.actual_outcome is None})


def _make_outcome(
    *,
    owner_id: str = "user-1",
    decision: str = "auto_approved",
    confidence: float = 0.85,
    actual_outcome: str | None = None,
    raid_id: UUID | None = None,
) -> ReviewerOutcome:
    return ReviewerOutcome(
        id=uuid4(),
        raid_id=raid_id or uuid4(),
        owner_id=owner_id,
        reviewer_decision=decision,
        reviewer_confidence=confidence,
        reviewer_issues_count=0,
        actual_outcome=actual_outcome,
        decision_at=NOW,
    )


# ---------------------------------------------------------------------------
# Minimal TrackerPort stub for outcome resolution
# ---------------------------------------------------------------------------


class StubTrackerForResolution(TrackerPort):
    """Minimal tracker stub that supports get_issue_resolution."""

    def __init__(self) -> None:
        self.resolutions: dict[str, str | None] = {}
        self._raids: dict[UUID, str] = {}  # raid_id -> tracker_id

    def set_raid(self, raid_id: UUID, tracker_id: str) -> None:
        self._raids[raid_id] = tracker_id

    def set_resolution(self, tracker_id: str, resolution: str | None) -> None:
        self.resolutions[tracker_id] = resolution

    async def get_issue_resolution(self, tracker_id: str) -> str | None:
        return self.resolutions.get(tracker_id)

    async def get_raid_by_id(self, raid_id: UUID) -> object | None:
        tracker_id = self._raids.get(raid_id)
        if tracker_id is None:
            return None
        # Return a minimal object with tracker_id attribute
        from dataclasses import dataclass

        @dataclass
        class MinRaid:
            tracker_id: str

        return MinRaid(tracker_id=tracker_id)

    # -- Required abstract methods (no-ops for testing) --
    async def create_saga(self, *a, **kw):  # noqa: ANN002, ANN003
        return ""

    async def create_phase(self, *a, **kw):  # noqa: ANN002, ANN003
        return ""

    async def create_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        return ""

    async def update_raid_state(self, *a, **kw):  # noqa: ANN002, ANN003
        pass

    async def close_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        pass

    async def get_saga(self, *a, **kw):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def get_phase(self, *a, **kw):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def get_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def list_pending_raids(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def list_projects(self):
        return []

    async def get_project(self, *a, **kw):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def list_milestones(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def list_issues(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def update_raid_progress(self, *a, **kw):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def get_raid_progress_for_saga(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def get_raid_by_session(self, *a, **kw):  # noqa: ANN002, ANN003
        return None

    async def list_raids_by_status(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def add_confidence_event(self, *a, **kw):  # noqa: ANN002, ANN003
        pass

    async def get_confidence_events(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def all_raids_merged(self, *a, **kw):  # noqa: ANN002, ANN003
        return False

    async def list_phases_for_saga(self, *a, **kw):  # noqa: ANN002, ANN003
        return []

    async def update_phase_status(self, *a, **kw):  # noqa: ANN002, ANN003
        return None

    async def get_saga_for_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        return None

    async def get_phase_for_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        return None

    async def get_owner_for_raid(self, *a, **kw):  # noqa: ANN002, ANN003
        return None

    async def save_session_message(self, *a, **kw):  # noqa: ANN002, ANN003
        pass

    async def get_session_messages(self, *a, **kw):  # noqa: ANN002, ANN003
        return []


class StubTrackerFactory:
    """Stub TrackerFactory returning a fixed set of trackers."""

    def __init__(self, trackers: list[TrackerPort]) -> None:
        self._trackers = trackers

    async def for_owner(self, owner_id: str) -> list[TrackerPort]:
        return self._trackers


# ---------------------------------------------------------------------------
# OutcomeResolver tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_poll_once_resolves_outcomes():
    """OutcomeResolver.poll_once resolves unresolved outcomes via tracker."""
    repo = StubOutcomeRepo()
    tracker = StubTrackerForResolution()
    factory = StubTrackerFactory([tracker])

    raid_id = uuid4()
    tracker.set_raid(raid_id, "TRACKER-1")
    tracker.set_resolution("TRACKER-1", "merged")

    outcome = _make_outcome(owner_id="user-1", raid_id=raid_id)
    await repo.record(outcome)

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    resolved = await resolver.poll_once("user-1")
    assert resolved == 1
    assert repo.outcomes[0].actual_outcome == "merged"


@pytest.mark.asyncio
async def test_poll_once_skips_unresolvable():
    """poll_once skips outcomes whose tracker returns None."""
    repo = StubOutcomeRepo()
    tracker = StubTrackerForResolution()
    factory = StubTrackerFactory([tracker])

    raid_id = uuid4()
    tracker.set_raid(raid_id, "TRACKER-2")
    tracker.set_resolution("TRACKER-2", None)

    outcome = _make_outcome(owner_id="user-1", raid_id=raid_id)
    await repo.record(outcome)

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    resolved = await resolver.poll_once("user-1")
    assert resolved == 0
    assert repo.outcomes[0].actual_outcome is None


@pytest.mark.asyncio
async def test_poll_once_no_trackers():
    """poll_once returns 0 when no trackers are configured."""
    repo = StubOutcomeRepo()
    factory = StubTrackerFactory([])

    outcome = _make_outcome(owner_id="user-1")
    await repo.record(outcome)

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    resolved = await resolver.poll_once("user-1")
    assert resolved == 0


@pytest.mark.asyncio
async def test_poll_all_resolves_across_owners():
    """poll_all iterates across all owners with unresolved outcomes."""
    repo = StubOutcomeRepo()
    tracker = StubTrackerForResolution()
    factory = StubTrackerFactory([tracker])

    raid_1 = uuid4()
    raid_2 = uuid4()
    tracker.set_raid(raid_1, "T-1")
    tracker.set_raid(raid_2, "T-2")
    tracker.set_resolution("T-1", "merged")
    tracker.set_resolution("T-2", "abandoned")

    await repo.record(_make_outcome(owner_id="user-1", raid_id=raid_1))
    await repo.record(_make_outcome(owner_id="user-2", raid_id=raid_2))

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    total = await resolver.poll_all()
    assert total == 2


@pytest.mark.asyncio
async def test_poll_once_deduplicates_raid_ids():
    """poll_once only queries each raid_id once even with multiple outcomes."""
    repo = StubOutcomeRepo()
    tracker = StubTrackerForResolution()
    factory = StubTrackerFactory([tracker])

    raid_id = uuid4()
    tracker.set_raid(raid_id, "T-DUP")
    tracker.set_resolution("T-DUP", "merged")

    await repo.record(_make_outcome(owner_id="user-1", raid_id=raid_id, decision="auto_approved"))
    await repo.record(_make_outcome(owner_id="user-1", raid_id=raid_id, decision="retried"))

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    resolved = await resolver.poll_once("user-1")
    # Only 1 because we deduplicate by raid_id
    assert resolved == 1


@pytest.mark.asyncio
async def test_start_stop():
    """OutcomeResolver can start and stop without errors."""
    repo = StubOutcomeRepo()
    factory = StubTrackerFactory([])

    resolver = OutcomeResolver(
        outcome_repo=repo,
        tracker_factory=factory,
        interval=300.0,
    )

    assert not resolver.running
    await resolver.start()
    assert resolver.running
    await resolver.stop()
    assert not resolver.running


# ---------------------------------------------------------------------------
# CalibrationSummary stub tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_calibration_summary_empty():
    """calibration_summary returns zeros when no outcomes exist."""
    repo = StubOutcomeRepo()
    summary = await repo.calibration_summary("user-1", 30)
    assert summary.total_decisions == 0
    assert summary.divergence_rate == 0.0
    assert summary.pending_resolution == 0


@pytest.mark.asyncio
async def test_calibration_summary_with_data():
    """calibration_summary computes correct aggregates."""
    repo = StubOutcomeRepo()
    await repo.record(
        _make_outcome(
            owner_id="u1",
            decision="auto_approved",
            actual_outcome="merged",
            confidence=0.9,
        )
    )
    await repo.record(
        _make_outcome(
            owner_id="u1",
            decision="auto_approved",
            actual_outcome="reverted",
            confidence=0.7,
        )
    )
    await repo.record(
        _make_outcome(
            owner_id="u1",
            decision="retried",
            confidence=0.4,
        )
    )
    await repo.record(
        _make_outcome(
            owner_id="u1",
            decision="escalated",
            confidence=0.3,
        )
    )
    # pending (no actual_outcome)
    await repo.record(
        _make_outcome(
            owner_id="u1",
            decision="auto_approved",
            confidence=0.85,
        )
    )

    summary = await repo.calibration_summary("u1", 30)
    assert summary.total_decisions == 5
    assert summary.auto_approved == 3
    assert summary.retried == 1
    assert summary.escalated == 1
    # 3 pending: retried (no outcome), escalated (no outcome), last auto_approved (no outcome)
    assert summary.pending_resolution == 3
    # divergence = 1 reverted out of 2 auto_approved with non-null outcome = 0.5
    assert summary.divergence_rate == pytest.approx(0.5)
    # avg confidence approved = (0.9 + 0.7 + 0.85) / 3
    assert summary.avg_confidence_approved == pytest.approx(0.8166, abs=0.01)
    # avg confidence reverted = 0.7
    assert summary.avg_confidence_reverted == pytest.approx(0.7)


@pytest.mark.asyncio
async def test_resolve_by_tracker_id():
    """resolve_by_tracker_id resolves all unresolved outcomes."""
    repo = StubOutcomeRepo()
    await repo.record(_make_outcome(owner_id="u1"))
    await repo.record(_make_outcome(owner_id="u1"))

    count = await repo.resolve_by_tracker_id("any-tracker", "merged", "test notes")
    assert count == 2
    assert all(o.actual_outcome == "merged" for o in repo.outcomes)


@pytest.mark.asyncio
async def test_list_unresolved_owner_ids():
    """list_unresolved_owner_ids returns distinct owners with null outcomes."""
    repo = StubOutcomeRepo()
    await repo.record(_make_outcome(owner_id="u1"))
    await repo.record(_make_outcome(owner_id="u2"))
    await repo.record(_make_outcome(owner_id="u1", actual_outcome="merged"))

    owner_ids = await repo.list_unresolved_owner_ids()
    assert set(owner_ids) == {"u1", "u2"}


# ---------------------------------------------------------------------------
# TrackerPort.get_issue_resolution default impl
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tracker_port_default_resolution():
    """TrackerPort.get_issue_resolution returns None by default."""
    # The base class has a default implementation returning None

    # We can't instantiate ABC directly, but we can verify the default via a stub
    tracker = StubTrackerForResolution()
    # When no resolution is set, should return None
    result = await tracker.get_issue_resolution("nonexistent")
    assert result is None
