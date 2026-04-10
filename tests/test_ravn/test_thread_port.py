"""Tests for ThreadPort via an in-memory fake adapter (NIU-555).

These tests verify the ThreadPort contract without touching real infrastructure.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from ravn.domain.thread import RavnThread, ThreadStatus
from ravn.ports.thread import ThreadPort


class FakeThreadStore(ThreadPort):
    """In-memory implementation of ThreadPort for testing."""

    def __init__(self) -> None:
        self._threads: dict[str, RavnThread] = {}

    async def upsert(self, thread: RavnThread) -> None:
        self._threads[thread.thread_id] = thread

    async def get(self, thread_id: str) -> RavnThread | None:
        return self._threads.get(thread_id)

    async def get_by_path(self, page_path: str) -> RavnThread | None:
        for t in self._threads.values():
            if t.page_path == page_path and t.status == ThreadStatus.OPEN:
                return t
        return None

    async def peek_queue(self, *, limit: int = 10) -> list[RavnThread]:
        open_threads = [t for t in self._threads.values() if t.status == ThreadStatus.OPEN]
        open_threads.sort(key=lambda t: t.weight, reverse=True)
        return open_threads[:limit]

    async def list_open(self, *, limit: int = 100) -> list[RavnThread]:
        open_threads = [t for t in self._threads.values() if t.status == ThreadStatus.OPEN]
        open_threads.sort(key=lambda t: t.created_at, reverse=True)
        return open_threads[:limit]

    async def close(self, thread_id: str) -> None:
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
        if thread_id in self._threads:
            t = self._threads[thread_id]
            self._threads[thread_id] = RavnThread(
                thread_id=t.thread_id,
                page_path=t.page_path,
                title=t.title,
                weight=weight,
                next_action=t.next_action,
                tags=t.tags,
                status=t.status,
                created_at=t.created_at,
                last_seen_at=datetime.now(UTC),
            )


@pytest.fixture()
def store() -> FakeThreadStore:
    return FakeThreadStore()


def _make_thread(path: str = "papers/foo.md", weight: float = 0.5) -> RavnThread:
    return RavnThread.create(
        page_path=path,
        title="Test Thread",
        weight=weight,
        next_action="do something",
        tags=["test"],
    )


class TestFakeThreadStore:
    @pytest.mark.asyncio
    async def test_upsert_and_get(self, store: FakeThreadStore) -> None:
        t = _make_thread()
        await store.upsert(t)
        result = await store.get(t.thread_id)
        assert result is not None
        assert result.thread_id == t.thread_id

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, store: FakeThreadStore) -> None:
        result = await store.get("nonexistent-id")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_by_path(self, store: FakeThreadStore) -> None:
        t = _make_thread("papers/bar.md")
        await store.upsert(t)
        result = await store.get_by_path("papers/bar.md")
        assert result is not None
        assert result.page_path == "papers/bar.md"

    @pytest.mark.asyncio
    async def test_get_by_path_missing_returns_none(self, store: FakeThreadStore) -> None:
        result = await store.get_by_path("nonexistent/path.md")
        assert result is None

    @pytest.mark.asyncio
    async def test_peek_queue_order(self, store: FakeThreadStore) -> None:
        low = _make_thread("low.md", weight=0.1)
        high = _make_thread("high.md", weight=0.9)
        mid = _make_thread("mid.md", weight=0.5)
        await store.upsert(low)
        await store.upsert(high)
        await store.upsert(mid)

        queue = await store.peek_queue(limit=10)
        weights = [t.weight for t in queue]
        assert weights == sorted(weights, reverse=True)

    @pytest.mark.asyncio
    async def test_peek_queue_respects_limit(self, store: FakeThreadStore) -> None:
        for i in range(5):
            await store.upsert(_make_thread(f"page{i}.md", weight=float(i) / 10))
        queue = await store.peek_queue(limit=3)
        assert len(queue) == 3

    @pytest.mark.asyncio
    async def test_list_open_excludes_closed(self, store: FakeThreadStore) -> None:
        t1 = _make_thread("open.md")
        t2 = _make_thread("closed.md")
        await store.upsert(t1)
        await store.upsert(t2)
        await store.close(t2.thread_id)

        open_list = await store.list_open()
        paths = [t.page_path for t in open_list]
        assert "open.md" in paths
        assert "closed.md" not in paths

    @pytest.mark.asyncio
    async def test_close_changes_status(self, store: FakeThreadStore) -> None:
        t = _make_thread()
        await store.upsert(t)
        await store.close(t.thread_id)
        result = await store.get(t.thread_id)
        assert result is not None
        assert result.status == ThreadStatus.CLOSED

    @pytest.mark.asyncio
    async def test_update_weight(self, store: FakeThreadStore) -> None:
        t = _make_thread(weight=0.5)
        await store.upsert(t)
        await store.update_weight(t.thread_id, 0.9)
        result = await store.get(t.thread_id)
        assert result is not None
        assert result.weight == 0.9

    @pytest.mark.asyncio
    async def test_peek_queue_excludes_closed(self, store: FakeThreadStore) -> None:
        open_t = _make_thread("open.md", weight=0.9)
        closed_t = _make_thread("closed.md", weight=1.0)
        await store.upsert(open_t)
        await store.upsert(closed_t)
        await store.close(closed_t.thread_id)

        queue = await store.peek_queue()
        ids = [t.thread_id for t in queue]
        assert open_t.thread_id in ids
        assert closed_t.thread_id not in ids

    @pytest.mark.asyncio
    async def test_upsert_overwrites(self, store: FakeThreadStore) -> None:
        t = _make_thread(weight=0.5)
        await store.upsert(t)
        updated = RavnThread(
            thread_id=t.thread_id,
            page_path=t.page_path,
            title="Updated Title",
            weight=0.8,
            next_action="updated action",
            tags=["updated"],
            status=t.status,
            created_at=t.created_at,
            last_seen_at=t.last_seen_at,
        )
        await store.upsert(updated)
        result = await store.get(t.thread_id)
        assert result is not None
        assert result.title == "Updated Title"
        assert result.weight == 0.8
