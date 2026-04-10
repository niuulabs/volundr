"""Tests for ThreadQueueTrigger (NIU-555)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from ravn.adapters.thread.queue_trigger import ThreadQueueTrigger
from ravn.domain.models import AgentTask
from ravn.domain.thread import RavnThread, ThreadStatus
from ravn.ports.thread import ThreadPort

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class FakeThreadStore(ThreadPort):
    def __init__(self, threads: list[RavnThread] | None = None) -> None:
        self._threads: dict[str, RavnThread] = {t.thread_id: t for t in (threads or [])}
        self.closed: list[str] = []
        self.weight_updates: dict[str, float] = {}

    async def upsert(self, thread: RavnThread) -> None:
        self._threads[thread.thread_id] = thread

    async def get(self, thread_id: str) -> RavnThread | None:
        return self._threads.get(thread_id)

    async def get_by_path(self, page_path: str) -> RavnThread | None:
        return None

    async def peek_queue(self, *, limit: int = 10) -> list[RavnThread]:
        open_t = [t for t in self._threads.values() if t.status == ThreadStatus.OPEN]
        open_t.sort(key=lambda t: t.weight, reverse=True)
        return open_t[:limit]

    async def list_open(self, *, limit: int = 100) -> list[RavnThread]:
        return [t for t in self._threads.values() if t.status == ThreadStatus.OPEN]

    async def close(self, thread_id: str) -> None:
        self.closed.append(thread_id)
        if thread_id in self._threads:
            t = self._threads[thread_id]
            self._threads[thread_id] = RavnThread(
                thread_id=t.thread_id,
                page_path=t.page_path,
                title=t.title,
                weight=t.weight,
                next_action=t.next_action,
                tags=t.tags,
                status=ThreadStatus.CLOSED,
                created_at=t.created_at,
                last_seen_at=datetime.now(UTC),
            )

    async def update_weight(self, thread_id: str, weight: float) -> None:
        self.weight_updates[thread_id] = weight


def _make_thread(
    path: str = "papers/foo.md",
    weight: float = 0.5,
    age_days: float = 0,
) -> RavnThread:
    now = datetime.now(UTC)
    created = now - timedelta(days=age_days)
    t = RavnThread.create(
        page_path=path,
        title="Test Thread",
        weight=weight,
        next_action="do something",
        tags=["test"],
    )
    return RavnThread(
        thread_id=t.thread_id,
        page_path=t.page_path,
        title=t.title,
        weight=t.weight,
        next_action=t.next_action,
        tags=t.tags,
        status=t.status,
        created_at=created,
        last_seen_at=created,
    )


class TestThreadQueueTrigger:
    def test_name(self) -> None:
        store = FakeThreadStore()
        trigger = ThreadQueueTrigger(store)
        assert trigger.name == "thread_queue"

    @pytest.mark.asyncio
    async def test_sweep_enqueues_open_threads(self) -> None:
        t = _make_thread(weight=0.8)
        store = FakeThreadStore([t])
        trigger = ThreadQueueTrigger(store, weight_floor=0.01, half_life_days=7.0)

        enqueued: list[AgentTask] = []

        async def enqueue(task: AgentTask) -> None:
            enqueued.append(task)

        await trigger._sweep(enqueue)

        assert len(enqueued) == 1
        assert "Test Thread" in enqueued[0].title
        assert enqueued[0].triggered_by == "thread_queue"

    @pytest.mark.asyncio
    async def test_sweep_closes_decayed_threads(self) -> None:
        # Very old thread should have near-zero composite weight
        old = _make_thread(weight=0.5, age_days=365)
        store = FakeThreadStore([old])
        trigger = ThreadQueueTrigger(
            store,
            weight_floor=0.05,
            half_life_days=7.0,
        )

        enqueued: list[AgentTask] = []

        async def enqueue(task: AgentTask) -> None:
            enqueued.append(task)

        await trigger._sweep(enqueue)

        # 365-day-old thread at 7-day half-life → weight ≈ 0 → should be closed
        assert old.thread_id in store.closed
        assert len(enqueued) == 0

    @pytest.mark.asyncio
    async def test_sweep_updates_weight(self) -> None:
        t = _make_thread(weight=0.9, age_days=1)
        store = FakeThreadStore([t])
        trigger = ThreadQueueTrigger(store, weight_floor=0.001, half_life_days=7.0)

        await trigger._sweep(AsyncMock())

        assert t.thread_id in store.weight_updates

    @pytest.mark.asyncio
    async def test_sweep_tolerates_peek_failure(self) -> None:
        store = FakeThreadStore()
        store.peek_queue = AsyncMock(side_effect=RuntimeError("db down"))
        trigger = ThreadQueueTrigger(store)

        # Should not raise
        await trigger._sweep(AsyncMock())

    @pytest.mark.asyncio
    async def test_run_calls_sweep_after_interval(self) -> None:
        store = FakeThreadStore([_make_thread(weight=0.8)])
        trigger = ThreadQueueTrigger(store, interval_seconds=0.01, weight_floor=0.001)

        enqueued: list[AgentTask] = []
        count = 0

        async def enqueue(task: AgentTask) -> None:
            nonlocal count
            count += 1
            enqueued.append(task)

        async def run_briefly() -> None:
            task = asyncio.create_task(trigger.run(enqueue))
            await asyncio.sleep(0.05)  # allow a few cycles
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        await run_briefly()
        assert count >= 1

    @pytest.mark.asyncio
    async def test_empty_queue_no_enqueue(self) -> None:
        store = FakeThreadStore()
        trigger = ThreadQueueTrigger(store)

        enqueued: list[AgentTask] = []
        await trigger._sweep(lambda t: enqueued.append(t))
        assert enqueued == []
