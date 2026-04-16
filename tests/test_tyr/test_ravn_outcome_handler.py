"""Tests for NIU-614 — Tyr ravn.task.completed outcome ingestion.

Covers:
  - _extract_outcome: payload → RavnOutcome mapping
  - ReviewEngine.handle_ravn_outcome: confidence signals + decision logic
  - RavnOutcomeHandler._process_event: correlation lookup, missing raid, happy path
  - Integration: InProcessBus round-trip (publish → state transition)
  - Coexistence: raid already terminal when outcome arrives → skipped
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.events import SleipnirEvent
from tests.test_tyr.stubs import StubVolundrFactory
from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.adapters.ravn_outcome_handler import RavnOutcomeHandler, _extract_outcome
from tyr.config import ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    Phase,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    RavnOutcome,
    Saga,
    SessionMessage,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.domain.services.review_engine import ReviewEngine
from tyr.ports.git import GitPort
from tyr.ports.tracker import TrackerPort

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC)
_OWNER = "test-owner"
_SESSION = "sess-ravn-001"
_TRACKER_ID = "raid-tracker-001"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    *,
    status: RaidStatus = RaidStatus.REVIEW,
    confidence: float = 0.5,
    session_id: str | None = _SESSION,
    retry_count: int = 0,
) -> Raid:
    return Raid(
        id=uuid4(),
        phase_id=uuid4(),
        tracker_id=_TRACKER_ID,
        name="test-raid",
        description="A test raid",
        acceptance_criteria=[],
        declared_files=[],
        estimate_hours=1.0,
        status=status,
        confidence=confidence,
        session_id=session_id,
        branch=None,
        chronicle_summary=None,
        pr_url=None,
        pr_id=None,
        retry_count=retry_count,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_sleipnir_event(
    payload: dict | None = None,
    *,
    correlation_id: str | None = _SESSION,
) -> SleipnirEvent:
    return SleipnirEvent(
        event_type="ravn.task.completed",
        source="ravn:coordinator",
        payload=payload or {},
        summary="task completed",
        urgency=0.8,
        domain="code",
        timestamp=NOW,
        correlation_id=correlation_id,
    )


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class StubGit(GitPort):
    async def create_branch(self, repo: str, branch: str, base: str) -> None:
        pass

    async def merge_branch(self, repo: str, source: str, target: str) -> None:
        pass

    async def delete_branch(self, repo: str, branch: str) -> None:
        pass

    async def create_pr(self, repo: str, source: str, target: str, title: str) -> str:
        return "pr-1"

    async def get_pr_status(self, pr_id: str) -> PRStatus:
        raise RuntimeError("no PR in stub")

    async def get_pr_changed_files(self, pr_id: str) -> list[str]:
        return []


class StubTracker(TrackerPort):
    """Minimal in-memory tracker for ravn outcome tests."""

    def __init__(self, raid: Raid | None = None) -> None:
        self._raid = raid
        self._raids_by_session: dict[str, Raid] = {}
        if raid is not None:
            self._raids_by_id = {raid.tracker_id: raid}
            if raid.session_id:
                self._raids_by_session[raid.session_id] = raid
        else:
            self._raids_by_id: dict[str, Raid] = {}
        self.confidence_events: dict[str, list[ConfidenceEvent]] = {}
        self.phase: Phase | None = None
        self.saga: Saga | None = None
        self._phases: list[Phase] = []
        self._all_merged: bool = False
        self.closed_raids: list[str] = []

    # -- CRUD: create entities --

    async def create_saga(self, saga: Saga, *, description: str = "") -> str:
        return saga.tracker_id

    async def create_phase(self, phase: Phase, *, project_id: str = "") -> str:
        return phase.tracker_id

    async def create_raid(self, raid: Raid, *, project_id: str = "", milestone_id: str = "") -> str:
        self._raids_by_id[raid.tracker_id] = raid
        if raid.session_id:
            self._raids_by_session[raid.session_id] = raid
        return raid.tracker_id

    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None:
        pass

    async def close_raid(self, raid_id: str) -> None:
        self.closed_raids.append(raid_id)

    # -- Read --

    async def get_saga(self, saga_id: str) -> Saga:
        if self.saga is None:
            raise ValueError("No saga")
        return self.saga

    async def get_phase(self, tracker_id: str) -> Phase:
        if self.phase is None:
            raise ValueError("No phase")
        return self.phase

    async def get_raid(self, tracker_id: str) -> Raid:
        raid = self._raids_by_id.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        return raid

    async def list_pending_raids(self, phase_id: str) -> list[Raid]:
        return []

    async def list_projects(self) -> list[TrackerProject]:
        return []

    async def get_project(self, project_id: str) -> TrackerProject:
        raise NotImplementedError

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        return []

    async def list_issues(
        self, project_id: str, milestone_id: str | None = None
    ) -> list[TrackerIssue]:
        return []

    # -- Raid progress --

    async def update_raid_progress(
        self,
        tracker_id: str,
        *,
        status: RaidStatus | None = None,
        session_id: str | None = None,
        confidence: float | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        retry_count: int | None = None,
        reason: str | None = None,
        owner_id: str | None = None,
        phase_tracker_id: str | None = None,
        saga_tracker_id: str | None = None,
        chronicle_summary: str | None = None,
        reviewer_session_id: str | None = None,
        review_round: int | None = None,
    ) -> Raid:
        raid = self._raids_by_id.get(tracker_id)
        if raid is None:
            raise ValueError(f"Raid not found: {tracker_id}")
        events = self.confidence_events.get(tracker_id, [])
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
            updated_at=NOW,
            reviewer_session_id=(
                reviewer_session_id if reviewer_session_id is not None else raid.reviewer_session_id
            ),
            review_round=review_round if review_round is not None else raid.review_round,
        )
        self._raids_by_id[tracker_id] = updated
        if updated.session_id:
            self._raids_by_session[updated.session_id] = updated
        return updated

    async def get_raid_progress_for_saga(self, saga_tracker_id: str) -> list[Raid]:
        return list(self._raids_by_id.values())

    async def get_raid_by_session(self, session_id: str) -> Raid | None:
        return self._raids_by_session.get(session_id)

    async def list_raids_by_status(self, status: RaidStatus) -> list[Raid]:
        return [r for r in self._raids_by_id.values() if r.status == status]

    async def get_raid_by_id(self, raid_id: UUID) -> Raid | None:
        return next((r for r in self._raids_by_id.values() if r.id == raid_id), None)

    async def add_confidence_event(self, tracker_id: str, event: ConfidenceEvent) -> None:
        self.confidence_events.setdefault(tracker_id, []).append(event)

    async def get_confidence_events(self, tracker_id: str) -> list[ConfidenceEvent]:
        return self.confidence_events.get(tracker_id, [])

    async def all_raids_merged(self, phase_tracker_id: str) -> bool:
        return self._all_merged

    async def list_phases_for_saga(self, saga_tracker_id: str) -> list[Phase]:
        return self._phases

    async def update_phase_status(self, phase_tracker_id: str, status: PhaseStatus) -> Phase | None:
        return None

    async def get_saga_for_raid(self, tracker_id: str) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, tracker_id: str) -> Phase | None:
        return self.phase

    async def get_owner_for_raid(self, tracker_id: str) -> str | None:
        return _OWNER

    async def save_session_message(self, message: SessionMessage) -> None:
        pass

    async def get_session_messages(self, tracker_id: str) -> list[SessionMessage]:
        return []

    async def attach_issue_document(self, issue_id: str, title: str, content: str) -> str:
        return "doc-1"


class StubTrackerFactory:
    def __init__(self, tracker: StubTracker) -> None:
        self._tracker = tracker

    async def for_owner(self, owner_id: str) -> list[StubTracker]:
        return [self._tracker]


def _make_engine(tracker: StubTracker, event_bus: InMemoryEventBus | None = None) -> ReviewEngine:
    factory = StubTrackerFactory(tracker)
    return ReviewEngine(
        tracker_factory=factory,
        volundr_factory=StubVolundrFactory(),
        git=StubGit(),
        review_config=ReviewConfig(
            reviewer_session_enabled=False,
            auto_approve_threshold=0.80,
        ),
        event_bus=event_bus,
    )


# ---------------------------------------------------------------------------
# Unit: _extract_outcome
# ---------------------------------------------------------------------------


class TestExtractOutcome:
    def test_full_payload(self):
        payload = {
            "verdict": "approve",
            "tests_passing": True,
            "scope_adherence": 0.95,
            "pr_url": "https://github.com/pr/1",
            "files_changed": ["a.py", "b.py"],
            "summary": "All done",
        }
        outcome = _extract_outcome(payload)
        assert outcome.verdict == "approve"
        assert outcome.tests_passing is True
        assert outcome.scope_adherence == 0.95
        assert outcome.pr_url == "https://github.com/pr/1"
        assert outcome.files_changed == ["a.py", "b.py"]
        assert outcome.summary == "All done"

    def test_minimal_payload_defaults(self):
        outcome = _extract_outcome({})
        assert outcome.verdict == "escalate"
        assert outcome.tests_passing is None
        assert outcome.scope_adherence is None
        assert outcome.pr_url is None
        assert outcome.files_changed == []
        assert outcome.summary == ""

    def test_tests_passing_false(self):
        outcome = _extract_outcome({"tests_passing": False, "verdict": "retry"})
        assert outcome.tests_passing is False
        assert outcome.verdict == "retry"

    def test_null_files_changed_coerced_to_empty(self):
        outcome = _extract_outcome({"files_changed": None})
        assert outcome.files_changed == []


# ---------------------------------------------------------------------------
# Unit: ReviewEngine.handle_ravn_outcome — confidence signals
# ---------------------------------------------------------------------------


class TestHandleRavnOutcomeSignals:
    @pytest.mark.asyncio
    async def test_tests_passing_true_emits_ci_pass(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.5)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=True,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.CI_PASS in event_types

    @pytest.mark.asyncio
    async def test_tests_passing_false_emits_ci_fail(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.5)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=False,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.CI_FAIL in event_types

    @pytest.mark.asyncio
    async def test_tests_passing_none_no_ci_event(self):
        raid = _make_raid(status=RaidStatus.REVIEW)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=None,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.CI_PASS not in event_types
        assert ConfidenceEventType.CI_FAIL not in event_types

    @pytest.mark.asyncio
    async def test_low_scope_adherence_emits_scope_breach(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.8)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=None,
            scope_adherence=0.5,  # below threshold of 0.7
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.SCOPE_BREACH in event_types

    @pytest.mark.asyncio
    async def test_high_scope_adherence_no_breach(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.8)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="approve",
            tests_passing=True,
            scope_adherence=0.9,  # above threshold
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.SCOPE_BREACH not in event_types

    @pytest.mark.asyncio
    async def test_scope_adherence_none_no_breach(self):
        raid = _make_raid(status=RaidStatus.REVIEW)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=None,
            scope_adherence=None,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        event_types = [e.event_type for e in tracker.confidence_events.get(_TRACKER_ID, [])]
        assert ConfidenceEventType.SCOPE_BREACH not in event_types


# ---------------------------------------------------------------------------
# Unit: ReviewEngine.handle_ravn_outcome — decision logic
# ---------------------------------------------------------------------------


class TestHandleRavnOutcomeDecisions:
    @pytest.mark.asyncio
    async def test_verdict_approve_high_confidence_auto_approved(self):
        # ci_pass delta=0.30, starting at 0.6 → 0.9 >= 0.8 threshold → auto_approved
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.6)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="approve",
            tests_passing=True,  # ci_pass +0.30 → score=0.9
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "auto_approved"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_verdict_approve_low_confidence_escalated(self):
        # Starting at 0.4, ci_fail -0.30 → 0.1 < 0.8 threshold → escalated even with "approve"
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.4)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="approve",
            tests_passing=False,  # ci_fail -0.30 → score=0.1
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "escalated"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.ESCALATED

    @pytest.mark.asyncio
    async def test_verdict_retry_transitions_to_pending(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.5, retry_count=0)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="retry",
            tests_passing=False,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "retried"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.PENDING
        assert updated_raid.retry_count == 1

    @pytest.mark.asyncio
    async def test_verdict_escalate_direct_escalation(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.9)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="escalate",
            tests_passing=True,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "escalated"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.ESCALATED

    @pytest.mark.asyncio
    async def test_unknown_verdict_escalates(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.5)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="something_unknown",
            tests_passing=None,
            scope_adherence=None,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "escalated"

    @pytest.mark.asyncio
    async def test_running_raid_transitions_to_review_first(self):
        raid = _make_raid(status=RaidStatus.RUNNING, confidence=0.6)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="approve",
            tests_passing=True,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        # After ci_pass (+0.30) starting at 0.6 → 0.9 ≥ 0.8 → auto_approved
        assert decision.action == "auto_approved"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_terminal_raid_skipped(self):
        raid = _make_raid(status=RaidStatus.MERGED, confidence=1.0)
        tracker = StubTracker(raid)
        engine = _make_engine(tracker)

        outcome = RavnOutcome(
            verdict="approve",
            tests_passing=True,
            scope_adherence=1.0,
            pr_url=None,
            files_changed=[],
            summary="",
        )
        decision = await engine.handle_ravn_outcome(
            _TRACKER_ID, _OWNER, outcome, scope_adherence_threshold=0.7
        )

        assert decision.action == "skipped"
        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.MERGED  # unchanged


# ---------------------------------------------------------------------------
# Unit: RavnOutcomeHandler — correlation lookup
# ---------------------------------------------------------------------------


class TestRavnOutcomeHandlerCorrelation:
    def _make_handler(self, tracker: StubTracker) -> tuple[RavnOutcomeHandler, InMemoryEventBus]:
        bus = InMemoryEventBus()
        factory = StubTrackerFactory(tracker)
        engine = ReviewEngine(
            tracker_factory=factory,
            volundr_factory=StubVolundrFactory(),
            git=StubGit(),
            review_config=ReviewConfig(reviewer_session_enabled=False),
            event_bus=bus,
        )
        handler = RavnOutcomeHandler(
            subscriber=InProcessBus(),
            tracker_factory=factory,
            review_engine=engine,
            owner_id=_OWNER,
        )
        return handler, bus

    @pytest.mark.asyncio
    async def test_missing_correlation_id_drops_silently(self, caplog):
        tracker = StubTracker()
        handler, _ = self._make_handler(tracker)

        event = _make_sleipnir_event(correlation_id=None)
        await handler._process_event(event)

        assert "no correlation_id" in caplog.text

    @pytest.mark.asyncio
    async def test_no_matching_raid_drops_silently(self, caplog):
        tracker = StubTracker()  # no raids
        handler, _ = self._make_handler(tracker)

        event = _make_sleipnir_event({"verdict": "approve"}, correlation_id="unknown-session")
        await handler._process_event(event)

        assert "no raid for session_id" in caplog.text

    @pytest.mark.asyncio
    async def test_valid_correlation_processes_raid(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.6)
        tracker = StubTracker(raid)
        handler, _ = self._make_handler(tracker)

        payload = {"verdict": "approve", "tests_passing": True, "scope_adherence": 1.0}
        event = _make_sleipnir_event(payload, correlation_id=_SESSION)
        await handler._process_event(event)

        updated_raid = tracker._raids_by_id[_TRACKER_ID]
        assert updated_raid.status == RaidStatus.MERGED


# ---------------------------------------------------------------------------
# Integration: InProcessBus round-trip
# ---------------------------------------------------------------------------


class TestRavnOutcomeHandlerIntegration:
    @pytest.mark.asyncio
    async def test_publish_ravn_task_completed_transitions_raid(self):
        """Publish event on InProcessBus → raid transitions to MERGED."""
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.6)
        tracker = StubTracker(raid)
        bus = InProcessBus()
        factory = StubTrackerFactory(tracker)
        engine = ReviewEngine(
            tracker_factory=factory,
            volundr_factory=StubVolundrFactory(),
            git=StubGit(),
            review_config=ReviewConfig(reviewer_session_enabled=False),
        )
        handler = RavnOutcomeHandler(
            subscriber=bus,
            tracker_factory=factory,
            review_engine=engine,
            owner_id=_OWNER,
        )

        await handler.start()
        try:
            event = SleipnirEvent(
                event_type="ravn.task.completed",
                source="ravn:coordinator",
                payload={
                    "verdict": "approve",
                    "tests_passing": True,
                    "scope_adherence": 0.95,
                    "summary": "All tests pass",
                },
                summary="task done",
                urgency=0.9,
                domain="code",
                timestamp=NOW,
                correlation_id=_SESSION,
            )
            await bus.publish(event)

            # Give the event loop a chance to process the task
            for _ in range(10):
                await asyncio.sleep(0)

            updated = tracker._raids_by_id[_TRACKER_ID]
            assert updated.status == RaidStatus.MERGED
        finally:
            await handler.stop()

    @pytest.mark.asyncio
    async def test_retry_verdict_transitions_to_pending(self):
        raid = _make_raid(status=RaidStatus.REVIEW, confidence=0.5, retry_count=0)
        tracker = StubTracker(raid)
        bus = InProcessBus()
        factory = StubTrackerFactory(tracker)
        engine = ReviewEngine(
            tracker_factory=factory,
            volundr_factory=StubVolundrFactory(),
            git=StubGit(),
            review_config=ReviewConfig(reviewer_session_enabled=False),
        )
        handler = RavnOutcomeHandler(
            subscriber=bus,
            tracker_factory=factory,
            review_engine=engine,
            owner_id=_OWNER,
        )

        await handler.start()
        try:
            event = SleipnirEvent(
                event_type="ravn.task.completed",
                source="ravn:coordinator",
                payload={"verdict": "retry", "tests_passing": False},
                summary="retry needed",
                urgency=0.8,
                domain="code",
                timestamp=NOW,
                correlation_id=_SESSION,
            )
            await bus.publish(event)

            for _ in range(10):
                await asyncio.sleep(0)

            updated = tracker._raids_by_id[_TRACKER_ID]
            assert updated.status == RaidStatus.PENDING
            assert updated.retry_count == 1
        finally:
            await handler.stop()

    @pytest.mark.asyncio
    async def test_stop_cancels_in_flight_tasks(self):
        """stop() should cancel pending tasks without raising."""
        bus = InProcessBus()
        handler = RavnOutcomeHandler(
            subscriber=bus,
            tracker_factory=StubTrackerFactory(StubTracker()),
            review_engine=ReviewEngine(
                tracker_factory=StubTrackerFactory(StubTracker()),
                volundr_factory=StubVolundrFactory(),
                git=StubGit(),
                review_config=ReviewConfig(reviewer_session_enabled=False),
            ),
            owner_id=_OWNER,
        )
        await handler.start()
        assert handler.is_running
        await handler.stop()
        assert not handler.is_running


# ---------------------------------------------------------------------------
# Integration: coexistence — ActivitySubscriber and RavnOutcomeHandler
# ---------------------------------------------------------------------------


class TestCoexistence:
    @pytest.mark.asyncio
    async def test_explicit_outcome_takes_precedence_over_terminal_state(self):
        """When ActivitySubscriber has already merged the raid, ravn outcome is skipped."""
        raid = _make_raid(status=RaidStatus.MERGED, confidence=1.0)
        tracker = StubTracker(raid)
        factory = StubTrackerFactory(tracker)
        engine = ReviewEngine(
            tracker_factory=factory,
            volundr_factory=StubVolundrFactory(),
            git=StubGit(),
            review_config=ReviewConfig(reviewer_session_enabled=False),
        )
        handler = RavnOutcomeHandler(
            subscriber=InProcessBus(),
            tracker_factory=factory,
            review_engine=engine,
            owner_id=_OWNER,
        )

        event = _make_sleipnir_event(
            {"verdict": "approve", "tests_passing": True}, correlation_id=_SESSION
        )
        await handler._process_event(event)

        # Raid should still be MERGED — handler skips terminal raids
        assert tracker._raids_by_id[_TRACKER_ID].status == RaidStatus.MERGED

    @pytest.mark.asyncio
    async def test_escalated_raid_skipped(self):
        """If ActivitySubscriber already escalated, ravn outcome is skipped."""
        raid = _make_raid(status=RaidStatus.ESCALATED, confidence=0.4)
        tracker = StubTracker(raid)
        factory = StubTrackerFactory(tracker)
        engine = ReviewEngine(
            tracker_factory=factory,
            volundr_factory=StubVolundrFactory(),
            git=StubGit(),
            review_config=ReviewConfig(reviewer_session_enabled=False),
        )
        handler = RavnOutcomeHandler(
            subscriber=InProcessBus(),
            tracker_factory=factory,
            review_engine=engine,
            owner_id=_OWNER,
        )

        event = _make_sleipnir_event(
            {"verdict": "approve", "tests_passing": True}, correlation_id=_SESSION
        )
        await handler._process_event(event)

        assert tracker._raids_by_id[_TRACKER_ID].status == RaidStatus.ESCALATED
