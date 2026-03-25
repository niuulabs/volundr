"""Tests for the automated review engine (NIU-239)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.config import ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    Phase,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.domain.services.review_engine import (
    ReviewEngine,
    detect_scope_breach,
)
from tyr.events import EventBus
from tyr.ports.git import GitPort
from tyr.ports.raid_repository import RaidRepository

NOW = datetime.now(UTC)

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class StubGit(GitPort):
    """In-memory Git stub for review engine tests."""

    def __init__(self) -> None:
        self.pr_statuses: dict[str, PRStatus] = {}
        self.changed_files: dict[str, list[str]] = {}
        self.merged: list[tuple[str, str, str]] = []
        self.deleted: list[tuple[str, str]] = []
        self.fail_pr_status: bool = False
        self.fail_changed_files: bool = False
        self.fail_merge: bool = False

    async def create_branch(self, repo: str, branch: str, base: str) -> None:
        pass

    async def merge_branch(self, repo: str, source: str, target: str) -> None:
        if self.fail_merge:
            raise RuntimeError("Merge conflict")
        self.merged.append((repo, source, target))

    async def delete_branch(self, repo: str, branch: str) -> None:
        self.deleted.append((repo, branch))

    async def create_pr(self, repo: str, source: str, target: str, title: str) -> str:
        return "pr-1"

    async def get_pr_status(self, pr_id: str) -> PRStatus:
        if self.fail_pr_status:
            raise RuntimeError("PR status unavailable")
        pr = self.pr_statuses.get(pr_id)
        if pr is None:
            raise RuntimeError(f"No PR: {pr_id}")
        return pr

    async def get_pr_changed_files(self, pr_id: str) -> list[str]:
        if self.fail_changed_files:
            raise RuntimeError("Changed files unavailable")
        return self.changed_files.get(pr_id, [])


class StubRaidRepo(RaidRepository):
    """In-memory raid repository for review engine tests."""

    def __init__(self) -> None:
        self.raids: dict[UUID, Raid] = {}
        self.events: dict[UUID, list[ConfidenceEvent]] = {}
        self.saga: Saga | None = None
        self.phase: Phase | None = None
        self.phases: list[Phase] = []
        self._all_merged: bool = False
        self.phase_status_updates: list[tuple[UUID, PhaseStatus]] = []

    async def save_phase(self, phase: Phase, *, conn=None) -> None:  # noqa: ANN001
        pass

    async def save_raid(self, raid: Raid, *, conn=None) -> None:  # noqa: ANN001
        self.raids[raid.id] = raid

    async def get_raid(self, raid_id: UUID) -> Raid | None:
        return self.raids.get(raid_id)

    async def update_raid_status(
        self,
        raid_id: UUID,
        status: RaidStatus,
        *,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        raid = self.raids.get(raid_id)
        if raid is None:
            return None
        retry_count = raid.retry_count + 1 if increment_retry else raid.retry_count
        events = self.events.get(raid_id, [])
        confidence = events[-1].score_after if events else raid.confidence
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status,
            confidence=confidence,
            session_id=raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            pr_url=raid.pr_url,
            pr_id=raid.pr_id,
            retry_count=retry_count,
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
        )
        self.raids[raid_id] = updated
        return updated

    async def get_confidence_events(self, raid_id: UUID) -> list[ConfidenceEvent]:
        return self.events.get(raid_id, [])

    async def add_confidence_event(self, event: ConfidenceEvent) -> None:
        self.events.setdefault(event.raid_id, []).append(event)

    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        return next((r for r in self.raids.values() if r.tracker_id == tracker_id), None)

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, raid_id: UUID) -> Phase | None:
        return self.phase

    async def list_by_status(self, status: RaidStatus) -> list[Raid]:
        return [r for r in self.raids.values() if r.status == status]

    async def update_raid_completion(
        self,
        raid_id: UUID,
        *,
        status: RaidStatus,
        chronicle_summary: str | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        return await self.update_raid_status(
            raid_id, status, reason=reason, increment_retry=increment_retry
        )

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        return self._all_merged

    async def list_phases_for_saga(self, saga_id: UUID) -> list[Phase]:
        return self.phases

    async def update_phase_status(self, phase_id: UUID, status: PhaseStatus) -> Phase | None:
        self.phase_status_updates.append((phase_id, status))
        for i, p in enumerate(self.phases):
            if p.id == phase_id:
                updated = Phase(
                    id=p.id,
                    saga_id=p.saga_id,
                    tracker_id=p.tracker_id,
                    number=p.number,
                    name=p.name,
                    status=status,
                    confidence=p.confidence,
                )
                self.phases[i] = updated
                return updated
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PHASE_ID = uuid4()
SAGA_ID = uuid4()


def _make_raid(
    raid_id: UUID | None = None,
    status: RaidStatus = RaidStatus.REVIEW,
    confidence: float = 0.5,
    pr_id: str | None = "https://api.github.com/repos/org/repo/pulls/42",
    branch: str | None = "raid/test-branch",
    declared_files: list[str] | None = None,
    retry_count: int = 0,
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=PHASE_ID,
        tracker_id="NIU-100",
        name="Test raid",
        description="A test raid",
        acceptance_criteria=["tests pass"],
        declared_files=declared_files or ["src/main.py", "tests/test_main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=confidence,
        session_id="session-1",
        branch=branch,
        chronicle_summary="All tests pass",
        pr_url="https://github.com/org/repo/pull/42",
        pr_id=pr_id,
        retry_count=retry_count,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_saga() -> Saga:
    return Saga(
        id=SAGA_ID,
        tracker_id="proj-1",
        tracker_type="linear",
        slug="alpha",
        name="Alpha",
        repos=["org/repo"],
        feature_branch="feat/alpha",
        status=SagaStatus.ACTIVE,
        confidence=0.5,
        created_at=NOW,
        owner_id="user-1",
    )


def _make_phase(
    phase_id: UUID | None = None,
    number: int = 1,
    status: PhaseStatus = PhaseStatus.ACTIVE,
) -> Phase:
    return Phase(
        id=phase_id or PHASE_ID,
        saga_id=SAGA_ID,
        tracker_id=f"phase-{number}",
        number=number,
        name=f"Phase {number}",
        status=status,
        confidence=0.5,
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
    raid_repo: StubRaidRepo | None = None,
    git: StubGit | None = None,
    config: ReviewConfig | None = None,
    event_bus: EventBus | None = None,
) -> tuple[ReviewEngine, StubRaidRepo, StubGit, EventBus]:
    r = raid_repo or StubRaidRepo()
    g = git or StubGit()
    e = event_bus or EventBus()
    c = config or _default_config()
    engine = ReviewEngine(raid_repo=r, git=g, review_config=c, event_bus=e)
    return engine, r, g, e


def _setup_passing_pr(git: StubGit, pr_id: str) -> None:
    """Set up a PR that has passed CI and is mergeable."""
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=True,
    )


def _setup_failing_pr(git: StubGit, pr_id: str) -> None:
    """Set up a PR with failing CI."""
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=True,
        ci_passed=False,
    )


def _setup_conflicted_pr(git: StubGit, pr_id: str) -> None:
    """Set up a PR with merge conflicts."""
    git.pr_statuses[pr_id] = PRStatus(
        pr_id=pr_id,
        url="https://github.com/org/repo/pull/42",
        state="open",
        mergeable=False,
        ci_passed=True,
    )


# ---------------------------------------------------------------------------
# Tests: detect_scope_breach
# ---------------------------------------------------------------------------


class TestScopeBreachDetection:
    def test_no_changed_files(self) -> None:
        assert detect_scope_breach(["src/main.py"], [], 0.30) is False

    def test_all_files_declared(self) -> None:
        declared = ["src/main.py", "tests/test_main.py"]
        changed = ["src/main.py", "tests/test_main.py"]
        assert detect_scope_breach(declared, changed, 0.30) is False

    def test_below_threshold(self) -> None:
        declared = ["src/a.py", "src/b.py", "src/c.py"]
        changed = ["src/a.py", "src/b.py", "src/c.py", "src/d.py"]
        # 1/4 = 0.25 which is < 0.30
        assert detect_scope_breach(declared, changed, 0.30) is False

    def test_above_threshold(self) -> None:
        declared = ["src/a.py"]
        changed = ["src/a.py", "src/b.py", "src/c.py", "src/d.py"]
        # 3/4 = 0.75 which is > 0.30
        assert detect_scope_breach(declared, changed, 0.30) is True

    def test_exactly_at_threshold(self) -> None:
        declared = ["src/a.py", "src/b.py"]
        changed = ["src/a.py", "src/b.py", "src/c.py"]
        # 1/3 = 0.333... which is > 0.30
        assert detect_scope_breach(declared, changed, 0.30) is True

    def test_empty_declared_files(self) -> None:
        changed = ["src/a.py"]
        # 1/1 = 1.0 which is > 0.30
        assert detect_scope_breach([], changed, 0.30) is True


# ---------------------------------------------------------------------------
# Tests: Auto-approve
# ---------------------------------------------------------------------------


class TestAutoApprove:
    @pytest.mark.asyncio
    async def test_auto_approve_high_confidence(self) -> None:
        """Raid with high confidence, passing CI, and mergeable PR is auto-approved."""
        engine, repo, git, bus = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        pr_id = raid.pr_id
        _setup_passing_pr(git, pr_id)
        git.changed_files[pr_id] = ["src/main.py", "tests/test_main.py"]

        result = await engine.evaluate(raid.id)

        assert result.action == "auto_approved"
        assert repo.raids[raid.id].status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_auto_approve_merges_branch(self) -> None:
        """Auto-approve should merge the raid branch into the feature branch."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        await engine.evaluate(raid.id)

        assert len(git.merged) == 1
        assert git.merged[0] == ("org/repo", "raid/test-branch", "feat/alpha")
        assert len(git.deleted) == 1
        assert git.deleted[0] == ("org/repo", "raid/test-branch")

    @pytest.mark.asyncio
    async def test_auto_approve_emits_events(self) -> None:
        """Auto-approve should emit raid.state_changed and confidence.updated events."""
        engine, repo, git, bus = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        q = bus.subscribe()
        await engine.evaluate(raid.id)

        events = []
        while not q.empty():
            events.append(await q.get())

        event_types = [e.event for e in events]
        assert "confidence.updated" in event_types
        assert "raid.state_changed" in event_types

        state_event = next(e for e in events if e.event == "raid.state_changed")
        assert state_event.data["action"] == "auto_approved"

    @pytest.mark.asyncio
    async def test_auto_approve_records_confidence_events(self) -> None:
        """Auto-approve should record CI_PASS and AUTO_APPROVED confidence events."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        event_types = [e.event_type for e in events]
        assert ConfidenceEventType.CI_PASS in event_types
        assert ConfidenceEventType.AUTO_APPROVED in event_types

    @pytest.mark.asyncio
    async def test_merge_failure_does_not_block_approval(self) -> None:
        """If branch merge fails, the raid should still transition to MERGED."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]
        git.fail_merge = True

        result = await engine.evaluate(raid.id)

        assert result.action == "auto_approved"
        assert repo.raids[raid.id].status == RaidStatus.MERGED


# ---------------------------------------------------------------------------
# Tests: CI failure
# ---------------------------------------------------------------------------


class TestCIFailure:
    @pytest.mark.asyncio
    async def test_ci_failure_auto_retry(self) -> None:
        """CI failure with retries remaining should auto-retry (REVIEW → PENDING)."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(retry_count=0)
        repo.raids[raid.id] = raid

        _setup_failing_pr(git, raid.pr_id)

        result = await engine.evaluate(raid.id)

        assert result.action == "retried"
        assert repo.raids[raid.id].status == RaidStatus.PENDING
        assert repo.raids[raid.id].retry_count == 1

    @pytest.mark.asyncio
    async def test_ci_failure_retries_exhausted(self) -> None:
        """CI failure with no retries left should transition to FAILED."""
        config = _default_config(max_retries=3)
        engine, repo, git, _ = _make_engine(config=config)
        raid = _make_raid(retry_count=3)
        repo.raids[raid.id] = raid

        _setup_failing_pr(git, raid.pr_id)

        result = await engine.evaluate(raid.id)

        assert result.action == "failed"
        assert repo.raids[raid.id].status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_ci_failure_emits_ci_fail_event(self) -> None:
        """CI failure should record a CI_FAIL confidence event."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid()
        repo.raids[raid.id] = raid

        _setup_failing_pr(git, raid.pr_id)

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        event_types = [e.event_type for e in events]
        assert ConfidenceEventType.CI_FAIL in event_types


# ---------------------------------------------------------------------------
# Tests: PR conflicts
# ---------------------------------------------------------------------------


class TestPRConflicts:
    @pytest.mark.asyncio
    async def test_conflict_auto_retry(self) -> None:
        """PR with conflicts and retries remaining should auto-retry."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(retry_count=0)
        repo.raids[raid.id] = raid

        _setup_conflicted_pr(git, raid.pr_id)

        result = await engine.evaluate(raid.id)

        assert result.action == "retried"
        assert repo.raids[raid.id].status == RaidStatus.PENDING

    @pytest.mark.asyncio
    async def test_conflict_retries_exhausted(self) -> None:
        """PR with conflicts and no retries left should fail."""
        config = _default_config(max_retries=2)
        engine, repo, git, _ = _make_engine(config=config)
        raid = _make_raid(retry_count=2)
        repo.raids[raid.id] = raid

        _setup_conflicted_pr(git, raid.pr_id)

        result = await engine.evaluate(raid.id)

        assert result.action == "failed"
        assert repo.raids[raid.id].status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_conflict_records_pr_conflict_event(self) -> None:
        """PR conflict should record a PR_CONFLICT confidence event."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid()
        repo.raids[raid.id] = raid

        _setup_conflicted_pr(git, raid.pr_id)

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        event_types = [e.event_type for e in events]
        assert ConfidenceEventType.PR_CONFLICT in event_types


# ---------------------------------------------------------------------------
# Tests: Scope breach
# ---------------------------------------------------------------------------


class TestScopeBreach:
    @pytest.mark.asyncio
    async def test_scope_breach_lowers_confidence(self) -> None:
        """Scope breach should apply a negative confidence delta."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(
            declared_files=["src/main.py"],
        )
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        # 3 out of 4 files are undeclared → 75% breach
        git.changed_files[raid.pr_id] = [
            "src/main.py",
            "src/extra1.py",
            "src/extra2.py",
            "src/extra3.py",
        ]

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        event_types = [e.event_type for e in events]
        assert ConfidenceEventType.SCOPE_BREACH in event_types

    @pytest.mark.asyncio
    async def test_no_scope_breach_within_threshold(self) -> None:
        """No scope breach when undeclared files are within threshold."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(
            declared_files=["src/main.py", "src/b.py", "src/c.py"],
        )
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        # 1 out of 4 files undeclared → 25% < 30%
        git.changed_files[raid.pr_id] = ["src/main.py", "src/b.py", "src/c.py", "src/d.py"]

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        event_types = [e.event_type for e in events]
        assert ConfidenceEventType.SCOPE_BREACH not in event_types


# ---------------------------------------------------------------------------
# Tests: Escalation
# ---------------------------------------------------------------------------


class TestEscalation:
    @pytest.mark.asyncio
    async def test_low_confidence_escalates(self) -> None:
        """Confidence below threshold should escalate to human review."""
        config = _default_config(auto_approve_threshold=0.95)
        engine, repo, git, _ = _make_engine(config=config)
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        result = await engine.evaluate(raid.id)

        assert result.action == "escalated"
        # Raid stays in REVIEW
        assert repo.raids[raid.id].status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_no_pr_escalates(self) -> None:
        """Raid without a PR ID should escalate to human review."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(pr_id=None, confidence=0.9)
        repo.raids[raid.id] = raid

        result = await engine.evaluate(raid.id)

        assert result.action == "escalated"

    @pytest.mark.asyncio
    async def test_pr_status_fetch_failure_escalates(self) -> None:
        """If PR status cannot be fetched, escalate to human review."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.9)
        repo.raids[raid.id] = raid
        git.fail_pr_status = True

        result = await engine.evaluate(raid.id)

        assert result.action == "escalated"


# ---------------------------------------------------------------------------
# Tests: Retry penalty
# ---------------------------------------------------------------------------


class TestRetryPenalty:
    @pytest.mark.asyncio
    async def test_retry_count_applies_penalty(self) -> None:
        """Previous retries should apply a cumulative confidence penalty."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5, retry_count=2)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        retry_events = [e for e in events if e.event_type == ConfidenceEventType.RETRY]
        assert len(retry_events) == 1
        # -0.05 * 2 = -0.10
        assert retry_events[0].delta == pytest.approx(-0.10)

    @pytest.mark.asyncio
    async def test_zero_retries_no_penalty(self) -> None:
        """First attempt should not apply a retry penalty."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5, retry_count=0)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        await engine.evaluate(raid.id)

        events = repo.events[raid.id]
        retry_events = [e for e in events if e.event_type == ConfidenceEventType.RETRY]
        assert len(retry_events) == 0


# ---------------------------------------------------------------------------
# Tests: Phase gate
# ---------------------------------------------------------------------------


class TestPhaseGate:
    @pytest.mark.asyncio
    async def test_phase_gate_unlocked(self) -> None:
        """When all raids in a phase are merged, the next phase is unlocked."""
        engine, repo, git, bus = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo._all_merged = True

        phase1 = _make_phase(phase_id=PHASE_ID, number=1, status=PhaseStatus.ACTIVE)
        next_phase_id = uuid4()
        phase2 = _make_phase(phase_id=next_phase_id, number=2, status=PhaseStatus.GATED)
        repo.phase = phase1
        repo.phases = [phase1, phase2]

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        q = bus.subscribe()
        result = await engine.evaluate(raid.id)

        assert result.phase_gate_unlocked is True

        # Verify next phase was unlocked
        assert len(repo.phase_status_updates) == 1
        assert repo.phase_status_updates[0] == (next_phase_id, PhaseStatus.ACTIVE)

        # Verify phase.unlocked event emitted
        events = []
        while not q.empty():
            events.append(await q.get())
        phase_events = [e for e in events if e.event == "phase.unlocked"]
        assert len(phase_events) == 1
        assert phase_events[0].data["phase_id"] == str(next_phase_id)

    @pytest.mark.asyncio
    async def test_no_phase_gate_when_raids_remain(self) -> None:
        """Phase gate should not unlock when not all raids are merged."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()
        repo._all_merged = False

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        result = await engine.evaluate(raid.id)

        assert result.phase_gate_unlocked is False
        assert len(repo.phase_status_updates) == 0

    @pytest.mark.asyncio
    async def test_no_next_phase(self) -> None:
        """Phase gate unlocked but no next phase — should return True without error."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo._all_merged = True
        repo.phase = _make_phase()
        repo.phases = [_make_phase()]  # Only one phase

        _setup_passing_pr(git, raid.pr_id)
        git.changed_files[raid.pr_id] = ["src/main.py"]

        result = await engine.evaluate(raid.id)

        assert result.phase_gate_unlocked is True
        assert len(repo.phase_status_updates) == 0


# ---------------------------------------------------------------------------
# Tests: Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @pytest.mark.asyncio
    async def test_raid_not_found(self) -> None:
        """Evaluating a non-existent raid should raise ValueError."""
        engine, _, _, _ = _make_engine()
        with pytest.raises(ValueError, match="Raid not found"):
            await engine.evaluate(uuid4())

    @pytest.mark.asyncio
    async def test_wrong_state(self) -> None:
        """Evaluating a raid not in REVIEW should raise ValueError."""
        engine, repo, _, _ = _make_engine()
        raid = _make_raid(status=RaidStatus.RUNNING)
        repo.raids[raid.id] = raid

        with pytest.raises(ValueError, match="not in REVIEW"):
            await engine.evaluate(raid.id)

    @pytest.mark.asyncio
    async def test_changed_files_failure_does_not_block(self) -> None:
        """If fetching changed files fails, review should still proceed."""
        engine, repo, git, _ = _make_engine()
        raid = _make_raid(confidence=0.5)
        repo.raids[raid.id] = raid
        repo.saga = _make_saga()
        repo.phase = _make_phase()

        _setup_passing_pr(git, raid.pr_id)
        git.fail_changed_files = True

        result = await engine.evaluate(raid.id)

        # Should still auto-approve (no scope breach without file data)
        assert result.action == "auto_approved"


# ---------------------------------------------------------------------------
# Tests: Config
# ---------------------------------------------------------------------------


class TestReviewConfig:
    def test_new_config_defaults(self) -> None:
        cfg = ReviewConfig()
        assert cfg.auto_approve_threshold == 0.80
        assert cfg.max_retries == 3
        assert cfg.scope_breach_threshold == 0.30
        assert cfg.confidence_delta_ci_pass == 0.30
        assert cfg.confidence_delta_ci_fail == -0.30
        assert cfg.confidence_delta_mergeable == 0.10
        assert cfg.confidence_delta_conflict == -0.20
        assert cfg.confidence_delta_scope_breach == -0.25
        assert cfg.confidence_delta_retry_multiplier == -0.05

    def test_custom_config(self) -> None:
        cfg = ReviewConfig(auto_approve_threshold=0.90, max_retries=5)
        assert cfg.auto_approve_threshold == 0.90
        assert cfg.max_retries == 5


# ---------------------------------------------------------------------------
# Tests: Watcher integration
# ---------------------------------------------------------------------------


class TestWatcherIntegration:
    @pytest.mark.asyncio
    async def test_watcher_triggers_review_on_completion(self) -> None:
        """Watcher should call the review callback when a raid enters REVIEW."""
        from tyr.config import WatcherConfig
        from tyr.domain.models import DispatcherState
        from tyr.domain.services.watcher import RaidWatcher
        from tyr.ports.dispatcher_repository import DispatcherRepository

        class StubDispatcherRepo(DispatcherRepository):
            async def get_or_create(self, owner_id: str) -> DispatcherState:
                return DispatcherState(
                    id=uuid4(),
                    owner_id=owner_id,
                    running=True,
                    threshold=0.5,
                    max_concurrent_raids=3,
                    updated_at=NOW,
                )

            async def update(self, owner_id: str, **fields: object) -> DispatcherState:
                return await self.get_or_create(owner_id)

        from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

        class StubVolundr(VolundrPort):
            async def spawn_session(
                self, request: SpawnRequest, *, auth_token: str | None = None
            ) -> VolundrSession:
                raise NotImplementedError

            async def get_session(
                self, session_id: str, *, auth_token: str | None = None
            ) -> VolundrSession | None:
                return VolundrSession(
                    id=session_id, name="s", status="completed", tracker_issue_id=None
                )

            async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
                return []

            async def get_pr_status(self, session_id: str) -> PRStatus:
                return PRStatus(
                    pr_id="PR-42",
                    url="https://github.com/org/repo/pull/42",
                    state="open",
                    mergeable=True,
                    ci_passed=True,
                )

            async def get_chronicle_summary(self, session_id: str) -> str:
                return "Done"

            async def send_message(
                self, session_id: str, message: str, *, auth_token: str | None = None
            ) -> None:
                pass

        review_called: list[UUID] = []

        async def on_review(raid_id: UUID) -> None:
            review_called.append(raid_id)

        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga()
        raid = _make_raid(status=RaidStatus.RUNNING)
        raid_repo.raids[raid.id] = raid

        bus = EventBus()
        config = WatcherConfig(enabled=True, poll_interval=1.0, batch_size=10)

        watcher = RaidWatcher(
            volundr=StubVolundr(),
            raid_repo=raid_repo,
            dispatcher_repo=StubDispatcherRepo(),
            event_bus=bus,
            config=config,
            on_review=on_review,
        )

        await watcher._poll_cycle()

        assert len(review_called) == 1
        assert review_called[0] == raid.id

    @pytest.mark.asyncio
    async def test_watcher_handles_review_error_gracefully(self) -> None:
        """Watcher should log but not crash if the review callback raises."""
        from tyr.config import WatcherConfig
        from tyr.domain.models import DispatcherState
        from tyr.domain.services.watcher import RaidWatcher
        from tyr.ports.dispatcher_repository import DispatcherRepository

        class StubDispatcherRepo(DispatcherRepository):
            async def get_or_create(self, owner_id: str) -> DispatcherState:
                return DispatcherState(
                    id=uuid4(),
                    owner_id=owner_id,
                    running=True,
                    threshold=0.5,
                    max_concurrent_raids=3,
                    updated_at=NOW,
                )

            async def update(self, owner_id: str, **fields: object) -> DispatcherState:
                return await self.get_or_create(owner_id)

        from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

        class StubVolundr(VolundrPort):
            async def spawn_session(
                self, request: SpawnRequest, *, auth_token: str | None = None
            ) -> VolundrSession:
                raise NotImplementedError

            async def get_session(
                self, session_id: str, *, auth_token: str | None = None
            ) -> VolundrSession | None:
                return VolundrSession(
                    id=session_id, name="s", status="completed", tracker_issue_id=None
                )

            async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
                return []

            async def get_pr_status(self, session_id: str) -> PRStatus:
                return PRStatus(
                    pr_id="PR-42", url="url", state="open", mergeable=True, ci_passed=True
                )

            async def get_chronicle_summary(self, session_id: str) -> str:
                return "Done"

            async def send_message(
                self, session_id: str, message: str, *, auth_token: str | None = None
            ) -> None:
                pass

        async def failing_review(raid_id: UUID) -> None:
            raise RuntimeError("Review engine exploded")

        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga()
        raid = _make_raid(status=RaidStatus.RUNNING)
        raid_repo.raids[raid.id] = raid

        bus = EventBus()
        config = WatcherConfig(enabled=True, poll_interval=1.0, batch_size=10)

        watcher = RaidWatcher(
            volundr=StubVolundr(),
            raid_repo=raid_repo,
            dispatcher_repo=StubDispatcherRepo(),
            event_bus=bus,
            config=config,
            on_review=failing_review,
        )

        # Should not raise
        stats = await watcher._poll_cycle()
        assert stats.transitioned == 1
        # Raid still transitioned to REVIEW despite review failure
        assert raid_repo.raids[raid.id].status == RaidStatus.REVIEW


# ---------------------------------------------------------------------------
# Tests: ConfidenceEventType new values
# ---------------------------------------------------------------------------


class TestNewConfidenceEventTypes:
    def test_auto_approved_exists(self) -> None:
        assert ConfidenceEventType.AUTO_APPROVED == "auto_approved"

    def test_pr_conflict_exists(self) -> None:
        assert ConfidenceEventType.PR_CONFLICT == "pr_conflict"

    def test_all_values_serializable(self) -> None:
        for evt in ConfidenceEventType:
            assert isinstance(evt.value, str)
