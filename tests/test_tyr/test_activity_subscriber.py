"""Tests for the event-driven session activity subscriber."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import WatcherConfig
from tyr.domain.models import (
    DispatcherState,
    PRStatus,
)
from tyr.domain.services.activity_subscriber import (
    CompletionEvaluation,
    SessionActivitySubscriber,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
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

    async def stop_session(self, session_id, *, auth_token=None):
        pass

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        for event in self.activity_events:
            yield event


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


class StubVolundrFactory:
    """Stub factory that always returns the same adapter for any owner."""

    def __init__(self, adapter: StubVolundr) -> None:
        self._adapter = adapter

    async def for_owner(self, owner_id: str) -> StubVolundr:
        return self._adapter


class StubPool:
    """Mock asyncpg.Pool for dispatched_sessions queries."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.executed: list = []

    def add_session(
        self,
        session_id: str,
        owner_id: str = "user-1",
        saga_id: str = "saga-1",
        tracker_issue_id: str = "issue-1",
    ) -> None:
        from uuid import UUID

        self.sessions[session_id] = {
            "id": UUID("00000000-0000-0000-0000-000000000001"),
            "session_id": session_id,
            "owner_id": owner_id,
            "saga_id": UUID("00000000-0000-0000-0000-000000000002"),
            "tracker_issue_id": tracker_issue_id,
            "status": "running",
        }

    async def fetch(self, query: str, *args) -> list:
        if "DISTINCT owner_id" in query:
            owners = {s["owner_id"] for s in self.sessions.values() if s["status"] == "running"}
            return [{"owner_id": o} for o in owners]
        return []

    async def fetchrow(self, query: str, *args) -> dict | None:
        if "dispatched_sessions" in query and args:
            session_id = args[0]
            s = self.sessions.get(session_id)
            if s and s["status"] == "running":
                return s
        return None

    async def execute(self, query: str, *args) -> None:
        self.executed.append((query, args))
        if "UPDATE dispatched_sessions SET status" in query and len(args) >= 1:
            session_id = args[0]
            # Simple: first arg is status value from the SET clause
            for s in self.sessions.values():
                if s["session_id"] == session_id:
                    # Parse status from the query
                    if "'complete'" in query:
                        s["status"] = "complete"
                    elif "'failed'" in query:
                        s["status"] = "failed"
                    break


def _make_subscriber(
    volundr: StubVolundr | None = None,
    pool: StubPool | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
    event_bus: InMemoryEventBus | None = None,
    config: WatcherConfig | None = None,
) -> tuple[SessionActivitySubscriber, StubVolundr, StubPool, InMemoryEventBus]:
    v = volundr or StubVolundr()
    if "session-1" not in v.sessions:
        v.sessions["session-1"] = _make_volundr_session()
    p = pool or StubPool()
    if not p.sessions:
        p.add_session("session-1")
    d = dispatcher_repo or StubDispatcherRepo()
    e = event_bus or InMemoryEventBus()
    c = config or _default_config()
    factory = StubVolundrFactory(v)
    sub = SessionActivitySubscriber(
        volundr_factory=factory, pool=p, dispatcher_repo=d, event_bus=e, config=c
    )
    return sub, v, p, e


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
    async def test_idle_event_triggers_completion_for_running_session(self) -> None:
        """An idle event with sufficient turns should transition the session to complete."""
        sub, volundr, pool, event_bus = _make_subscriber()
        pool.add_session("session-1")

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr)

        # Wait for debounced evaluation (delay=0)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "complete"

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["status"] == "complete"

    @pytest.mark.asyncio
    async def test_idle_with_no_turns_does_not_complete(self) -> None:
        """Idle with turn_count <= 1 should not trigger completion."""
        sub, volundr, pool, _ = _make_subscriber()
        pool.add_session("session-1")

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 1, "duration_seconds": 5},
            owner_id="user-1",
        )

        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_active_event_cancels_pending_evaluation(self) -> None:
        """An active event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)
        pool.add_session("session-1")

        idle_event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr)
        assert "session-1" in sub._pending_evaluations

        # Active event cancels it
        active_event = ActivityEvent(
            session_id="session-1",
            state="active",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(active_event, volundr)
        assert "session-1" not in sub._pending_evaluations
        assert pool.sessions["session-1"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_tool_executing_cancels_pending_evaluation(self) -> None:
        """A tool_executing event should cancel pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)
        pool.add_session("session-1")

        idle_event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr)

        tool_event = ActivityEvent(
            session_id="session-1",
            state="tool_executing",
            metadata={},
            owner_id="user-1",
        )
        await sub._on_activity_event(tool_event, volundr)
        assert "session-1" not in sub._pending_evaluations

    @pytest.mark.asyncio
    async def test_no_session_record_is_ignored(self) -> None:
        """Idle event for a session with no dispatched record should be ignored."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)
        # No crash, no transitions


# ---------------------------------------------------------------------------
# Tests — Completion evaluation
# ---------------------------------------------------------------------------


class TestCompletionEvaluationLogic:
    def _record(
        self,
        session_id: str = "session-1",
        owner_id: str = "user-1",
        tracker_issue_id: str = "issue-1",
    ) -> dict:
        return {
            "session_id": session_id,
            "owner_id": owner_id,
            "tracker_issue_id": tracker_issue_id,
        }

    @pytest.mark.asyncio
    async def test_basic_completion(self) -> None:
        """Session idle with turns > 1 should evaluate as complete."""
        sub, volundr, _, _ = _make_subscriber()
        record = self._record()
        volundr.pr_error_sessions.add(record["session_id"])

        activity = {"turn_count": 5, "duration_seconds": 60}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.is_complete is True
        assert result.signals["session_idle"] is True
        assert result.signals["has_turns"] is True
        assert result.confidence >= 0.5

    @pytest.mark.asyncio
    async def test_pr_increases_confidence(self) -> None:
        """PR existence should increase confidence."""
        sub, volundr, _, _ = _make_subscriber()
        record = self._record()
        volundr.pr_statuses[record["session_id"]] = PRStatus(
            pr_id="PR-1",
            url="https://github.com/pull/1",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        activity = {"turn_count": 5, "duration_seconds": 60}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.is_complete is True
        assert result.signals["pr_exists"] is True
        assert result.signals["ci_passed"] is True
        assert result.confidence >= 0.9

    @pytest.mark.asyncio
    async def test_require_pr_blocks_completion(self) -> None:
        """When require_pr=True and no PR, should not complete."""
        config = _default_config(require_pr=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = self._record()
        volundr.pr_error_sessions.add(record["session_id"])

        activity = {"turn_count": 5, "duration_seconds": 60}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_require_ci_blocks_completion(self) -> None:
        """When require_ci=True and CI not passed, should not complete."""
        config = _default_config(require_ci=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = self._record()
        volundr.pr_statuses[record["session_id"]] = PRStatus(
            pr_id="PR-1",
            url="url",
            state="open",
            mergeable=True,
            ci_passed=False,
        )

        activity = {"turn_count": 5, "duration_seconds": 60}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_extended_idle_increases_confidence(self) -> None:
        """Duration above threshold should increase confidence."""
        config = _default_config(idle_threshold=10.0)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = self._record()
        volundr.pr_error_sessions.add(record["session_id"])

        activity = {"turn_count": 5, "duration_seconds": 120}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.signals["extended_idle"] is True
        assert result.confidence >= 0.6

    @pytest.mark.asyncio
    async def test_no_pr_error_skips_pr_check(self) -> None:
        """Session with no PR should report pr_exists=False."""
        sub, volundr, _, _ = _make_subscriber()
        record = self._record()
        volundr.pr_error_sessions.add(record["session_id"])

        activity = {"turn_count": 5, "duration_seconds": 60}
        result = await sub._evaluate_completion(record, volundr, activity)
        assert result.is_complete is True
        assert result.signals["pr_exists"] is False


# ---------------------------------------------------------------------------
# Tests — Completion handling
# ---------------------------------------------------------------------------


class TestCompletionHandling:
    @pytest.mark.asyncio
    async def test_pr_info_emitted_on_completion(self) -> None:
        """PR URL and ID should be emitted in the event when PR is detected."""
        sub, volundr, pool, event_bus = _make_subscriber()
        record = {
            "session_id": "session-1",
            "owner_id": "user-1",
            "saga_id": "saga-1",
            "tracker_issue_id": "issue-1",
        }
        pool.add_session("session-1")

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True, "pr_exists": True},
            confidence=0.9,
            pr_id="PR-42",
            pr_url="https://github.com/org/repo/pull/42",
        )

        q = event_bus.subscribe()
        await sub._handle_completion(record, evaluation)

        assert pool.sessions["session-1"]["status"] == "complete"
        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.data["pr_id"] == "PR-42"
        assert bus_event.data["pr_url"] == "https://github.com/org/repo/pull/42"

    @pytest.mark.asyncio
    async def test_no_pr_still_transitions(self) -> None:
        """Completion without a PR should still transition to complete."""
        sub, volundr, pool, _ = _make_subscriber()
        record = {
            "session_id": "session-1",
            "owner_id": "user-1",
            "saga_id": "saga-1",
            "tracker_issue_id": "issue-1",
        }
        pool.add_session("session-1")

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True},
            confidence=0.5,
        )

        await sub._handle_completion(record, evaluation)

        assert pool.sessions["session-1"]["status"] == "complete"

    @pytest.mark.asyncio
    async def test_event_emitted_on_completion(self) -> None:
        """Event bus should receive session.state_changed on completion."""
        sub, volundr, pool, event_bus = _make_subscriber()
        record = {
            "session_id": "session-1",
            "owner_id": "user-1",
            "saga_id": "saga-1",
            "tracker_issue_id": "issue-1",
        }
        pool.add_session("session-1")

        q = event_bus.subscribe()
        await sub._handle_completion(record)

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "session.state_changed"
        assert event.data["session_id"] == "session-1"
        assert event.data["status"] == "complete"


# ---------------------------------------------------------------------------
# Tests — Dispatcher pause filtering
# ---------------------------------------------------------------------------


class TestDispatcherPauseFiltering:
    @pytest.mark.asyncio
    async def test_paused_dispatcher_skips_completion(self) -> None:
        """Sessions belonging to paused owners should not complete."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        pool = StubPool()
        pool.add_session("session-1", owner_id="user-paused")

        sub, volundr, _, _ = _make_subscriber(pool=pool, dispatcher_repo=dispatcher_repo)

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-paused",
        )
        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_running_dispatcher_allows_completion(self) -> None:
        """Sessions belonging to running owners should complete normally."""
        dispatcher_repo = StubDispatcherRepo(running=True)
        pool = StubPool()
        pool.add_session("session-1", owner_id="user-active")

        sub, volundr, _, _ = _make_subscriber(pool=pool, dispatcher_repo=dispatcher_repo)

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-active",
        )
        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "complete"

    @pytest.mark.asyncio
    async def test_paused_owner_still_allows_failure(self) -> None:
        """Even with a paused dispatcher, failure events should still be processed."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        pool = StubPool()
        pool.add_session("session-1", owner_id="user-paused")

        sub, volundr, _, _ = _make_subscriber(pool=pool, dispatcher_repo=dispatcher_repo)

        event = ActivityEvent(
            session_id="session-1",
            state="",
            metadata={},
            owner_id="user-paused",
            session_status="stopped",
        )
        await sub._on_activity_event(event, volundr)

        assert pool.sessions["session-1"]["status"] == "failed"


# ---------------------------------------------------------------------------
# Tests — Failure detection
# ---------------------------------------------------------------------------


class TestFailureDetection:
    @pytest.mark.asyncio
    async def test_session_stopped_transitions_to_failed(self) -> None:
        """A session_updated event with status=stopped should transition session to failed."""
        sub, volundr, pool, event_bus = _make_subscriber()
        pool.add_session("session-1")

        event = ActivityEvent(
            session_id="session-1",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr)

        assert pool.sessions["session-1"]["status"] == "failed"

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_failed_transitions_to_failed(self) -> None:
        """A session_updated event with status=failed should transition session to failed."""
        sub, volundr, pool, _ = _make_subscriber()
        pool.add_session("session-1")

        event = ActivityEvent(
            session_id="session-1",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )

        await sub._on_activity_event(event, volundr)

        assert pool.sessions["session-1"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_failed_cancels_pending_evaluation(self) -> None:
        """A failure event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)
        pool.add_session("session-1")

        # Schedule an idle evaluation
        idle_event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(idle_event, volundr)
        assert "session-1" in sub._pending_evaluations

        # Session crashes
        fail_event = ActivityEvent(
            session_id="session-1",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="failed",
        )
        await sub._on_activity_event(fail_event, volundr)

        assert "session-1" not in sub._pending_evaluations
        assert pool.sessions["session-1"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_not_found_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns None during debounced evaluation, session should fail."""
        sub, volundr, pool, _ = _make_subscriber()
        pool.add_session("session-1")

        # Remove the session from volundr so get_session returns None
        volundr.sessions.pop("session-1", None)

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_stopped_during_evaluation_transitions_to_failed(self) -> None:
        """If get_session returns a stopped session during evaluation, session should fail."""
        sub, volundr, pool, _ = _make_subscriber()
        pool.add_session("session-1")

        # Session is stopped in volundr
        volundr.sessions["session-1"] = _make_volundr_session(
            session_id="session-1", status="stopped"
        )

        event = ActivityEvent(
            session_id="session-1",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-1",
        )
        await sub._on_activity_event(event, volundr)
        await asyncio.sleep(0.1)

        assert pool.sessions["session-1"]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_failure_no_session_record_is_ignored(self) -> None:
        """A failure event for a session with no dispatched record should be ignored."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="",
            metadata={},
            owner_id="user-1",
            session_status="stopped",
        )
        await sub._on_activity_event(event, volundr)
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
