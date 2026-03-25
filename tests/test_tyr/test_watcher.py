"""Tests for the raid completion watcher."""

from __future__ import annotations

import asyncio
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
from tyr.domain.services.watcher import RaidWatcher, WatcherStats
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.raid_repository import RaidRepository
from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC)


class StubVolundr(VolundrPort):
    """In-memory Volundr stub for watcher tests."""

    def __init__(self) -> None:
        self.sessions: dict[str, VolundrSession] = {}
        self.pr_statuses: dict[str, PRStatus] = {}
        self.chronicles: dict[str, str] = {}
        self.pr_error_sessions: set[str] = set()
        self.chronicle_error_sessions: set[str] = set()

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


class StubRaidRepo(RaidRepository):
    """In-memory raid repository for watcher tests."""

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

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, raid_id: UUID) -> None:
        return None

    async def save_phase(self, phase: object, *, conn: object = None) -> None:
        pass

    async def save_raid(self, raid: object, *, conn: object = None) -> None:
        pass

    async def get_owner_for_raid(self, raid_id: UUID) -> str | None:
        saga = await self.get_saga_for_raid(raid_id)
        return saga.owner_id if saga else None

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        return False

    async def save_session_message(self, message: object) -> None:
        pass

    async def get_session_messages(self, raid_id: UUID) -> list:
        return []


class StubDispatcherRepo(DispatcherRepository):
    """In-memory dispatcher repo for watcher tests."""

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
        branch="raid/test",
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
    }
    defaults.update(overrides)
    return WatcherConfig(**defaults)


def _make_watcher(
    volundr: StubVolundr | None = None,
    raid_repo: StubRaidRepo | None = None,
    dispatcher_repo: StubDispatcherRepo | None = None,
    event_bus: InMemoryEventBus | None = None,
    config: WatcherConfig | None = None,
) -> tuple[RaidWatcher, StubVolundr, StubRaidRepo, InMemoryEventBus]:
    v = volundr or StubVolundr()
    r = raid_repo or StubRaidRepo()
    d = dispatcher_repo or StubDispatcherRepo()
    e = event_bus or InMemoryEventBus()
    c = config or _default_config()
    watcher = RaidWatcher(volundr=v, raid_repo=r, dispatcher_repo=d, event_bus=e, config=c)
    return watcher, v, r, e


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestWatcherStats:
    def test_defaults(self) -> None:
        stats = WatcherStats()
        assert stats.checked == 0
        assert stats.transitioned == 0
        assert stats.errors == 0

    def test_custom_values(self) -> None:
        stats = WatcherStats(checked=5, transitioned=2, errors=1)
        assert stats.checked == 5
        assert stats.transitioned == 2
        assert stats.errors == 1


class TestRaidWatcherInit:
    def test_not_running_initially(self) -> None:
        watcher, _, _, _ = _make_watcher()
        assert watcher.running is False

    @pytest.mark.asyncio
    async def test_disabled_by_config(self) -> None:
        config = _default_config(enabled=False)
        watcher, _, _, _ = _make_watcher(config=config)
        await watcher.start()
        assert watcher.running is False

    @pytest.mark.asyncio
    async def test_start_stop(self) -> None:
        watcher, _, _, _ = _make_watcher()
        await watcher.start()
        assert watcher.running is True
        await watcher.stop()
        assert watcher.running is False


class TestPollCycle:
    @pytest.mark.asyncio
    async def test_no_running_raids(self) -> None:
        watcher, _, _, _ = _make_watcher()
        stats = await watcher._poll_cycle()
        assert stats.checked == 0
        assert stats.transitioned == 0

    @pytest.mark.asyncio
    async def test_session_still_running(self) -> None:
        """Raids whose sessions are still running should not transition."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="running", tracker_issue_id=None
        )

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 0
        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_session_completed_transitions_to_review(self) -> None:
        """A completed session should transition the raid to REVIEW."""
        watcher, volundr, raid_repo, event_bus = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.chronicles[raid.session_id] = "Work completed successfully"

        # Subscribe to capture events
        q = event_bus.subscribe()

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 1

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.chronicle_summary == "Work completed successfully"

        # Verify event was emitted
        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["raid_id"] == str(raid.id)
        assert event.data["status"] == "REVIEW"

    @pytest.mark.asyncio
    async def test_session_stopped_transitions_to_review(self) -> None:
        """A stopped session should also transition to REVIEW."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="stopped", tracker_issue_id=None
        )

        stats = await watcher._poll_cycle()
        assert stats.transitioned == 1
        assert raid_repo.raids[raid.id].status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_session_failed_transitions_to_failed(self) -> None:
        """A failed session should transition the raid to FAILED."""
        watcher, volundr, raid_repo, event_bus = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="failed", tracker_issue_id=None
        )
        volundr.chronicles[raid.session_id] = "Session crashed"

        q = event_bus.subscribe()

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 1

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.FAILED
        assert updated.chronicle_summary == "Session crashed"
        assert updated.retry_count == 1

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["status"] == "FAILED"

    @pytest.mark.asyncio
    async def test_pr_info_stored_on_completion(self) -> None:
        """PR URL and ID should be stored when PR is detected."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.pr_statuses[raid.session_id] = PRStatus(
            pr_id="PR-42",
            url="https://github.com/org/repo/pull/42",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        await watcher._poll_cycle()

        updated = raid_repo.raids[raid.id]
        assert updated.pr_id == "PR-42"
        assert updated.pr_url == "https://github.com/org/repo/pull/42"

    @pytest.mark.asyncio
    async def test_no_pr_still_transitions(self) -> None:
        """Completion without a PR should still transition to REVIEW."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.pr_error_sessions.add(raid.session_id)

        await watcher._poll_cycle()

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.pr_id is None

    @pytest.mark.asyncio
    async def test_chronicle_fetch_failure_does_not_block(self) -> None:
        """Chronicle fetch failure should not prevent transition."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.chronicle_error_sessions.add(raid.session_id)

        await watcher._poll_cycle()

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.chronicle_summary is None

    @pytest.mark.asyncio
    async def test_chronicle_disabled(self) -> None:
        """When chronicle_on_complete is False, no chronicle fetch occurs."""
        config = _default_config(chronicle_on_complete=False)
        watcher, volundr, raid_repo, _ = _make_watcher(config=config)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.chronicles[raid.session_id] = "Should not be fetched"

        await watcher._poll_cycle()

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.REVIEW
        assert updated.chronicle_summary is None

    @pytest.mark.asyncio
    async def test_session_not_found(self) -> None:
        """Missing session should not crash, just skip."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        # Don't add session to volundr.sessions

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 0
        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_raid_without_session_id(self) -> None:
        """Raid with no session_id should be skipped."""
        watcher, _, raid_repo, _ = _make_watcher()
        raid = Raid(
            id=uuid4(),
            phase_id=uuid4(),
            tracker_id="t-1",
            name="No session",
            description="",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=None,
            status=RaidStatus.RUNNING,
            confidence=0.5,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            pr_url=None,
            pr_id=None,
            retry_count=0,
            created_at=NOW,
            updated_at=NOW,
        )
        raid_repo.raids[raid.id] = raid

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 0

    @pytest.mark.asyncio
    async def test_multiple_raids_batch(self) -> None:
        """Multiple RUNNING raids should be checked concurrently."""
        watcher, volundr, raid_repo, _ = _make_watcher()

        raids = []
        for i in range(5):
            r = _make_raid(session_id=f"session-{i}")
            raid_repo.raids[r.id] = r
            raids.append(r)
            volundr.sessions[f"session-{i}"] = VolundrSession(
                id=f"session-{i}",
                name=f"s{i}",
                status="completed" if i < 3 else "running",
                tracker_issue_id=None,
            )

        stats = await watcher._poll_cycle()
        assert stats.checked == 5
        assert stats.transitioned == 3

    @pytest.mark.asyncio
    async def test_batch_size_limits_concurrency(self) -> None:
        """Batch size should limit concurrent checks."""
        config = _default_config(batch_size=2)
        watcher, volundr, raid_repo, _ = _make_watcher(config=config)

        for i in range(4):
            r = _make_raid(session_id=f"session-{i}")
            raid_repo.raids[r.id] = r
            volundr.sessions[f"session-{i}"] = VolundrSession(
                id=f"session-{i}",
                name=f"s{i}",
                status="completed",
                tracker_issue_id=None,
            )

        stats = await watcher._poll_cycle()
        assert stats.checked == 4
        assert stats.transitioned == 4

    @pytest.mark.asyncio
    async def test_error_in_single_raid_does_not_block_others(self) -> None:
        """An error checking one raid should not prevent others from being checked."""
        watcher, volundr, raid_repo, _ = _make_watcher()

        # Good raid
        r1 = _make_raid(session_id="session-good")
        raid_repo.raids[r1.id] = r1
        volundr.sessions["session-good"] = VolundrSession(
            id="session-good", name="s1", status="completed", tracker_issue_id=None
        )

        # Bad raid — session will raise during get_session
        r2 = _make_raid(session_id="session-bad")
        raid_repo.raids[r2.id] = r2
        # Override get_session to raise for bad session
        original_get = volundr.get_session

        async def _patched_get(
            session_id: str, *, auth_token: str | None = None
        ) -> VolundrSession | None:
            if session_id == "session-bad":
                raise RuntimeError("Connection failed")
            return await original_get(session_id, auth_token=auth_token)

        volundr.get_session = _patched_get  # type: ignore[assignment]

        stats = await watcher._poll_cycle()
        assert stats.checked == 2
        assert stats.errors == 1
        assert stats.transitioned == 1
        assert raid_repo.raids[r1.id].status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_failed_session_stores_chronicle(self) -> None:
        """Failed session should still fetch and store chronicle."""
        watcher, volundr, raid_repo, _ = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="failed", tracker_issue_id=None
        )
        volundr.chronicles[raid.session_id] = "Error in file X"

        await watcher._poll_cycle()

        updated = raid_repo.raids[raid.id]
        assert updated.status == RaidStatus.FAILED
        assert updated.chronicle_summary == "Error in file X"


class TestWatcherLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_background_task(self) -> None:
        watcher, _, _, _ = _make_watcher()
        await watcher.start()
        assert watcher._task is not None
        assert not watcher._task.done()
        await watcher.stop()

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self) -> None:
        watcher, _, _, _ = _make_watcher()
        await watcher.start()
        task = watcher._task
        await watcher.stop()
        assert watcher._task is None
        assert task.done()

    @pytest.mark.asyncio
    async def test_stop_when_not_started(self) -> None:
        """Stopping a watcher that was never started should not raise."""
        watcher, _, _, _ = _make_watcher()
        await watcher.stop()  # Should not raise


class TestEventEmission:
    @pytest.mark.asyncio
    async def test_review_event_data(self) -> None:
        """Verify raid.state_changed event data on REVIEW transition."""
        watcher, volundr, raid_repo, event_bus = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )
        volundr.pr_statuses[raid.session_id] = PRStatus(
            pr_id="PR-99",
            url="https://github.com/org/repo/pull/99",
            state="open",
            mergeable=True,
            ci_passed=True,
        )

        q = event_bus.subscribe()
        await watcher._poll_cycle()

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["raid_id"] == str(raid.id)
        assert event.data["status"] == "REVIEW"
        assert event.data["session_id"] == raid.session_id
        assert event.data["pr_id"] == "PR-99"
        assert event.data["pr_url"] == "https://github.com/org/repo/pull/99"

    @pytest.mark.asyncio
    async def test_failed_event_data(self) -> None:
        """Verify raid.state_changed event data on FAILED transition."""
        watcher, volundr, raid_repo, event_bus = _make_watcher()
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="failed", tracker_issue_id=None
        )

        q = event_bus.subscribe()
        await watcher._poll_cycle()

        event = await asyncio.wait_for(q.get(), timeout=1.0)
        assert event.event == "raid.state_changed"
        assert event.data["status"] == "FAILED"


class TestDispatcherPauseFiltering:
    @pytest.mark.asyncio
    async def test_paused_dispatcher_skips_raids(self) -> None:
        """Raids belonging to an owner with a paused dispatcher should be skipped."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga(owner_id="user-paused")

        watcher, volundr, _, _ = _make_watcher(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )

        stats = await watcher._poll_cycle()
        assert stats.checked == 0
        assert raid_repo.raids[raid.id].status == RaidStatus.RUNNING

    @pytest.mark.asyncio
    async def test_running_dispatcher_allows_raids(self) -> None:
        """Raids belonging to an owner with a running dispatcher should be checked."""
        dispatcher_repo = StubDispatcherRepo(running=True)
        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga(owner_id="user-active")

        watcher, volundr, _, _ = _make_watcher(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 1
        assert raid_repo.raids[raid.id].status == RaidStatus.REVIEW

    @pytest.mark.asyncio
    async def test_no_saga_allows_raid(self) -> None:
        """Raids with no parent saga should still be checked (graceful fallback)."""
        dispatcher_repo = StubDispatcherRepo(running=False)
        raid_repo = StubRaidRepo()
        # saga is None by default

        watcher, volundr, _, _ = _make_watcher(raid_repo=raid_repo, dispatcher_repo=dispatcher_repo)
        raid = _make_raid()
        raid_repo.raids[raid.id] = raid
        volundr.sessions[raid.session_id] = VolundrSession(
            id=raid.session_id, name="s", status="completed", tracker_issue_id=None
        )

        stats = await watcher._poll_cycle()
        assert stats.checked == 1
        assert stats.transitioned == 1


class TestWatcherConfig:
    def test_defaults(self) -> None:
        cfg = WatcherConfig()
        assert cfg.enabled is True
        assert cfg.poll_interval == 30.0
        assert cfg.batch_size == 10
        assert cfg.chronicle_on_complete is True

    def test_custom(self) -> None:
        cfg = WatcherConfig(enabled=False, poll_interval=60.0, batch_size=5)
        assert cfg.enabled is False
        assert cfg.poll_interval == 60.0
        assert cfg.batch_size == 5
