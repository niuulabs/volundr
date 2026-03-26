"""Tests for the event-driven session activity subscriber."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import WatcherConfig
from tyr.domain.models import (
    ConfidenceEvent,
    DispatcherState,
    Phase,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
    SessionMessage,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.domain.services.activity_subscriber import (
    CompletionEvaluation,
    SessionActivitySubscriber,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import ActivityEvent, SpawnRequest, VolundrPort, VolundrSession

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC)


class StubVolundr(VolundrPort):
    """In-memory Volundr stub for activity subscriber tests."""

    def __init__(self) -> None:
        self.sessions: dict[str, VolundrSession] = {}
        self.pr_statuses: dict[str, PRStatus] = {}
        self.chronicles: dict[str, str] = {}
        self.pr_error_sessions: set[str] = set()
        self.chronicle_error_sessions: set[str] = set()
        self.activity_events: list[ActivityEvent] = []

    async def spawn_session(
        self, request: SpawnRequest, *, auth_token: str | None = None
    ) -> VolundrSession:
        raise NotImplementedError

    async def get_session(
        self, session_id: str, *, auth_token: str | None = None
    ) -> VolundrSession | None:
        return self.sessions.get(session_id)

    async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
        return list(self.sessions.values())

    async def get_pr_status(self, session_id: str) -> PRStatus:
        if session_id in self.pr_error_sessions:
            raise RuntimeError("PR not found")
        pr = self.pr_statuses.get(session_id)
        if pr is None:
            raise RuntimeError("No PR")
        return pr

    async def get_chronicle_summary(self, session_id: str) -> str:
        if session_id in self.chronicle_error_sessions:
            raise RuntimeError("Chronicle fetch failed")
        return self.chronicles.get(session_id, "")

    async def send_message(
        self, session_id: str, message: str, *, auth_token: str | None = None
    ) -> None:
        pass

    async def stop_session(self, session_id: str, *, auth_token: str | None = None) -> None:
        pass

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        for event in self.activity_events:
            yield event


class StubTracker(TrackerPort):
    """In-memory tracker stub for activity subscriber tests."""

    def __init__(self) -> None:
        # Indexed by session_id for lookup
        self.raids_by_session: dict[str, Raid] = {}
        # Indexed by tracker_id for progress updates
        self.progress: dict[str, dict] = {}

    def add_raid(self, raid: Raid) -> None:
        if raid.session_id:
            self.raids_by_session[raid.session_id] = raid
        self.progress[raid.tracker_id] = {
            "status": raid.status,
            "pr_url": raid.pr_url,
            "pr_id": raid.pr_id,
            "reason": None,
        }

    # -- TrackerPort abstract methods --

    async def create_saga(self, saga: Saga) -> str:
        return ""

    async def create_phase(self, phase: Phase) -> str:
        return ""

    async def create_raid(self, raid: Raid) -> str:
        return ""

    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None:
        pass

    async def close_raid(self, raid_id: str) -> None:
        pass

    async def get_saga(self, saga_id: str) -> Saga:
        raise NotImplementedError

    async def get_phase(self, tracker_id: str) -> Phase:
        raise NotImplementedError

    async def get_raid(self, tracker_id: str) -> Raid:
        raise NotImplementedError

    async def list_pending_raids(self, phase_id: str) -> list[Raid]:
        return []

    async def list_projects(self) -> list[TrackerProject]:
        return []

    async def get_project(self, project_id: str) -> TrackerProject:
        raise NotImplementedError

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        return []

    async def list_issues(
        self,
        project_id: str,
        milestone_id: str | None = None,
    ) -> list[TrackerIssue]:
        return []

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
    ) -> Raid:
        entry = self.progress.setdefault(tracker_id, {})
        if status is not None:
            entry["status"] = status
        if pr_url is not None:
            entry["pr_url"] = pr_url
        if pr_id is not None:
            entry["pr_id"] = pr_id
        if reason is not None:
            entry["reason"] = reason
        if chronicle_summary is not None:
            entry["chronicle_summary"] = chronicle_summary

        # Find the raid by tracker_id and return an updated copy
        for raid in self.raids_by_session.values():
            if raid.tracker_id == tracker_id:
                updated = Raid(
                    id=raid.id,
                    phase_id=raid.phase_id,
                    tracker_id=raid.tracker_id,
                    name=raid.name,
                    description=raid.description,
                    acceptance_criteria=raid.acceptance_criteria,
                    declared_files=raid.declared_files,
                    estimate_hours=raid.estimate_hours,
                    status=entry.get("status", raid.status),
                    confidence=raid.confidence,
                    session_id=raid.session_id,
                    branch=raid.branch,
                    chronicle_summary=raid.chronicle_summary,
                    pr_url=entry.get("pr_url", raid.pr_url),
                    pr_id=entry.get("pr_id", raid.pr_id),
                    retry_count=raid.retry_count,
                    created_at=raid.created_at,
                    updated_at=datetime.now(UTC),
                )
                if raid.session_id:
                    self.raids_by_session[raid.session_id] = updated
                return updated
        raise KeyError(f"No raid with tracker_id={tracker_id!r}")

    async def get_raid_by_session(self, session_id: str) -> Raid | None:
        return self.raids_by_session.get(session_id)

    async def list_raids_by_status(self, status: RaidStatus) -> list[Raid]:
        return [r for r in self.raids_by_session.values() if r.status == status]

    async def get_raid_by_id(self, raid_id: UUID) -> Raid | None:
        for raid in self.raids_by_session.values():
            if raid.id == raid_id:
                return raid
        return None

    async def add_confidence_event(self, tracker_id: str, event: ConfidenceEvent) -> None:
        pass

    async def get_confidence_events(self, tracker_id: str) -> list[ConfidenceEvent]:
        return []

    async def all_raids_merged(self, phase_tracker_id: str) -> bool:
        return False

    async def list_phases_for_saga(self, saga_tracker_id: str) -> list[Phase]:
        return []

    async def update_phase_status(self, phase_tracker_id: str, status: PhaseStatus) -> Phase | None:
        return None

    async def get_saga_for_raid(self, tracker_id: str) -> Saga | None:
        return None

    async def get_phase_for_raid(self, tracker_id: str) -> Phase | None:
        return None

    async def get_owner_for_raid(self, tracker_id: str) -> str | None:
        return None

    async def save_session_message(self, message: SessionMessage) -> None:
        pass

    async def get_session_messages(self, tracker_id: str) -> list[SessionMessage]:
        return []


class StubTrackerFactory:
    """Stub factory that always returns the same tracker for any owner."""

    def __init__(self, tracker: StubTracker) -> None:
        self._tracker = tracker

    async def for_owner(self, owner_id: str) -> list[StubTracker]:
        return [self._tracker]


class StubDispatcherRepo(DispatcherRepository):
    """In-memory dispatcher repo for activity subscriber tests."""

    def __init__(self, running: bool = True) -> None:
        self._running = running

    async def get_or_create(self, owner_id: str) -> DispatcherState:
        return DispatcherState(
            id=uuid4(),
            owner_id=owner_id,
            running=self._running,
            threshold=0.5,
            max_concurrent_raids=3,
            updated_at=NOW,
        )

    async def update(self, owner_id: str, **fields: object) -> DispatcherState:
        return await self.get_or_create(owner_id)

    async def list_active_owner_ids(self) -> list[str]:
        return []


class StubVolundrFactory:
    """Stub factory that always returns the same adapter for any owner."""

    def __init__(self, adapter: StubVolundr) -> None:
        self._adapter = adapter

    async def for_owner(self, owner_id: str) -> StubVolundr:
        return self._adapter


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    raid_id: UUID | None = None,
    status: RaidStatus = RaidStatus.RUNNING,
    session_id: str = "session-1",
    branch: str | None = "raid/test",
    tracker_id: str = "tracker-1",
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=uuid4(),
        tracker_id=tracker_id,
        name="Test raid",
        description="Implement feature",
        acceptance_criteria=["tests pass"],
        declared_files=["src/main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=0.5,
        session_id=session_id,
        branch=branch,
        chronicle_summary=None,
        pr_url=None,
        pr_id=None,
        retry_count=0,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_saga(owner_id: str = "user-1") -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id="proj-1",
        tracker_type="mock",
        slug="alpha",
        name="Test Saga",
        repos=["org/repo"],
        feature_branch="feat/test",
        status=SagaStatus.ACTIVE,
        confidence=0.5,
        created_at=NOW,
        owner_id=owner_id,
    )


def _make_volundr_session(session_id: str = "session-1", status: str = "running") -> VolundrSession:
    return VolundrSession(
        id=session_id,
        name="Test Session",
        status=status,
        tracker_issue_id=None,
    )


def _default_config(**overrides: object) -> WatcherConfig:
    defaults: dict = {
        "enabled": True,
        "poll_interval": 1.0,
        "batch_size": 10,
        "chronicle_on_complete": True,
        "idle_threshold": 30.0,
        "completion_check_delay": 0.0,  # No delay for tests
        "require_pr": False,
        "require_ci": False,
        "confidence_base": 0.5,
        "confidence_pr_bonus": 0.2,
        "confidence_ci_bonus": 0.2,
        "confidence_idle_bonus": 0.1,
        "reconnect_delay": 0.1,
    }
    defaults.update(overrides)
    return WatcherConfig(**defaults)


def _make_volundr_session(session_id: str = "session-1", status: str = "running") -> VolundrSession:
    return VolundrSession(
        id=session_id,
        name="Test Session",
        status=status,
        tracker_issue_id=None,
    )


def _make_subscriber(
    volundr: StubVolundr | None = None,
    tracker: StubTracker | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
    event_bus: InMemoryEventBus | None = None,
    config: WatcherConfig | None = None,
) -> tuple[SessionActivitySubscriber, StubVolundr, StubTracker, InMemoryEventBus]:
    v = volundr or StubVolundr()
    if "session-1" not in v.sessions:
        v.sessions["session-1"] = _make_volundr_session()
    t = tracker or StubTracker()
    d = dispatcher_repo or StubDispatcherRepo()
    e = event_bus or InMemoryEventBus()
    c = config or _default_config()
    volundr_factory = StubVolundrFactory(v)
    tracker_factory = StubTrackerFactory(t)
    sub = SessionActivitySubscriber(
        volundr_factory=volundr_factory,
        tracker_factory=tracker_factory,
        dispatcher_repo=d,
        event_bus=e,
        config=c,
    )
    return sub, v, t, e


# ---------------------------------------------------------------------------
# Tests — CompletionEvaluation
# ---------------------------------------------------------------------------


class TestCompletionEvaluation:
    def test_defaults(self) -> None:
        ce = CompletionEvaluation(is_complete=False, signals={}, confidence=0.0)
        assert ce.is_complete is False
        assert ce.confidence == 0.0

    def test_complete_with_signals(self) -> None:
        ce = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True},
            confidence=0.7,
        )
        assert ce.is_complete is True
        assert ce.confidence == 0.7


# ---------------------------------------------------------------------------
# Tests — Lifecycle
# ---------------------------------------------------------------------------


class TestSubscriberLifecycle:
    def test_not_running_initially(self) -> None:
        sub, _, _, _ = _make_subscriber()
        assert sub.running is False

    @pytest.mark.asyncio
    async def test_disabled_by_config(self) -> None:
        config = _default_config(enabled=False)
        sub, _, _, _ = _make_subscriber(config=config)
        await sub.start()
        assert sub.running is False

    @pytest.mark.asyncio
    async def test_start_stop(self) -> None:
        sub, _, _, _ = _make_subscriber()
        await sub.start()
        assert sub.running is True
        await sub.stop()
        assert sub.running is False

    @pytest.mark.asyncio
    async def test_stop_when_not_started(self) -> None:
        sub, _, _, _ = _make_subscriber()
        await sub.stop()  # Should not raise


# ---------------------------------------------------------------------------
# Tests — Activity event handling
# ---------------------------------------------------------------------------


class TestActivityEventHandling:
    @pytest.mark.asyncio
    async def test_idle_event_triggers_completion_for_running_raid(self) -> None:
        """An idle event with sufficient turns should transition the raid to REVIEW."""
        sub, volundr, tracker, event_bus = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr, owner_id="user-1")

        # Wait for debounced evaluation (delay=0)
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.REVIEW

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "raid.state_changed"
        assert bus_event.data["status"] == "REVIEW"

    @pytest.mark.asyncio
    async def test_idle_with_no_turns_does_not_complete(self) -> None:
        """Idle with turn_count <= 1 should not trigger completion."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 1, "duration_seconds": 5},
            owner_id="user-1",
        )

        await sub._on_activity_event(event, volundr, owner_id="user-1")
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_active_event_cancels_pending_evaluation(self) -> None:
        """An active event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, tracker, _ = _make_subscriber(config=config)
        raid = _make_raid()
        tracker.add_raid(raid)

        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr, owner_id="user-1")
        assert raid.session_id in sub._pending_evaluations

        # Active event cancels it
        active_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="active",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(active_event, volundr, owner_id="user-1")
        assert raid.session_id not in sub._pending_evaluations
        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_tool_executing_cancels_pending_evaluation(self) -> None:
        """A tool_executing event should cancel pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, tracker, _ = _make_subscriber(config=config)
        raid = _make_raid()
        tracker.add_raid(raid)

        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr, owner_id="user-1")

        tool_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="tool_executing",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(tool_event, volundr, owner_id="user-1")
        assert raid.session_id not in sub._pending_evaluations

    @pytest.mark.asyncio
    async def test_no_raid_for_session_is_ignored(self) -> None:
        """Idle event for a session with no RUNNING raid should be ignored."""
        sub, volundr, tracker, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-1")
        await asyncio.sleep(0.1)
        # No crash, no transitions


# ---------------------------------------------------------------------------
# Tests — Completion evaluation
# ---------------------------------------------------------------------------


class TestCompletionEvaluationLogic:
    @pytest.mark.asyncio
    async def test_basic_completion(self) -> None:
        """Session idle with turns > 1 should evaluate as complete."""
        sub, volundr, _, _ = _make_subscriber()
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 60}
        )  # noqa: E501
        assert result.is_complete is True
        assert result.signals["session_idle"] is True
        assert result.signals["has_turns"] is True
        assert result.confidence >= 0.5

    @pytest.mark.asyncio
    async def test_pr_increases_confidence(self) -> None:
        """PR existence should increase confidence."""
        sub, volundr, _, _ = _make_subscriber()
        raid = _make_raid()
        volundr.pr_statuses[raid.session_id or ""] = PRStatus(
            pr_id="PR-1",
            url="https://github.com/pull/1",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 60}
        )  # noqa: E501
        assert result.is_complete is True
        assert result.signals["pr_exists"] is True
        assert result.signals["ci_passed"] is True
        assert result.confidence >= 0.9

    @pytest.mark.asyncio
    async def test_require_pr_blocks_completion(self) -> None:
        """When require_pr=True and no PR, should not complete."""
        config = _default_config(require_pr=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 60}
        )  # noqa: E501
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_require_ci_blocks_completion(self) -> None:
        """When require_ci=True and CI not passed, should not complete."""
        config = _default_config(require_ci=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_statuses[raid.session_id or ""] = PRStatus(
            pr_id="PR-1",
            url="url",
            state="open",
            mergeable=True,
            ci_passed=False,
        )

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 60}
        )  # noqa: E501
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_extended_idle_increases_confidence(self) -> None:
        """Duration above threshold should increase confidence."""
        config = _default_config(idle_threshold=10.0)
        sub, volundr, _, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 120}
        )  # noqa: E501
        assert result.signals["extended_idle"] is True
        assert result.confidence >= 0.6

    @pytest.mark.asyncio
    async def test_no_branch_skips_pr_check(self) -> None:
        """Raid without a branch should not attempt PR lookup."""
        sub, volundr, _, _ = _make_subscriber()
        raid = _make_raid(branch=None)

        result = await sub._evaluate_completion(
            raid, volundr, {"turn_count": 5, "duration_seconds": 60}
        )  # noqa: E501
        assert result.is_complete is True
        assert result.signals["pr_exists"] is False


# ---------------------------------------------------------------------------
# Tests — Completion handling
# ---------------------------------------------------------------------------


class TestCompletionHandling:
    @pytest.mark.asyncio
    async def test_pr_info_stored_on_completion(self) -> None:
        """PR URL and ID should be stored when PR is detected."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True, "pr_exists": True},
            confidence=0.9,
            pr_id="PR-42",
            pr_url="https://github.com/org/repo/pull/42",
        )

        await sub._handle_completion(raid, tracker, volundr, "user-1", evaluation)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.REVIEW
        assert tracker.progress[raid.tracker_id]["pr_id"] == "PR-42"
        assert tracker.progress[raid.tracker_id]["pr_url"] == "https://github.com/org/repo/pull/42"

    @pytest.mark.asyncio
    async def test_no_pr_still_transitions(self) -> None:
        """Completion without a PR should still transition to REVIEW."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True},
            confidence=0.5,
        )

        await sub._handle_completion(raid, tracker, volundr, "user-1", evaluation)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.REVIEW
        assert tracker.progress[raid.tracker_id].get("pr_id") is None

    @pytest.mark.asyncio
    async def test_event_emitted_on_completion(self) -> None:
        """Event bus should receive raid.state_changed on completion."""
        sub, volundr, tracker, event_bus = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        q = event_bus.subscribe()
        await sub._handle_completion(raid, tracker, volundr, "user-1")

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["status"] == "REVIEW"


# ---------------------------------------------------------------------------
# Tests — Dispatcher pause filtering
# ---------------------------------------------------------------------------


class TestDispatcherPauseFiltering:
    @pytest.mark.asyncio
    async def test_paused_dispatcher_skips_completion(self) -> None:
        """Raids belonging to paused owners should not complete."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        tracker = StubTracker()

        sub, volundr, _, _ = _make_subscriber(tracker=tracker, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-paused",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-paused")
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_running_dispatcher_allows_completion(self) -> None:
        """Raids belonging to running owners should complete normally."""
        dispatcher_repo = StubDispatcherRepo(running=True)
        tracker = StubTracker()

        sub, volundr, _, _ = _make_subscriber(tracker=tracker, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-active",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-active")
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.REVIEW


# ---------------------------------------------------------------------------
# Tests — Failure detection
# ---------------------------------------------------------------------------


class TestFailureDetection:
    @pytest.mark.asyncio
    async def test_session_stopped_transitions_raid_to_failed(self) -> None:
        """A session_updated event with status=stopped should transition raid to FAILED."""
        sub, volundr, tracker, event_bus = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr, owner_id="user-1")

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.FAILED

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "raid.state_changed"
        assert bus_event.data["status"] == "FAILED"

    @pytest.mark.asyncio
    async def test_session_failed_transitions_raid_to_failed(self) -> None:
        """A session_updated event with status=failed should transition raid to FAILED."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )

        await sub._on_activity_event(event, volundr, owner_id="user-1")

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_session_failed_cancels_pending_evaluation(self) -> None:
        """A failure event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, tracker, _ = _make_subscriber(config=config)
        raid = _make_raid()
        tracker.add_raid(raid)

        # Schedule an idle evaluation
        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr, owner_id="user-1")
        assert raid.session_id in sub._pending_evaluations

        # Session crashes
        fail_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )
        await sub._on_activity_event(fail_event, volundr, owner_id="user-1")

        assert raid.session_id not in sub._pending_evaluations
        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_session_not_found_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns None during debounced evaluation, raid should fail."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        # Remove the session so get_session returns None
        volundr.sessions.pop(raid.session_id or "", None)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-1")
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_session_stopped_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns a stopped session during evaluation, raid should fail."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)

        # Session is stopped
        volundr.sessions[raid.session_id or ""] = _make_volundr_session(
            session_id=raid.session_id or "", status="stopped"
        )

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-1")
        await asyncio.sleep(0.1)

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_failure_no_raid_is_ignored(self) -> None:
        """A failure event for a session with no RUNNING raid should be ignored."""
        sub, volundr, tracker, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )
        await sub._on_activity_event(event, volundr, owner_id="user-1")
        # No crash, no transitions


# ---------------------------------------------------------------------------
# Tests — WatcherConfig new fields
# ---------------------------------------------------------------------------


class TestWatcherConfigNewFields:
    def test_defaults(self) -> None:
        cfg = WatcherConfig()
        assert cfg.idle_threshold == 30.0
        assert cfg.completion_check_delay == 5.0
        assert cfg.require_pr is False
        assert cfg.require_ci is False
        assert cfg.confidence_base == 0.5
        assert cfg.confidence_pr_bonus == 0.2
        assert cfg.confidence_ci_bonus == 0.2
        assert cfg.confidence_idle_bonus == 0.1
        assert cfg.reconnect_delay == 5.0


# ---------------------------------------------------------------------------
# Tests — Chronicle capture
# ---------------------------------------------------------------------------


class TestChronicleCapture:
    @pytest.mark.asyncio
    async def test_chronicle_fetched_on_completion(self) -> None:
        """Chronicle summary should be stored when chronicle_on_complete is True."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)
        volundr.chronicles[raid.session_id or ""] = "Session did X, Y, Z."

        await sub._handle_completion(raid, tracker, volundr, "user-1")

        stored = tracker.progress[raid.tracker_id].get("chronicle_summary")
        assert stored == "Session did X, Y, Z."

    @pytest.mark.asyncio
    async def test_chronicle_error_is_logged_not_raised(self) -> None:
        """A failure fetching the chronicle should not prevent raid transition."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)
        volundr.chronicle_error_sessions.add(raid.session_id or "")

        # Should not raise even though get_chronicle_summary throws
        await sub._handle_completion(raid, tracker, volundr, "user-1")

        assert tracker.progress[raid.tracker_id]["status"] == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_chronicle_skipped_when_disabled(self) -> None:
        """Chronicle should not be fetched when chronicle_on_complete is False."""
        config = _default_config().model_copy(update={"chronicle_on_complete": False})
        sub, volundr, tracker, _ = _make_subscriber(config=config)
        raid = _make_raid()
        tracker.add_raid(raid)
        volundr.chronicles[raid.session_id or ""] = "should not appear"

        await sub._handle_completion(raid, tracker, volundr, "user-1")

        stored = tracker.progress[raid.tracker_id].get("chronicle_summary")
        assert stored is None


# ---------------------------------------------------------------------------
# Tests — Owner subscription loop (no adapter warning)
# ---------------------------------------------------------------------------


class TestOwnerSubscriptionLoop:
    @pytest.mark.asyncio
    async def test_no_volundr_adapter_logs_warning_and_retries(self) -> None:
        """When the Volundr factory returns None, a warning is logged and the loop retries."""

        class NoneVolundrFactory:
            async def for_owner(self, owner_id: str) -> None:
                return None

        event_bus = InMemoryEventBus()
        tracker_factory = StubTrackerFactory(StubTracker())
        config = _default_config().model_copy(update={"reconnect_delay": 0.01})
        sub = SessionActivitySubscriber(
            volundr_factory=NoneVolundrFactory(),
            tracker_factory=tracker_factory,
            dispatcher_repo=StubDispatcherRepo(),
            event_bus=event_bus,
            config=config,
        )

        # Run the loop briefly — it should log a warning and not crash
        sub._running = True
        task = asyncio.create_task(sub._owner_subscription_loop("owner-x"))
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        # No assertion needed — absence of exception confirms the warning path runs

    @pytest.mark.asyncio
    async def test_sse_events_dispatched_with_owner_id(self) -> None:
        """SSE events must be forwarded to _on_activity_event with owner_id."""
        sub, volundr, tracker, _ = _make_subscriber()
        raid = _make_raid()
        tracker.add_raid(raid)
        volundr.sessions[raid.session_id or ""] = _make_volundr_session(
            session_id=raid.session_id or ""
        )

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="running",
            metadata={},
            owner_id="user-1",
        )
        volundr.activity_events = [event]

        sub._running = True
        task = asyncio.create_task(sub._owner_subscription_loop("user-1"))
        await asyncio.sleep(0.05)
        sub._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        # The running state event should have cancelled any pending eval (no crash)
