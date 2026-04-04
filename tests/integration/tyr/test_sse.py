"""Integration tests for Tyr SSE event streaming.

Verifies that ``GET /api/v1/tyr/events`` delivers real-time Server-Sent
Events when domain actions occur.  Uses a real ``InMemoryEventBus``
instead of the no-op ``StubEventBus`` so that emitted events actually
fan out to SSE subscribers.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

from tests.integration.tyr.conftest import StubTracker
from tyr.adapters.memory_event_bus import InMemoryEventBus
from tyr.ports.event_bus import TyrEvent

pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio(loop_scope="session"),
]

SSE_URL = "/api/v1/tyr/events"

# Timeout for SSE event collection (seconds)
SSE_TIMEOUT = 5


def _parse_sse_events(raw: str) -> list[dict[str, str]]:
    """Parse raw SSE text into a list of field dicts."""
    events: list[dict[str, str]] = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        # Skip SSE comment lines (keepalive)
        if block.startswith(":"):
            continue
        fields: dict[str, str] = {}
        for line in block.split("\n"):
            if ": " in line:
                key, value = line.split(": ", 1)
                fields[key] = value
        if fields:
            events.append(fields)
    return events


# ------------------------------------------------------------------
# Fixtures — SSE-specific app with real InMemoryEventBus
# ------------------------------------------------------------------


@pytest_asyncio.fixture(loop_scope="session")
async def sse_event_bus() -> InMemoryEventBus:
    """Real in-memory event bus that fans out to subscribers."""
    return InMemoryEventBus()


@pytest_asyncio.fixture(loop_scope="session")
async def sse_tyr_app(tyr_settings, txn_pool, sse_event_bus):  # noqa: ANN001
    """Tyr app wired with a real InMemoryEventBus for SSE testing."""
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

    app = create_app(tyr_settings)

    @asynccontextmanager
    async def _test_lifespan(_app):  # noqa: ANN001
        yield

    app.router.lifespan_context = _test_lifespan

    saga_repo = PostgresSagaRepository(txn_pool)
    dispatcher_repo = PostgresDispatcherRepository(txn_pool)

    stub_tracker = StubTracker()
    stub_git = AsyncMock()
    stub_git.create_branch = AsyncMock(return_value=None)
    stub_llm = AsyncMock()
    stub_volundr = AsyncMock()

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
        return sse_event_bus

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

    return app


async def _collect_sse(
    app: object,
    n: int = 1,
    timeout: float = SSE_TIMEOUT,
) -> list[dict[str, str]]:
    """Open a fresh SSE connection and collect *n* events."""
    collected: list[dict[str, str]] = []
    transport = ASGITransport(app=app)  # type: ignore[arg-type]

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("GET", SSE_URL) as response:
            buffer = ""
            async for chunk in response.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    raw, buffer = buffer.split("\n\n", 1)
                    parsed = _parse_sse_events(raw + "\n\n")
                    collected.extend(parsed)
                    if len(collected) >= n:
                        return collected
    return collected


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------


async def test_tyr_sse_connects(
    sse_tyr_app: object,
    sse_event_bus: InMemoryEventBus,
) -> None:
    """GET /api/v1/tyr/events starts streaming with a snapshot event.

    Emits a dispatcher.state event (snapshot type) *before* connecting so
    the SSE endpoint replays it immediately on connect.
    """
    snapshot_event = TyrEvent(
        event="dispatcher.state",
        data={"status": "idle", "active_raids": 0},
    )
    await sse_event_bus.emit(snapshot_event)

    events = await asyncio.wait_for(
        _collect_sse(sse_tyr_app, n=1),
        timeout=SSE_TIMEOUT,
    )

    assert len(events) >= 1
    assert events[0]["event"] == "dispatcher.state"
    data = json.loads(events[0]["data"])
    assert data["status"] == "idle"
    assert data["active_raids"] == 0


async def test_tyr_sse_receives_saga_event(
    sse_tyr_app: object,
    sse_event_bus: InMemoryEventBus,
) -> None:
    """Connect SSE, emit a saga event, verify it arrives via the stream."""
    saga_event = TyrEvent(
        event="saga.created",
        data={"id": "saga-123", "name": "Auth Overhaul", "status": "ACTIVE"},
    )

    async def _emit_event() -> None:
        await asyncio.sleep(0.15)
        await sse_event_bus.emit(saga_event)

    emit_task = asyncio.create_task(_emit_event())

    events = await asyncio.wait_for(
        _collect_sse(sse_tyr_app, n=1),
        timeout=SSE_TIMEOUT,
    )
    await emit_task

    assert len(events) >= 1
    saga_events = [e for e in events if e["event"] == "saga.created"]
    assert len(saga_events) >= 1

    data = json.loads(saga_events[0]["data"])
    assert data["id"] == "saga-123"
    assert data["name"] == "Auth Overhaul"
    assert data["status"] == "ACTIVE"
