"""Tests for ReviewerOutcome recording and divergence_rate (NIU-337)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    Phase,
    PRStatus,
    Raid,
    RaidStatus,
    ReviewerOutcome,
    Saga,
)
from tyr.domain.services.review_engine import ReviewEngine
from tyr.ports.git import GitPort
from tyr.ports.reviewer_outcome_repository import ReviewerOutcomeRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import VolundrPort, VolundrSession

NOW = datetime.now(UTC)

# ---------------------------------------------------------------------------
# In-memory ReviewerOutcomeRepository for testing
# ---------------------------------------------------------------------------


class InMemoryOutcomeRepo(ReviewerOutcomeRepository):
    """In-memory implementation for unit tests."""

    def __init__(self) -> None:
        self.outcomes: list[ReviewerOutcome] = []

    async def record(self, outcome: ReviewerOutcome) -> None:
        self.outcomes.append(outcome)

    async def resolve(self, raid_id: UUID, actual_outcome: str, notes: str | None = None) -> None:
        updated = []
        for o in self.outcomes:
            if o.raid_id == raid_id and o.resolved_at is None:
                o = ReviewerOutcome(
                    id=o.id,
                    raid_id=o.raid_id,
                    owner_id=o.owner_id,
                    reviewer_decision=o.reviewer_decision,
                    reviewer_confidence=o.reviewer_confidence,
                    reviewer_issues_count=o.reviewer_issues_count,
                    actual_outcome=actual_outcome,
                    decision_at=o.decision_at,
                    resolved_at=datetime.now(UTC),
                    notes=notes or o.notes,
                )
            updated.append(o)
        self.outcomes = updated

    async def list_recent(self, owner_id: str, limit: int = 100) -> list[ReviewerOutcome]:
        filtered = [o for o in self.outcomes if o.owner_id == owner_id]
        filtered.sort(key=lambda o: o.decision_at or NOW, reverse=True)
        return filtered[:limit]

    async def divergence_rate(self, owner_id: str, window_days: int = 30) -> float:
        auto_approved = [
            o
            for o in self.outcomes
            if o.owner_id == owner_id
            and o.reviewer_decision == "auto_approved"
            and o.actual_outcome is not None
        ]
        if not auto_approved:
            return 0.0
        diverged = [o for o in auto_approved if o.actual_outcome in ("reverted", "abandoned")]
        return len(diverged) / len(auto_approved)

    async def list_unresolved(self, owner_id: str) -> list[ReviewerOutcome]:
        return [o for o in self.outcomes if o.owner_id == owner_id and o.actual_outcome is None]

    async def calibration_summary(
        self,
        owner_id: str,
        window_days: int = 30,
    ):  # type: ignore[override]
        from tyr.ports.reviewer_outcome_repository import CalibrationSummary

        relevant = [o for o in self.outcomes if o.owner_id == owner_id]
        return CalibrationSummary(
            window_days=window_days,
            total_decisions=len(relevant),
            auto_approved=len([o for o in relevant if o.reviewer_decision == "auto_approved"]),
            retried=len([o for o in relevant if o.reviewer_decision == "retried"]),
            escalated=len([o for o in relevant if o.reviewer_decision == "escalated"]),
            divergence_rate=await self.divergence_rate(owner_id, window_days),
            avg_confidence_approved=0.0,
            avg_confidence_reverted=0.0,
            pending_resolution=len([o for o in relevant if o.actual_outcome is None]),
        )

    async def resolve_by_tracker_id(
        self,
        tracker_id: str,
        actual_outcome: str,
        notes: str | None = None,
    ) -> int:
        return 0

    async def list_unresolved_owner_ids(self) -> list[str]:
        return list({o.owner_id for o in self.outcomes if o.actual_outcome is None})


# ---------------------------------------------------------------------------
# Stubs (minimal, reused from test_review_engine pattern)
# ---------------------------------------------------------------------------

PHASE_ID = uuid4()
SAGA_ID = uuid4()
OWNER_ID = "user-1"
TRACKER_ID = "NIU-100"


class StubGit(GitPort):
    def __init__(self) -> None:
        self.pr_statuses: dict[str, PRStatus] = {}
        self.changed_files: dict[str, list[str]] = {}

    async def create_branch(self, repo, branch, base):
        pass

    async def merge_branch(self, repo, source, target):
        pass

    async def delete_branch(self, repo, branch):
        pass

    async def create_pr(self, repo, source, target, title):
        return "pr-1"

    async def get_pr_status(self, pr_id):
        pr = self.pr_statuses.get(pr_id)
        if pr is None:
            raise RuntimeError(f"No PR: {pr_id}")
        return pr

    async def get_pr_changed_files(self, pr_id):
        return self.changed_files.get(pr_id, [])


class StubTracker(TrackerPort):
    def __init__(self) -> None:
        self.raids: dict[str, Raid] = {}
        self.events: dict[str, list[ConfidenceEvent]] = {}
        self.saga: Saga | None = None
        self.phase: Phase | None = None
        self.phases: list[Phase] = []
        self._all_merged: bool = False

    async def create_saga(self, saga, *, description=""):
        return saga.tracker_id

    async def create_phase(self, phase, *, project_id=""):
        return phase.tracker_id

    async def create_raid(self, raid, *, project_id="", milestone_id=""):
        self.raids[raid.tracker_id] = raid
        return raid.tracker_id

    async def update_raid_state(self, raid_id, state):
        pass

    async def close_raid(self, raid_id):
        pass

    async def get_saga(self, saga_id):
        return self.saga

    async def get_phase(self, tracker_id):
        return self.phase

    async def get_raid(self, tracker_id):
        raid = self.raids.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        return raid

    async def list_pending_raids(self, phase_id):
        return []

    async def list_projects(self):
        return []

    async def get_project(self, project_id):
        raise NotImplementedError

    async def list_milestones(self, project_id):
        return []

    async def list_issues(self, project_id, milestone_id=None):
        return []

    async def update_raid_progress(
        self,
        tracker_id,
        *,
        status=None,
        session_id=None,
        confidence=None,
        pr_url=None,
        pr_id=None,
        retry_count=None,
        reason=None,
        owner_id=None,
        phase_tracker_id=None,
        saga_tracker_id=None,
        chronicle_summary=None,
        reviewer_session_id=None,
        review_round=None,
        planner_session_id=None,
        acceptance_criteria=None,
        declared_files=None,
        launch_command=None,
    ):
        raid = self.raids[tracker_id]
        events = self.events.get(tracker_id, [])
        new_confidence = events[-1].score_after if events else raid.confidence
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status if status is not None else raid.status,
            confidence=confidence if confidence is not None else new_confidence,
            session_id=session_id if session_id is not None else raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=pr_url if pr_url is not None else raid.pr_url,
            pr_id=pr_id if pr_id is not None else raid.pr_id,
            retry_count=retry_count if retry_count is not None else raid.retry_count,
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
        )
        self.raids[tracker_id] = updated
        return updated

    async def get_raid_progress_for_saga(self, saga_tracker_id):
        return list(self.raids.values())

    async def get_raid_by_session(self, session_id):
        return next((r for r in self.raids.values() if r.session_id == session_id), None)

    async def list_raids_by_status(self, status):
        return [r for r in self.raids.values() if r.status == status]

    async def get_raid_by_id(self, raid_id):
        return next((r for r in self.raids.values() if r.id == raid_id), None)

    async def add_confidence_event(self, tracker_id, event):
        self.events.setdefault(tracker_id, []).append(event)

    async def get_confidence_events(self, tracker_id):
        return self.events.get(tracker_id, [])

    async def all_raids_merged(self, phase_tracker_id):
        return self._all_merged

    async def list_phases_for_saga(self, saga_tracker_id):
        return self.phases

    async def update_phase_status(self, phase_tracker_id, status):
        return None

    async def get_saga_for_raid(self, tracker_id):
        return self.saga

    async def get_phase_for_raid(self, tracker_id):
        return self.phase

    async def get_owner_for_raid(self, tracker_id):
        return self.saga.owner_id if self.saga else None

    async def save_session_message(self, message):
        pass

    async def get_session_messages(self, tracker_id):
        return []

    async def attach_issue_document(self, issue_id, title, content):
        return ""


class StubVolundr(VolundrPort):
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    async def spawn_session(self, request, *, auth_token=None):
        raise NotImplementedError

    async def get_session(self, session_id, *, auth_token=None):
        return VolundrSession(id=session_id, name="s", status="running", tracker_issue_id=None)

    async def list_sessions(self, *, auth_token=None):
        return []

    async def get_pr_status(self, session_id):
        raise NotImplementedError

    async def get_chronicle_summary(self, session_id):
        return ""

    async def send_message(self, session_id, message, *, auth_token=None):
        self.messages.append((session_id, message))

    async def stop_session(self, session_id, *, auth_token=None):
        pass

    async def list_integration_ids(self, *, auth_token=None):
        return []

    async def list_repos(self, *, auth_token=None):
        return []

    async def get_conversation(self, session_id):
        return {"turns": []}

    async def get_last_assistant_message(self, session_id):
        return ""

    async def subscribe_activity(self):
        return
        yield  # type: ignore[misc]  # pragma: no cover


class StubTrackerFactory:
    def __init__(self, tracker: StubTracker) -> None:
        self._tracker = tracker

    async def for_owner(self, owner_id: str) -> list[StubTracker]:
        return [self._tracker]


class _StubVolundrFactory:
    def __init__(self, volundr: StubVolundr) -> None:
        self._v = volundr

    async def for_owner(self, owner_id):
        return [self._v]

    async def primary_for_owner(self, owner_id):
        return self._v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    raid_id: UUID | None = None,
    tracker_id: str = TRACKER_ID,
    status: RaidStatus = RaidStatus.REVIEW,
    confidence: float = 0.5,
    pr_id: str | None = "https://api.github.com/repos/org/repo/pulls/42",
    declared_files: list[str] | None = None,
    retry_count: int = 0,
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=PHASE_ID,
        tracker_id=tracker_id,
        name="Test raid",
        description="A test raid",
        acceptance_criteria=["tests pass"],
        declared_files=declared_files or ["src/main.py", "tests/test_main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=confidence,
        session_id="session-1",
        branch="raid/test-branch",
        chronicle_summary="All tests pass",
        pr_url="https://github.com/org/repo/pull/42",
        pr_id=pr_id,
        retry_count=retry_count,
        created_at=NOW,
        updated_at=NOW,
    )


def _default_config(**overrides: object) -> ReviewConfig:
    defaults: dict = {
        "auto_approve_threshold": 0.80,
        "max_retries": 3,
        "scope_breach_threshold": 0.30,
    }
    defaults.update(overrides)
    return ReviewConfig(**defaults)


def _make_engine(
    tracker: StubTracker | None = None,
    git: StubGit | None = None,
    config: ReviewConfig | None = None,
    outcome_repo: InMemoryOutcomeRepo | None = None,
) -> tuple[ReviewEngine, StubTracker, StubGit, InMemoryOutcomeRepo]:
    t = tracker or StubTracker()
    g = git or StubGit()
    c = config or _default_config()
    o = outcome_repo or InMemoryOutcomeRepo()
    v = StubVolundr()
    e = InMemoryEventBus()

    engine = ReviewEngine(
        tracker_factory=StubTrackerFactory(t),
        volundr_factory=_StubVolundrFactory(v),
        git=g,
        review_config=c,
        event_bus=e,
        outcome_repo=o,
    )
    return engine, t, g, o


def _setup_passing_pr(git: StubGit, pr_id: str) -> None:
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=True,
    )


def _setup_failing_pr(git: StubGit, pr_id: str) -> None:
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=False,
    )


def _setup_conflicted_pr(git: StubGit, pr_id: str) -> None:
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=False,
        ci_passed=True,
    )


# ---------------------------------------------------------------------------
# Tests: ReviewerOutcome model
# ---------------------------------------------------------------------------


class TestReviewerOutcomeModel:
    def test_create_outcome(self) -> None:
        outcome = ReviewerOutcome(
            id=uuid4(),
            raid_id=uuid4(),
            owner_id="user-1",
            reviewer_decision="auto_approved",
            reviewer_confidence=0.92,
            reviewer_issues_count=0,
        )
        assert outcome.reviewer_decision == "auto_approved"
        assert outcome.actual_outcome is None
        assert outcome.resolved_at is None

    def test_create_outcome_with_all_fields(self) -> None:
        outcome = ReviewerOutcome(
            id=uuid4(),
            raid_id=uuid4(),
            owner_id="user-1",
            reviewer_decision="escalated",
            reviewer_confidence=0.3,
            reviewer_issues_count=5,
            actual_outcome="abandoned",
            decision_at=NOW,
            resolved_at=NOW,
            notes="Too many issues",
        )
        assert outcome.actual_outcome == "abandoned"
        assert outcome.notes == "Too many issues"


# ---------------------------------------------------------------------------
# Tests: InMemoryOutcomeRepo (divergence_rate logic)
# ---------------------------------------------------------------------------


class TestDivergenceRate:
    @pytest.mark.asyncio
    async def test_empty_returns_zero(self) -> None:
        repo = InMemoryOutcomeRepo()
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_all_merged_returns_zero(self) -> None:
        repo = InMemoryOutcomeRepo()
        for _ in range(5):
            await repo.record(
                ReviewerOutcome(
                    id=uuid4(),
                    raid_id=uuid4(),
                    owner_id="user-1",
                    reviewer_decision="auto_approved",
                    reviewer_confidence=0.9,
                    actual_outcome="merged",
                    decision_at=NOW,
                )
            )
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_some_reverted(self) -> None:
        repo = InMemoryOutcomeRepo()
        # 3 merged, 2 reverted = 2/5 = 0.4
        for _ in range(3):
            await repo.record(
                ReviewerOutcome(
                    id=uuid4(),
                    raid_id=uuid4(),
                    owner_id="user-1",
                    reviewer_decision="auto_approved",
                    reviewer_confidence=0.9,
                    actual_outcome="merged",
                    decision_at=NOW,
                )
            )
        for _ in range(2):
            await repo.record(
                ReviewerOutcome(
                    id=uuid4(),
                    raid_id=uuid4(),
                    owner_id="user-1",
                    reviewer_decision="auto_approved",
                    reviewer_confidence=0.85,
                    actual_outcome="reverted",
                    decision_at=NOW,
                )
            )
        rate = await repo.divergence_rate("user-1")
        assert rate == pytest.approx(0.4)

    @pytest.mark.asyncio
    async def test_abandoned_counts_as_diverged(self) -> None:
        repo = InMemoryOutcomeRepo()
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                actual_outcome="abandoned",
                decision_at=NOW,
            )
        )
        rate = await repo.divergence_rate("user-1")
        assert rate == 1.0

    @pytest.mark.asyncio
    async def test_pending_excluded_from_denominator(self) -> None:
        repo = InMemoryOutcomeRepo()
        # 1 merged, 1 pending (null outcome) — only 1 in denominator
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                actual_outcome="merged",
                decision_at=NOW,
            )
        )
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.85,
                actual_outcome=None,
                decision_at=NOW,
            )
        )
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_non_auto_approved_excluded(self) -> None:
        repo = InMemoryOutcomeRepo()
        # escalated decisions with reverted outcome should not count
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="escalated",
                reviewer_confidence=0.3,
                actual_outcome="reverted",
                decision_at=NOW,
            )
        )
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0

    @pytest.mark.asyncio
    async def test_other_owner_excluded(self) -> None:
        repo = InMemoryOutcomeRepo()
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-2",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                actual_outcome="reverted",
                decision_at=NOW,
            )
        )
        rate = await repo.divergence_rate("user-1")
        assert rate == 0.0


# ---------------------------------------------------------------------------
# Tests: InMemoryOutcomeRepo.resolve
# ---------------------------------------------------------------------------


class TestResolve:
    @pytest.mark.asyncio
    async def test_resolve_sets_actual_outcome(self) -> None:
        repo = InMemoryOutcomeRepo()
        raid_id = uuid4()
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=raid_id,
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                decision_at=NOW,
            )
        )
        await repo.resolve(raid_id, "merged")
        assert repo.outcomes[0].actual_outcome == "merged"
        assert repo.outcomes[0].resolved_at is not None

    @pytest.mark.asyncio
    async def test_resolve_with_notes(self) -> None:
        repo = InMemoryOutcomeRepo()
        raid_id = uuid4()
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=raid_id,
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                decision_at=NOW,
            )
        )
        await repo.resolve(raid_id, "reverted", notes="Broke staging")
        assert repo.outcomes[0].notes == "Broke staging"


# ---------------------------------------------------------------------------
# Tests: InMemoryOutcomeRepo.list_recent
# ---------------------------------------------------------------------------


class TestListRecent:
    @pytest.mark.asyncio
    async def test_returns_newest_first(self) -> None:
        repo = InMemoryOutcomeRepo()
        t1 = datetime(2026, 1, 1, tzinfo=UTC)
        t2 = datetime(2026, 1, 2, tzinfo=UTC)
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="auto_approved",
                reviewer_confidence=0.9,
                decision_at=t1,
            )
        )
        await repo.record(
            ReviewerOutcome(
                id=uuid4(),
                raid_id=uuid4(),
                owner_id="user-1",
                reviewer_decision="escalated",
                reviewer_confidence=0.3,
                decision_at=t2,
            )
        )
        results = await repo.list_recent("user-1")
        assert len(results) == 2
        assert results[0].decision_at == t2

    @pytest.mark.asyncio
    async def test_respects_limit(self) -> None:
        repo = InMemoryOutcomeRepo()
        for i in range(5):
            await repo.record(
                ReviewerOutcome(
                    id=uuid4(),
                    raid_id=uuid4(),
                    owner_id="user-1",
                    reviewer_decision="auto_approved",
                    reviewer_confidence=0.9,
                    decision_at=datetime(2026, 1, i + 1, tzinfo=UTC),
                )
            )
        results = await repo.list_recent("user-1", limit=2)
        assert len(results) == 2


# ---------------------------------------------------------------------------
# Tests: ReviewEngine records outcomes
# ---------------------------------------------------------------------------


class TestEngineRecordsOutcomes:
    @pytest.mark.asyncio
    async def test_auto_approve_records_outcome(self) -> None:
        engine, tracker, git, outcome_repo = _make_engine()
        raid = _make_raid(confidence=0.5)
        tracker.raids[TRACKER_ID] = raid
        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        decision = await engine.evaluate(TRACKER_ID, OWNER_ID)
        assert decision.action == "auto_approved"
        assert len(outcome_repo.outcomes) == 1
        assert outcome_repo.outcomes[0].reviewer_decision == "auto_approved"
        assert outcome_repo.outcomes[0].owner_id == OWNER_ID
        assert outcome_repo.outcomes[0].raid_id == raid.id

    @pytest.mark.asyncio
    async def test_escalation_records_outcome(self) -> None:
        engine, tracker, git, outcome_repo = _make_engine()
        raid = _make_raid(confidence=0.1)
        tracker.raids[TRACKER_ID] = raid
        # PR passes CI + mergeable, but low confidence → escalate
        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        decision = await engine.evaluate(TRACKER_ID, OWNER_ID)
        assert decision.action == "escalated"
        assert len(outcome_repo.outcomes) == 1
        assert outcome_repo.outcomes[0].reviewer_decision == "escalated"

    @pytest.mark.asyncio
    async def test_retry_records_outcome(self) -> None:
        engine, tracker, git, outcome_repo = _make_engine()
        raid = _make_raid(confidence=0.5, retry_count=0)
        tracker.raids[TRACKER_ID] = raid
        _setup_failing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        decision = await engine.evaluate(TRACKER_ID, OWNER_ID)
        assert decision.action == "retried"
        assert len(outcome_repo.outcomes) == 1
        assert outcome_repo.outcomes[0].reviewer_decision == "retried"

    @pytest.mark.asyncio
    async def test_no_outcome_repo_is_noop(self) -> None:
        """When outcome_repo is None, engine works without recording."""
        t = StubTracker()
        g = StubGit()
        v = StubVolundr()
        engine = ReviewEngine(
            tracker_factory=StubTrackerFactory(t),
            volundr_factory=_StubVolundrFactory(v),
            git=g,
            review_config=_default_config(),
            event_bus=InMemoryEventBus(),
            outcome_repo=None,
        )
        raid = _make_raid(confidence=0.5)
        t.raids[TRACKER_ID] = raid
        _setup_passing_pr(g, raid.pr_id)
        g.changed_files[raid.pr_id] = ["src/main.py"]

        decision = await engine.evaluate(TRACKER_ID, OWNER_ID)
        assert decision.action == "auto_approved"

    @pytest.mark.asyncio
    async def test_outcome_repo_failure_does_not_break_engine(self) -> None:
        """If outcome recording fails, the engine continues normally."""

        class FailingOutcomeRepo(InMemoryOutcomeRepo):
            async def record(self, outcome: ReviewerOutcome) -> None:
                raise RuntimeError("DB down")

        engine, tracker, git, _ = _make_engine()
        failing_repo = FailingOutcomeRepo()
        engine._outcome_repo = failing_repo

        raid = _make_raid(confidence=0.5)
        tracker.raids[TRACKER_ID] = raid
        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        # Should not raise
        decision = await engine.evaluate(TRACKER_ID, OWNER_ID)
        assert decision.action == "auto_approved"
