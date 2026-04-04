"""Tyr-specific integration test fixtures.

Provides a FastAPI test app wired to the transactional pool, with stubbed
external adapters (Tracker, Volundr, LLM, Git) so tests exercise real SQL
round-trips without requiring external services.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from tyr.domain.models import (
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.tracker import TrackerPort

# ---------------------------------------------------------------------------
# Stub adapters
# ---------------------------------------------------------------------------


class StubTracker(TrackerPort):
    """Tracker stub that records create calls and returns matching data on reads."""

    def __init__(self) -> None:
        self._counter = 0
        self._milestones: dict[str, list[TrackerMilestone]] = {}
        self._issues: dict[str, list[TrackerIssue]] = {}

    def _next_id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}-{self._counter}"

    # -- Create -----------------------------------------------------------

    async def create_saga(self, saga: Any, *, description: str = "") -> str:
        return self._next_id("stub-saga")

    async def create_phase(self, phase: Any, *, project_id: str = "") -> str:
        tid = self._next_id("stub-phase")
        ms = TrackerMilestone(
            id=tid,
            project_id=project_id,
            name=phase.name,
            description="",
            sort_order=phase.number,
            progress=0.0,
        )
        self._milestones.setdefault(project_id, []).append(ms)
        return tid

    async def create_raid(self, raid: Any, *, project_id: str = "", milestone_id: str = "") -> str:
        tid = self._next_id("stub-raid")
        issue = TrackerIssue(
            id=tid,
            identifier=f"STUB-{self._counter}",
            title=raid.name,
            description=raid.description,
            status="Todo",
            milestone_id=milestone_id,
        )
        self._issues.setdefault(milestone_id, []).append(issue)
        return tid

    # -- Update / close ---------------------------------------------------

    async def update_raid_state(self, raid_id: str, state: Any) -> None:
        pass

    async def close_raid(self, raid_id: str) -> None:
        pass

    # -- Read single entities ---------------------------------------------

    async def get_saga(self, saga_id: str) -> Any:
        raise NotImplementedError

    async def get_phase(self, tracker_id: str) -> Any:
        raise NotImplementedError

    async def get_raid(self, tracker_id: str) -> Any:
        raise NotImplementedError

    async def list_pending_raids(self, phase_id: str) -> list:
        return []

    # -- Browsing ---------------------------------------------------------

    async def list_projects(self) -> list[TrackerProject]:
        return []

    async def get_project(self, project_id: str) -> TrackerProject:
        return TrackerProject(
            id=project_id,
            name="Stub Project",
            description="",
            status="started",
            url="https://stub.example.com",
            milestone_count=len(self._milestones.get(project_id, [])),
            issue_count=sum(len(v) for v in self._issues.values()),
        )

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        return self._milestones.get(project_id, [])

    async def list_issues(
        self, project_id: str, milestone_id: str | None = None
    ) -> list[TrackerIssue]:
        if milestone_id is not None:
            return self._issues.get(milestone_id, [])
        result: list[TrackerIssue] = []
        for issues in self._issues.values():
            result.extend(issues)
        return result

    # -- Progress ---------------------------------------------------------

    async def update_raid_progress(self, tracker_id: str, **kwargs: Any) -> Any:
        raise NotImplementedError

    async def get_raid_progress_for_saga(self, saga_tracker_id: str) -> list:
        return []

    async def get_raid_by_session(self, session_id: str) -> Any:
        return None

    async def list_raids_by_status(self, status: Any) -> list:
        return []

    async def get_raid_by_id(self, raid_id: Any) -> Any:
        return None

    # -- Confidence events ------------------------------------------------

    async def add_confidence_event(self, tracker_id: str, event: Any) -> None:
        pass

    async def get_confidence_events(self, tracker_id: str) -> list:
        return []

    # -- Phase gates ------------------------------------------------------

    async def all_raids_merged(self, phase_tracker_id: str) -> bool:
        return False

    async def list_phases_for_saga(self, saga_tracker_id: str) -> list:
        return []

    async def update_phase_status(self, phase_tracker_id: str, status: Any) -> Any:
        return None

    # -- Cross-entity navigation ------------------------------------------

    async def get_saga_for_raid(self, tracker_id: str) -> Any:
        return None

    async def get_phase_for_raid(self, tracker_id: str) -> Any:
        return None

    async def get_owner_for_raid(self, tracker_id: str) -> str | None:
        return None

    # -- Session messages -------------------------------------------------

    async def save_session_message(self, message: Any) -> None:
        pass

    async def get_session_messages(self, tracker_id: str) -> list:
        return []


class StubEventBus(EventBusPort):
    """Minimal in-memory event bus for tests."""

    def subscribe(self) -> asyncio.Queue[TyrEvent]:
        return asyncio.Queue()

    def unsubscribe(self, q: asyncio.Queue[TyrEvent]) -> None:
        pass

    async def emit(self, event: TyrEvent) -> None:
        pass

    def get_snapshot(self) -> list[TyrEvent]:
        return []

    def get_log(self, n: int) -> list[TyrEvent]:
        return []

    @property
    def client_count(self) -> int:
        return 0

    @property
    def at_capacity(self) -> bool:
        return False


# ---------------------------------------------------------------------------
# App factory helper
# ---------------------------------------------------------------------------


def create_tyr_test_app(
    settings: Any,
    pool: Any,
    event_bus: EventBusPort,
) -> Any:
    """Build a Tyr FastAPI app with real DB repos and the given event bus.

    Shared by ``tyr_app`` (uses StubEventBus) and SSE-specific fixtures
    (uses InMemoryEventBus).
    """
    from tyr.adapters.postgres_dispatcher import PostgresDispatcherRepository
    from tyr.adapters.postgres_sagas import PostgresSagaRepository
    from tyr.api.dispatch import resolve_dispatcher_repo as dispatch_resolve_dispatcher_repo
    from tyr.api.dispatch import resolve_saga_repo as dispatch_resolve_saga_repo
    from tyr.api.dispatch import resolve_volundr
    from tyr.api.dispatcher import resolve_dispatcher_repo
    from tyr.api.dispatcher import resolve_event_bus as dispatcher_resolve_event_bus
    from tyr.api.events import resolve_event_bus
    from tyr.api.raids import resolve_git, resolve_raid_repo
    from tyr.api.raids import resolve_tracker as resolve_raids_tracker
    from tyr.api.raids import resolve_volundr as resolve_raids_volundr
    from tyr.api.sagas import resolve_git as sagas_resolve_git
    from tyr.api.sagas import resolve_llm, resolve_saga_repo
    from tyr.api.sagas import resolve_volundr as sagas_resolve_volundr
    from tyr.api.tracker import resolve_trackers
    from tyr.main import create_app

    app = create_app(settings)

    # Replace the heavy lifespan with a no-op so we control wiring.
    @asynccontextmanager
    async def _test_lifespan(_app):  # noqa: ANN001
        yield

    app.router.lifespan_context = _test_lifespan

    # Real repos backed by the transactional pool
    saga_repo = PostgresSagaRepository(pool)
    dispatcher_repo = PostgresDispatcherRepository(pool)

    # Stubs for external adapters
    stub_tracker = StubTracker()
    stub_git = AsyncMock()
    stub_git.create_branch = AsyncMock(return_value=None)
    stub_llm = AsyncMock()
    stub_volundr = AsyncMock()

    # -- Wire dependency overrides ----------------------------------------

    async def _saga_repo():  # noqa: ANN202
        return saga_repo

    async def _dispatcher_repo():  # noqa: ANN202
        return dispatcher_repo

    async def _tracker():  # noqa: ANN202
        return stub_tracker

    async def _trackers():  # noqa: ANN202
        return [stub_tracker]

    async def _volundr():  # noqa: ANN202
        return stub_volundr

    async def _llm():  # noqa: ANN202
        return stub_llm

    async def _git():  # noqa: ANN202
        return stub_git

    async def _event_bus():  # noqa: ANN202
        return event_bus

    app.dependency_overrides[resolve_saga_repo] = _saga_repo
    app.dependency_overrides[dispatch_resolve_saga_repo] = _saga_repo
    app.dependency_overrides[resolve_raid_repo] = _saga_repo
    app.dependency_overrides[resolve_dispatcher_repo] = _dispatcher_repo
    app.dependency_overrides[dispatch_resolve_dispatcher_repo] = _dispatcher_repo
    app.dependency_overrides[resolve_trackers] = _trackers
    app.dependency_overrides[resolve_raids_tracker] = _tracker
    app.dependency_overrides[resolve_llm] = _llm
    app.dependency_overrides[resolve_git] = _git
    app.dependency_overrides[sagas_resolve_git] = _git
    app.dependency_overrides[resolve_volundr] = _volundr
    app.dependency_overrides[resolve_raids_volundr] = _volundr
    app.dependency_overrides[sagas_resolve_volundr] = _volundr
    app.dependency_overrides[resolve_event_bus] = _event_bus
    app.dependency_overrides[dispatcher_resolve_event_bus] = _event_bus

    # Expose on app.state for test assertions
    app.state.settings = settings
    app.state.pool = pool
    app.state.stub_tracker = stub_tracker

    return app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="session")
async def tyr_app(tyr_settings, txn_pool):  # noqa: ANN001
    """Create a Tyr FastAPI app with real DB repos and stubbed external adapters."""
    return create_tyr_test_app(tyr_settings, txn_pool, StubEventBus())


@pytest_asyncio.fixture(loop_scope="session")
async def tyr_client(tyr_app):  # noqa: ANN001
    """HTTP client that talks to the test Tyr app."""
    async with AsyncClient(
        transport=ASGITransport(app=tyr_app),
        base_url="http://test",
    ) as client:
        yield client
