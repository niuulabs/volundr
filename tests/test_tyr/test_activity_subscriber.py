"""Tests for the event-driven session activity subscriber."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.config import WatcherConfig
from tyr.domain.models import DispatcherState, PRStatus
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

SESSION_ID = "session-1"
OWNER_ID = "user-1"
SAGA_ID = UUID("00000000-0000-0000-0000-000000000002")
TRACKER_ISSUE_ID = "issue-1"


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


class StubPool:
    """Mock asyncpg.Pool for dispatched_sessions queries."""

    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.executed: list[tuple[str, tuple]] = []

    def add_session(
        self,
        session_id: str,
        owner_id: str = OWNER_ID,
        saga_id: UUID = SAGA_ID,
        tracker_issue_id: str = TRACKER_ISSUE_ID,
        status: str = "running",
    ) -> None:
        self.sessions[session_id] = {
            "id": uuid4(),
            "session_id": session_id,
            "owner_id": owner_id,
            "saga_id": saga_id,
            "tracker_issue_id": tracker_issue_id,
            "status": status,
        }

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "DISTINCT owner_id" in query:
            owners = {s["owner_id"] for s in self.sessions.values() if s["status"] == "running"}
            return [{"owner_id": o} for o in owners]
        return []

    async def fetchrow(self, query: str, *args: object) -> dict | None:
        if "dispatched_sessions" in query and args:
            session_id = args[0]
            s = self.sessions.get(session_id)  # type: ignore[arg-type]
            if s and s["status"] == "running":
                return s
        return None

    async def execute(self, query: str, *args: object) -> None:
        self.executed.append((query, args))
        if "UPDATE dispatched_sessions SET status" not in query:
            return
        # Determine session_id from first positional arg ($1)
        session_id = args[0] if args else None
        for s in self.sessions.values():
            if s["session_id"] == session_id:
                if "'complete'" in query:
                    s["status"] = "complete"
                elif "'failed'" in query:
                    s["status"] = "failed"
                break


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


class StubVolundrFactory:
    """Stub factory that always returns the same adapter for any owner."""

    def __init__(self, adapter: StubVolundr) -> None:
        self._adapter = adapter

    async def for_owner(self, owner_id: str) -> StubVolundr:
        return self._adapter


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


def _make_volundr_session(session_id: str = SESSION_ID, status: str = "running") -> VolundrSession:
    return VolundrSession(
        id=session_id,
        name="Test Session",
        status=status,
        tracker_issue_id=None,
    )


def _make_record(
    session_id: str = SESSION_ID,
    owner_id: str = OWNER_ID,
    saga_id: UUID = SAGA_ID,
    tracker_issue_id: str = TRACKER_ISSUE_ID,
    status: str = "running",
) -> dict:
    """Create a dispatched_sessions record dict."""
    return {
        "id": uuid4(),
        "session_id": session_id,
        "owner_id": owner_id,
        "saga_id": saga_id,
        "tracker_issue_id": tracker_issue_id,
        "status": status,
    }


def _make_subscriber(
    volundr: StubVolundr | None = None,
    pool: StubPool | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
    event_bus: InMemoryEventBus | None = None,
    config: WatcherConfig | None = None,
) -> tuple[SessionActivitySubscriber, StubVolundr, StubPool, InMemoryEventBus]:
    v = volundr or StubVolundr()
    if SESSION_ID not in v.sessions:
        v.sessions[SESSION_ID] = _make_volundr_session()
    p = pool or StubPool()
    if not p.sessions:
        p.add_session(SESSION_ID)
    d = dispatcher_repo or StubDispatcherRepo()
    e = event_bus or InMemoryEventBus()
    c = config or _default_config()
    factory = StubVolundrFactory(v)
    sub = SessionActivitySubscriber(
        volundr_factory=factory, pool=p, dispatcher_repo=d, event_bus=e, config=c
    )
    return sub, v, p, e


# ---------------------------------------------------------------------------
# Tests -- CompletionEvaluation
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
# Tests -- Lifecycle
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
# Tests -- Activity event handling
# ---------------------------------------------------------------------------


class TestActivityEventHandling:
    @pytest.mark.asyncio
    async def test_idle_event_triggers_completion(self) -> None:
        """Idle event with sufficient turns completes the session."""
        sub, volundr, pool, event_bus = _make_subscriber()

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr, OWNER_ID)

        # Wait for debounced evaluation (delay=0)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "complete"

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["status"] == "complete"

    @pytest.mark.asyncio
    async def test_idle_with_no_turns_does_not_complete(self) -> None:
        """Idle with turn_count <= 1 should not trigger completion."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 1, "duration_seconds": 5},
            owner_id=OWNER_ID,
        )

        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "running"

    @pytest.mark.asyncio
    async def test_active_event_cancels_pending_evaluation(self) -> None:
        """An active event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)

        idle_event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(idle_event, volundr, OWNER_ID)
        assert SESSION_ID in sub._pending_evaluations

        # Active event cancels it
        active_event = ActivityEvent(
            session_id=SESSION_ID,
            state="active",
            metadata={},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(active_event, volundr, OWNER_ID)
        assert SESSION_ID not in sub._pending_evaluations
        assert pool.sessions[SESSION_ID]["status"] == "running"

    @pytest.mark.asyncio
    async def test_tool_executing_cancels_pending_evaluation(self) -> None:
        """A tool_executing event should cancel pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)

        idle_event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(idle_event, volundr, OWNER_ID)

        tool_event = ActivityEvent(
            session_id=SESSION_ID,
            state="tool_executing",
            metadata={},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(tool_event, volundr, OWNER_ID)
        assert SESSION_ID not in sub._pending_evaluations

    @pytest.mark.asyncio
    async def test_no_session_record_is_ignored(self) -> None:
        """Idle event for a session with no running record is ignored."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)
        # No crash, no transitions


# ---------------------------------------------------------------------------
# Tests -- Completion evaluation
# ---------------------------------------------------------------------------


class TestCompletionEvaluationLogic:
    @pytest.mark.asyncio
    async def test_basic_completion(self) -> None:
        """Session idle with turns > 1 should evaluate as complete."""
        sub, volundr, _, _ = _make_subscriber()
        record = _make_record()
        volundr.pr_error_sessions.add(record["session_id"])

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 60}
        )
        assert result.is_complete is True
        assert result.signals["session_idle"] is True
        assert result.signals["has_turns"] is True
        assert result.confidence >= 0.5

    @pytest.mark.asyncio
    async def test_pr_increases_confidence(self) -> None:
        """PR existence should increase confidence."""
        sub, volundr, _, _ = _make_subscriber()
        record = _make_record()
        volundr.pr_statuses[record["session_id"]] = PRStatus(
            pr_id="PR-1",
            url="https://github.com/pull/1",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 60}
        )
        assert result.is_complete is True
        assert result.signals["pr_exists"] is True
        assert result.signals["ci_passed"] is True
        assert result.confidence >= 0.9

    @pytest.mark.asyncio
    async def test_require_pr_blocks_completion(self) -> None:
        """When require_pr=True and no PR, should not complete."""
        config = _default_config(require_pr=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = _make_record()
        volundr.pr_error_sessions.add(record["session_id"])

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 60}
        )
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_require_ci_blocks_completion(self) -> None:
        """When require_ci=True and CI not passed, should not complete."""
        config = _default_config(require_ci=True)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = _make_record()
        volundr.pr_statuses[record["session_id"]] = PRStatus(
            pr_id="PR-1",
            url="url",
            state="open",
            mergeable=True,
            ci_passed=False,
        )

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 60}
        )
        assert result.is_complete is False

    @pytest.mark.asyncio
    async def test_extended_idle_increases_confidence(self) -> None:
        """Duration above threshold should increase confidence."""
        config = _default_config(idle_threshold=10.0)
        sub, volundr, _, _ = _make_subscriber(config=config)
        record = _make_record()
        volundr.pr_error_sessions.add(record["session_id"])

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 120}
        )
        assert result.signals["extended_idle"] is True
        assert result.confidence >= 0.6

    @pytest.mark.asyncio
    async def test_no_pr_still_evaluates(self) -> None:
        """Session without PR should still evaluate (pr_exists=False)."""
        sub, volundr, _, _ = _make_subscriber()
        record = _make_record()
        volundr.pr_error_sessions.add(record["session_id"])

        result = await sub._evaluate_completion(
            record, volundr, {"turn_count": 5, "duration_seconds": 60}
        )
        assert result.is_complete is True
        assert result.signals["pr_exists"] is False


# ---------------------------------------------------------------------------
# Tests -- Completion handling
# ---------------------------------------------------------------------------


class TestCompletionHandling:
    @pytest.mark.asyncio
    async def test_pr_info_stored_on_completion(self) -> None:
        """PR URL and ID should be emitted when PR is detected."""
        sub, volundr, pool, event_bus = _make_subscriber()

        record = _make_record()
        pool.sessions[SESSION_ID] = record

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={
                "session_idle": True,
                "has_turns": True,
                "pr_exists": True,
            },
            confidence=0.9,
            pr_id="PR-42",
            pr_url="https://github.com/org/repo/pull/42",
        )

        q = event_bus.subscribe()
        await sub._handle_completion(record, evaluation)

        assert pool.sessions[SESSION_ID]["status"] == "complete"

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.data["pr_id"] == "PR-42"
        assert bus_event.data["pr_url"] == "https://github.com/org/repo/pull/42"

    @pytest.mark.asyncio
    async def test_no_pr_still_transitions(self) -> None:
        """Completion without a PR should still transition to complete."""
        sub, volundr, pool, _ = _make_subscriber()

        record = _make_record()
        pool.sessions[SESSION_ID] = record

        evaluation = CompletionEvaluation(
            is_complete=True,
            signals={"session_idle": True, "has_turns": True},
            confidence=0.5,
        )

        await sub._handle_completion(record, evaluation)

        assert pool.sessions[SESSION_ID]["status"] == "complete"

    @pytest.mark.asyncio
    async def test_event_emitted_on_completion(self) -> None:
        """Event bus should receive session.state_changed on completion."""
        sub, volundr, pool, event_bus = _make_subscriber()

        record = _make_record()
        pool.sessions[SESSION_ID] = record

        q = event_bus.subscribe()
        await sub._handle_completion(record)

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["session_id"] == SESSION_ID
        assert bus_event.data["status"] == "complete"


# ---------------------------------------------------------------------------
# Tests -- Dispatcher pause filtering
# ---------------------------------------------------------------------------


class TestDispatcherPauseFiltering:
    @pytest.mark.asyncio
    async def test_paused_dispatcher_skips_completion(self) -> None:
        """Sessions belonging to paused owners should not complete."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        pool = StubPool()
        pool.add_session(SESSION_ID, owner_id="user-paused")

        sub, volundr, _, _ = _make_subscriber(pool=pool, dispatcher_repo=dispatcher_repo)

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-paused",
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "running"

    @pytest.mark.asyncio
    async def test_running_dispatcher_allows_completion(self) -> None:
        """Sessions belonging to running owners should complete normally."""
        dispatcher_repo = StubDispatcherRepo(running=True)
        pool = StubPool()
        pool.add_session(SESSION_ID, owner_id="user-active")

        sub, volundr, _, _ = _make_subscriber(pool=pool, dispatcher_repo=dispatcher_repo)

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id="user-active",
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "complete"


# ---------------------------------------------------------------------------
# Tests -- Failure detection
# ---------------------------------------------------------------------------


class TestFailureDetection:
    @pytest.mark.asyncio
    async def test_session_stopped_transitions_to_failed(self) -> None:
        """A session_status=stopped event should mark the session failed."""
        sub, volundr, pool, event_bus = _make_subscriber()

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="",
            metadata={},
            owner_id=OWNER_ID,
            session_status="stopped",
        )

        q = event_bus.subscribe()
        await sub._on_activity_event(event, volundr, OWNER_ID)

        assert pool.sessions[SESSION_ID]["status"] == "failed"

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_failed_transitions_to_failed(self) -> None:
        """A session_status=failed event should mark the session failed."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="",
            metadata={},
            owner_id=OWNER_ID,
            session_status="failed",
        )

        await sub._on_activity_event(event, volundr, OWNER_ID)

        assert pool.sessions[SESSION_ID]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_failed_cancels_pending_evaluation(self) -> None:
        """A failure event should cancel any pending idle evaluation."""
        config = _default_config(completion_check_delay=1.0)
        sub, volundr, pool, _ = _make_subscriber(config=config)

        # Schedule an idle evaluation
        idle_event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(idle_event, volundr, OWNER_ID)
        assert SESSION_ID in sub._pending_evaluations

        # Session crashes
        fail_event = ActivityEvent(
            session_id=SESSION_ID,
            state="",
            metadata={},
            owner_id=OWNER_ID,
            session_status="failed",
        )
        await sub._on_activity_event(fail_event, volundr, OWNER_ID)

        assert SESSION_ID not in sub._pending_evaluations
        assert pool.sessions[SESSION_ID]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_not_found_during_eval_fails(self) -> None:
        """If get_session returns None during evaluation, session fails."""
        sub, volundr, pool, _ = _make_subscriber()

        # Remove the session so get_session returns None
        volundr.sessions.pop(SESSION_ID, None)

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_session_stopped_during_eval_fails(self) -> None:
        """If get_session returns stopped during evaluation, session fails."""
        sub, volundr, pool, _ = _make_subscriber()

        # Session is stopped
        volundr.sessions[SESSION_ID] = _make_volundr_session(
            session_id=SESSION_ID, status="stopped"
        )

        event = ActivityEvent(
            session_id=SESSION_ID,
            state="idle",
            metadata={"turn_count": 5, "duration_seconds": 60},
            owner_id=OWNER_ID,
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        await asyncio.sleep(0.1)

        assert pool.sessions[SESSION_ID]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_failure_no_session_record_is_ignored(self) -> None:
        """A failure event for an unknown session should be ignored."""
        sub, volundr, pool, _ = _make_subscriber()

        event = ActivityEvent(
            session_id="unknown-session",
            state="",
            metadata={},
            owner_id=OWNER_ID,
            session_status="stopped",
        )
        await sub._on_activity_event(event, volundr, OWNER_ID)
        # No crash, no transitions

    @pytest.mark.asyncio
    async def test_event_emitted_on_failure(self) -> None:
        """Event bus should receive session.state_changed on failure."""
        sub, volundr, pool, event_bus = _make_subscriber()
        record = _make_record()
        pool.sessions[SESSION_ID] = record

        q = event_bus.subscribe()
        await sub._handle_failure(record, reason="Session stopped")

        bus_event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert bus_event.event == "session.state_changed"
        assert bus_event.data["session_id"] == SESSION_ID
        assert bus_event.data["status"] == "failed"


# ---------------------------------------------------------------------------
# Tests -- WatcherConfig new fields
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
