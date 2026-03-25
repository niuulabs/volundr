"""Tests for Tyr domain models."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from tyr.domain.exceptions import InvalidStateTransitionError
from tyr.domain.models import (
    RAID_TRANSITIONS,
    ConfidenceEvent,
    ConfidenceEventType,
    DispatcherState,
    Phase,
    PhaseSpec,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidSpec,
    RaidStatus,
    Saga,
    SagaStatus,
    SagaStructure,
    SessionInfo,
    validate_transition,
)

# ---------------------------------------------------------------------------
# Enum values
# ---------------------------------------------------------------------------


class TestSagaStatus:
    def test_values(self) -> None:
        assert SagaStatus.ACTIVE == "ACTIVE"
        assert SagaStatus.COMPLETE == "COMPLETE"
        assert SagaStatus.FAILED == "FAILED"

    def test_member_count(self) -> None:
        assert len(SagaStatus) == 3


class TestPhaseStatus:
    def test_values(self) -> None:
        assert PhaseStatus.PENDING == "PENDING"
        assert PhaseStatus.ACTIVE == "ACTIVE"
        assert PhaseStatus.GATED == "GATED"
        assert PhaseStatus.COMPLETE == "COMPLETE"

    def test_member_count(self) -> None:
        assert len(PhaseStatus) == 4


class TestRaidStatus:
    def test_values(self) -> None:
        assert RaidStatus.PENDING == "PENDING"
        assert RaidStatus.QUEUED == "QUEUED"
        assert RaidStatus.RUNNING == "RUNNING"
        assert RaidStatus.REVIEW == "REVIEW"
        assert RaidStatus.MERGED == "MERGED"
        assert RaidStatus.FAILED == "FAILED"

    def test_member_count(self) -> None:
        assert len(RaidStatus) == 6


class TestConfidenceEventType:
    def test_values(self) -> None:
        assert ConfidenceEventType.CI_PASS == "ci_pass"
        assert ConfidenceEventType.CI_FAIL == "ci_fail"
        assert ConfidenceEventType.SCOPE_BREACH == "scope_breach"
        assert ConfidenceEventType.RETRY == "retry"
        assert ConfidenceEventType.HUMAN_REJECT == "human_reject"
        assert ConfidenceEventType.HUMAN_APPROVED == "human_approved"

    def test_member_count(self) -> None:
        assert len(ConfidenceEventType) == 6


# ---------------------------------------------------------------------------
# State machine transitions
# ---------------------------------------------------------------------------


class TestRaidTransitions:
    def test_pending_to_queued(self) -> None:
        validate_transition(RaidStatus.PENDING, RaidStatus.QUEUED)

    def test_queued_to_running(self) -> None:
        validate_transition(RaidStatus.QUEUED, RaidStatus.RUNNING)

    def test_queued_to_failed(self) -> None:
        validate_transition(RaidStatus.QUEUED, RaidStatus.FAILED)

    def test_running_to_review(self) -> None:
        validate_transition(RaidStatus.RUNNING, RaidStatus.REVIEW)

    def test_running_to_merged(self) -> None:
        validate_transition(RaidStatus.RUNNING, RaidStatus.MERGED)

    def test_running_to_failed(self) -> None:
        validate_transition(RaidStatus.RUNNING, RaidStatus.FAILED)

    def test_review_to_queued(self) -> None:
        validate_transition(RaidStatus.REVIEW, RaidStatus.QUEUED)

    def test_review_to_merged(self) -> None:
        validate_transition(RaidStatus.REVIEW, RaidStatus.MERGED)

    def test_review_to_failed(self) -> None:
        validate_transition(RaidStatus.REVIEW, RaidStatus.FAILED)

    def test_failed_to_queued(self) -> None:
        validate_transition(RaidStatus.FAILED, RaidStatus.QUEUED)

    def test_merged_is_terminal(self) -> None:
        for target in RaidStatus:
            if target == RaidStatus.MERGED:
                continue
            with pytest.raises(InvalidStateTransitionError):
                validate_transition(RaidStatus.MERGED, target)

    def test_invalid_pending_to_running(self) -> None:
        with pytest.raises(InvalidStateTransitionError) as exc_info:
            validate_transition(RaidStatus.PENDING, RaidStatus.RUNNING)
        assert exc_info.value.current == RaidStatus.PENDING
        assert exc_info.value.target == RaidStatus.RUNNING

    def test_invalid_pending_to_merged(self) -> None:
        with pytest.raises(InvalidStateTransitionError):
            validate_transition(RaidStatus.PENDING, RaidStatus.MERGED)

    def test_transition_map_covers_all_statuses(self) -> None:
        for status in RaidStatus:
            assert status in RAID_TRANSITIONS


# ---------------------------------------------------------------------------
# Dataclass creation
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC)


class TestSaga:
    def test_create(self) -> None:
        saga = Saga(
            id=uuid4(),
            tracker_id="LIN-100",
            tracker_type="linear",
            slug="my-saga",
            name="My Saga",
            repos=["niuulabs/volundr"],
            feature_branch="feat/my-saga",
            status=SagaStatus.ACTIVE,
            confidence=0.9,
            created_at=NOW,
        )
        assert saga.tracker_id == "LIN-100"
        assert saga.name == "My Saga"
        assert saga.status == SagaStatus.ACTIVE
        assert saga.confidence == 0.9
        assert saga.repos == ["niuulabs/volundr"]
        assert saga.feature_branch == "feat/my-saga"

    def test_frozen(self) -> None:
        saga = Saga(
            id=uuid4(),
            tracker_id="LIN-100",
            tracker_type="linear",
            slug="s",
            name="S",
            repos=["r"],
            feature_branch="feat/test",
            status=SagaStatus.ACTIVE,
            confidence=0.5,
            created_at=NOW,
        )
        with pytest.raises(AttributeError):
            saga.slug = "changed"  # type: ignore[misc]


class TestPhase:
    def test_create(self) -> None:
        phase = Phase(
            id=uuid4(),
            saga_id=uuid4(),
            tracker_id="LIN-101",
            number=1,
            name="Phase 1",
            status=PhaseStatus.PENDING,
            confidence=0.8,
        )
        assert phase.number == 1
        assert phase.status == PhaseStatus.PENDING


class TestRaid:
    def test_create(self) -> None:
        raid = Raid(
            id=uuid4(),
            phase_id=uuid4(),
            tracker_id="LIN-102",
            name="Raid 1",
            description="Implement the feature",
            acceptance_criteria=["Tests pass", "Coverage > 85%"],
            declared_files=["src/foo.py"],
            estimate_hours=2.0,
            status=RaidStatus.PENDING,
            confidence=0.75,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            pr_url=None,
            pr_id=None,
            retry_count=0,
            created_at=NOW,
            updated_at=NOW,
        )
        assert raid.description == "Implement the feature"
        assert len(raid.acceptance_criteria) == 2
        assert raid.declared_files == ["src/foo.py"]
        assert raid.estimate_hours == 2.0
        assert raid.session_id is None


class TestConfidenceEvent:
    def test_create(self) -> None:
        event = ConfidenceEvent(
            id=uuid4(),
            raid_id=uuid4(),
            event_type=ConfidenceEventType.CI_PASS,
            delta=0.1,
            score_after=0.85,
            created_at=NOW,
        )
        assert event.event_type == ConfidenceEventType.CI_PASS
        assert event.delta == 0.1


class TestDispatcherState:
    def test_create(self) -> None:
        state = DispatcherState(
            id=uuid4(),
            owner_id="user-1",
            running=True,
            threshold=0.7,
            max_concurrent_raids=3,
            updated_at=NOW,
        )
        assert state.running is True
        assert state.threshold == 0.7
        assert state.owner_id == "user-1"
        assert state.max_concurrent_raids == 3


class TestSessionInfo:
    def test_create(self) -> None:
        info = SessionInfo(session_id="sess-1", status="running")
        assert info.session_id == "sess-1"


class TestPRStatus:
    def test_create(self) -> None:
        pr = PRStatus(
            pr_id="PR-1",
            url="https://github.com/org/repo/pull/1",
            state="open",
            mergeable=True,
            ci_passed=None,
        )
        assert pr.url == "https://github.com/org/repo/pull/1"
        assert pr.mergeable is True
        assert pr.ci_passed is None


class TestSpecStructures:
    def test_raid_spec(self) -> None:
        spec = RaidSpec(
            name="Add models",
            description="Create domain models",
            acceptance_criteria=["Tests pass"],
            declared_files=["models.py"],
            estimate_hours=1.5,
            confidence=0.9,
        )
        assert spec.estimate_hours == 1.5
        assert spec.confidence == 0.9

    def test_phase_spec(self) -> None:
        raid = RaidSpec(
            name="r1",
            description="d",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=1.0,
            confidence=0.5,
        )
        phase = PhaseSpec(name="Phase 1", raids=[raid])
        assert len(phase.raids) == 1

    def test_saga_structure(self) -> None:
        structure = SagaStructure(name="Test Saga", phases=[])
        assert structure.phases == []
        assert structure.name == "Test Saga"
