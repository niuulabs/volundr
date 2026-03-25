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
    DispatcherState,
    PRStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.domain.services.activity_subscriber import (
    CompletionEvaluation,
    SessionActivitySubscriber,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.raid_repository import RaidRepository
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

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        for event in self.activity_events:
            yield event


class StubRaidRepo(RaidRepository):
    """In-memory raid repository for activity subscriber tests."""

    def __init__(self) -> None:
        self.raids: dict[UUID, Raid] = {}
        self.saga: Saga | None = None

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
        raise NotImplementedError

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
        raid = self.raids.get(raid_id)
        if raid is None:
            return None
        retry_count = raid.retry_count + 1 if increment_retry else raid.retry_count
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
            confidence=raid.confidence,
            session_id=raid.session_id,
            branch=raid.branch,
            chronicle_summary=chronicle_summary or raid.chronicle_summary,
            pr_url=pr_url or raid.pr_url,
            pr_id=pr_id or raid.pr_id,
            retry_count=retry_count,
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
        )
        self.raids[raid_id] = updated
        return updated

    async def get_confidence_events(self, raid_id: UUID) -> list:
        return []

    async def add_confidence_event(self, event: object) -> None:
        pass

    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        for raid in self.raids.values():
            if raid.tracker_id == tracker_id:
                return raid
        return None

    async def get_owner_for_raid(self, raid_id: UUID) -> str | None:
        if self.saga is None:
            return None
        return self.saga.owner_id or None

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, raid_id: UUID) -> None:
        return None

    async def save_phase(self, phase: object, *, conn: object = None) -> None:
        pass

    async def save_raid(self, raid: object, *, conn: object = None) -> None:
        pass

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        return False

    async def save_session_message(self, message: object) -> None:
        pass

    async def get_session_messages(self, raid_id: UUID) -> list:
        return []

    async def list_phases_for_saga(self, saga_id: UUID) -> list:
        return []

    async def update_phase_status(self, phase_id: UUID, status) -> None:  # noqa: ANN001
        return None


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_raid(
    raid_id: UUID | None = None,
    status: RaidStatus = RaidStatus.RUNNING,
    session_id: str = "session-1",
    branch: str | None = "raid/test",
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=uuid4(),
        tracker_id="tracker-1",
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
    raid_repo: StubRaidRepo | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
    event_bus: InMemoryEventBus | None = None,
    config: WatcherConfig | None = None,
) -> tuple[SessionActivitySubscriber, StubVolundr, StubRaidRepo, InMemoryEventBus]:
    v = volundr or StubVolundr()
    # Register a default running session so debounced evaluation can verify it
    if "session-1" not in v.sessions:
        v.sessions["session-1"] = _make_volundr_session()
    r = raid_repo or StubRaidRepo()
    d = dispatcher_repo or StubDispatcherRepo()
    e = event_bus or InMemoryEventBus()
    c = config or _default_config()
    sub = SessionActivitySubscriber(
        volundr=v, raid_repo=r, dispatcher_repo=d, event_bus=e, config=c
    )
    return sub, v, r, e


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
        sub, volundr, raid_repo, event_bus = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga()

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event)

        # Wait for debounced evaluation (delay=0)
        await asyncio.sleep(0.1)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "raid.state_changed"
        assert bus_event.data["status"] == "REVIEW"

    @pytest.mark.asyncio
    async def test_idle_with_no_turns_does_not_complete(self) -> None:
        """Idle with turn_count <= 1 should not trigger completion."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga()

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 1, "duration_seconds": 5},
            owner_id="user-1",
        )

        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_active_event_cancels_pending_evaluation(self) -> None:
        """An active event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event)
        assert raid.session_id in sub._pending_evaluations

        # Active event cancels it
        active_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="active",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(active_event)
        assert raid.session_id not in sub._pending_evaluations
        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_tool_executing_cancels_pending_evaluation(self) -> None:
        """A tool_executing event should cancel pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event)

        tool_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="tool_executing",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(tool_event)
        assert raid.session_id not in sub._pending_evaluations

    @pytest.mark.asyncio
    async def test_no_raid_for_session_is_ignored(self) -> None:
        """Idle event for a session with no RUNNING raid should be ignored."""
        sub, volundr, raid_repo, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)
        # No crash, no transitions


# ---------------------------------------------------------------------------
# Tests — Completion evaluation
# ---------------------------------------------------------------------------


class TestCompletionEvaluationLogic:
    @pytest.mark.asyncio
    async def test_basic_completion(self) -> None:
        """Session idle with turns > 1 should evaluate as complete."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 60})
        assert result.is_complete is True
        assert result.signals["session_idle"] is True
        assert result.signals["has_turns"] is True
        assert result.confidence >= 0.5

    @pytest.mark.asyncio
    async def test_pr_increases_confidence(self) -> None:
        """PR existence should increase confidence."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        volundr.pr_statuses[raid.session_id or ""] = PRStatus(
            pr_id="PR-1",
            url="https://github.com/pull/1",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 60})
        assert result.is_complete is True
        assert result.signals["pr_exists"] is True
        assert result.signals["ci_passed"] is True
        assert result.confidence >= 0.9

    @pytest.mark.asyncio
    async def test_require_pr_blocks_completion(self) -> None:
        """When require_pr=True and no PR, should not complete."""
        config = _default_config(require_pr=True)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 60})
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_require_ci_blocks_completion(self) -> None:
        """When require_ci=True and CI not passed, should not complete."""
        config = _default_config(require_ci=True)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_statuses[raid.session_id or ""] = PRStatus(
            pr_id="PR-1",
            url="url",
            state="open",
            mergeable=True,
            ci_passed=False,
        )

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 60})
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_extended_idle_increases_confidence(self) -> None:
        """Duration above threshold should increase confidence."""
        config = _default_config(idle_threshold=10.0)
        sub, volundr, _, _ = _make_subscriber(config=config)
        raid = _make_raid()
        volundr.pr_error_sessions.add(raid.session_id or "")

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 120})
        assert result.signals["extended_idle"] is True
        assert result.confidence >= 0.6

    @pytest.mark.asyncio
    async def test_no_branch_skips_pr_check(self) -> None:
        """Raid without a branch should not attempt PR lookup."""
        sub, volundr, _, _ = _make_subscriber()
        raid = _make_raid(branch=None)

        result = await sub._evaluate_completion(raid, {"turn_count": 5, "duration_seconds": 60})
        assert result.is_complete is True
        assert result.signals["pr_exists"] is False


# ---------------------------------------------------------------------------
# Tests — Completion handling
# ---------------------------------------------------------------------------


class TestCompletionHandling:
    @pytest.mark.asyncio
    async def test_pr_info_stored_on_completion(self) -> None:
        """PR URL and ID should be stored when PR is detected."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True, "pr_exists": True},
            confidence=0.9,
            pr_id="PR-42",
            pr_url="https://github.com/org/repo/pull/42",
        )

        await sub._handle_completion(raid, evaluation)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.pr_id == "PR-42"
        assert updated.pr_url == "https://github.com/org/repo/pull/42"

    @pytest.mark.asyncio
    async def test_no_pr_still_transitions(self) -> None:
        """Completion without a PR should still transition to REVIEW."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True},
            confidence=0.5,
        )

        await sub._handle_completion(raid, evaluation)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.pr_id is None

    @pytest.mark.asyncio
    async def test_chronicle_stored_on_completion(self) -> None:
        """Chronicle summary should be stored on completion."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.chronicles[raid.session_id or ""] = "Work completed successfully"

        await sub._handle_completion(raid)

        updated = raid_repo.raids[raid.id]
        assert updated.chronicle_summary == "Work completed successfully"

    @pytest.mark.asyncio
    async def test_chronicle_fetch_failure_does_not_block(self) -> None:
        """Chronicle fetch failure should not prevent transition."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.chronicle_error_sessions.add(raid.session_id or "")

        await sub._handle_completion(raid)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_chronicle_disabled(self) -> None:
        """When chronicle_on_complete is False, no chronicle fetch occurs."""
        config = _default_config(chronicle_on_complete=False)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.chronicles[raid.session_id or ""] = "Should not be fetched"

        await sub._handle_completion(raid)

        updated = raid_repo.raids[raid.id]
        assert updated.chronicle_summary is None

    @pytest.mark.asyncio
    async def test_event_emitted_on_completion(self) -> None:
        """Event bus should receive raid.state_changed on completion."""
        sub, volundr, raid_repo, event_bus = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        q = event_bus.subscribe()
        await sub._handle_completion(raid)

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["raid_id"] == str(raid.id)
        assert event.data["status"] == "REVIEW"


# ---------------------------------------------------------------------------
# Tests — Dispatcher pause filtering
# ---------------------------------------------------------------------------


class TestDispatcherPauseFiltering:
    @pytest.mark.asyncio
    async def test_paused_dispatcher_skips_completion(self) -> None:
        """Raids belonging to paused owners should not complete."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga(owner_id="user-paused")

        sub, volundr, _, _ = _make_subscriber(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-paused",
        )
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_running_dispatcher_allows_completion(self) -> None:
        """Raids belonging to running owners should complete normally."""
        dispatcher_repo = StubDispatcherRepo(running=True)
        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga(owner_id="user-active")

        sub, volundr, _, _ = _make_subscriber(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-active",
        )
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_no_saga_allows_completion(self) -> None:
        """Raids with no parent saga should still complete (graceful fallback)."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        raid_repo = StubRaidRepo()
        # saga is None by default

        sub, volundr, _, _ = _make_subscriber(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.REVIEW


# ---------------------------------------------------------------------------
# Tests — Failure detection
# ---------------------------------------------------------------------------


class TestFailureDetection:
    @pytest.mark.asyncio
    async def test_session_stopped_transitions_raid_to_failed(self) -> None:
        """A session_updated event with status=stopped should transition raid to FAILED."""
        sub, volundr, raid_repo, event_bus = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.FAILED
        assert updated.retry_count == 1

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "raid.state_changed"
        assert bus_event.data["status"] == "FAILED"

    @pytest.mark.asyncio
    async def test_session_failed_transitions_raid_to_failed(self) -> None:
        """A session_updated event with status=failed should transition raid to FAILED."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )

        await sub._on_activity_event(event)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_session_failed_cancels_pending_evaluation(self) -> None:
        """A failure event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, raid_repo, _ = _make_subscriber(config=config)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga()

        # Schedule an idle evaluation
        idle_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event)
        assert raid.session_id in sub._pending_evaluations

        # Session crashes
        fail_event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )
        await sub._on_activity_event(fail_event)

        assert raid.session_id not in sub._pending_evaluations
        assert raid_repo.raids[raid.id].status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_session_not_found_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns None during debounced evaluation, raid should fail."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga()

        # Remove the session so get_session returns None
        volundr.sessions.pop(raid.session_id or "", None)

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.FAILED
        assert raid_repo.raids[raid.id].retry_count == 1

    @pytest.mark.asyncio
    async def test_session_stopped_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns a stopped session during evaluation, raid should fail."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga()

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
        await sub._on_activity_event(event)
        await asyncio.sleep(0.1)

        assert raid_repo.raids[raid.id].status == RaidStatus.FAILED

    @pytest.mark.asyncio
    async def test_failure_no_raid_is_ignored(self) -> None:
        """A failure event for a session with no RUNNING raid should be ignored."""
        sub, volundr, raid_repo, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )
        await sub._on_activity_event(event)
        # No crash, no transitions

    @pytest.mark.asyncio
    async def test_chronicle_fetched_on_failure(self) -> None:
        """Chronicle summary should be fetched when a raid fails."""
        sub, volundr, raid_repo, _ = _make_subscriber()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.chronicles[raid.session_id or ""] = "Session crashed"

        event = ActivityEvent(
            session_id=raid.session_id or "",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )
        await sub._on_activity_event(event)

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.FAILED
        assert updated.chronicle_summary == "Session crashed"


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

    def test_custom(self) -> None:
        cfg = WatcherConfig(
            idle_threshold=60.0,
            completion_check_delay=10.0,
            require_pr=True,
            require_ci=True,
            confidence_base=0.6,
            confidence_pr_bonus=0.15,
            confidence_ci_bonus=0.15,
            confidence_idle_bonus=0.05,
            reconnect_delay=3.0,
        )
        assert cfg.idle_threshold == 60.0
        assert cfg.completion_check_delay == 10.0
        assert cfg.require_pr is True
        assert cfg.require_ci is True
        assert cfg.confidence_base == 0.6
        assert cfg.confidence_pr_bonus == 0.15
        assert cfg.confidence_ci_bonus == 0.15
        assert cfg.confidence_idle_bonus == 0.05
        assert cfg.reconnect_delay == 3.0
