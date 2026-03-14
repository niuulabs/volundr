"""Tests for the InMemoryEventBroadcaster adapter."""

import asyncio
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest

from volundr.adapters.outbound.broadcaster import InMemoryEventBroadcaster
from volundr.domain.models import (
    EventType,
    GitSource,
    RealtimeEvent,
    Session,
    SessionStatus,
    Stats,
)


@pytest.fixture
def broadcaster() -> InMemoryEventBroadcaster:
    """Create a broadcaster for testing."""
    return InMemoryEventBroadcaster(max_queue_size=10)


@pytest.fixture
def sample_session() -> Session:
    """Create a sample session for testing."""
    return Session(
        id=uuid4(),
        name="Test Session",
        model="claude-sonnet-4-20250514",
        source=GitSource(repo="https://github.com/test/repo", branch="main"),
        status=SessionStatus.RUNNING,
    )


@pytest.fixture
def sample_stats() -> Stats:
    """Create sample stats for testing."""
    return Stats(
        active_sessions=5,
        total_sessions=10,
        tokens_today=1000,
        local_tokens=200,
        cloud_tokens=800,
        cost_today=Decimal("0.50"),
    )


class TestInMemoryEventBroadcaster:
    """Tests for InMemoryEventBroadcaster."""

    @pytest.mark.asyncio
    async def test_publish_to_subscriber(self, broadcaster: InMemoryEventBroadcaster):
        """Test that published events are received by subscribers."""
        event = RealtimeEvent(
            type=EventType.HEARTBEAT,
            data={},
            timestamp=datetime.utcnow(),
        )

        received_events: list[RealtimeEvent] = []

        async def collect_events():
            async for e in broadcaster.subscribe():
                received_events.append(e)
                break  # Only collect one event

        # Start subscriber task
        subscriber_task = asyncio.create_task(collect_events())

        # Give subscriber time to register
        await asyncio.sleep(0.01)

        # Publish event
        await broadcaster.publish(event)

        # Wait for subscriber to receive
        await asyncio.wait_for(subscriber_task, timeout=1.0)

        assert len(received_events) == 1
        assert received_events[0].type == EventType.HEARTBEAT

    @pytest.mark.asyncio
    async def test_multiple_subscribers(self, broadcaster: InMemoryEventBroadcaster):
        """Test that multiple subscribers receive the same event."""
        event = RealtimeEvent(
            type=EventType.HEARTBEAT,
            data={"test": "data"},
            timestamp=datetime.utcnow(),
        )

        received_1: list[RealtimeEvent] = []
        received_2: list[RealtimeEvent] = []

        async def collect_events(storage: list):
            async for e in broadcaster.subscribe():
                storage.append(e)
                break

        # Start two subscribers
        task1 = asyncio.create_task(collect_events(received_1))
        task2 = asyncio.create_task(collect_events(received_2))

        await asyncio.sleep(0.01)

        # Verify subscriber count
        assert broadcaster.subscriber_count == 2

        # Publish event
        await broadcaster.publish(event)

        # Wait for both subscribers
        await asyncio.wait_for(asyncio.gather(task1, task2), timeout=1.0)

        assert len(received_1) == 1
        assert len(received_2) == 1
        assert received_1[0].type == EventType.HEARTBEAT
        assert received_2[0].type == EventType.HEARTBEAT

    @pytest.mark.asyncio
    async def test_subscriber_cleanup_on_cancel(self, broadcaster: InMemoryEventBroadcaster):
        """Test that subscribers are cleaned up when cancelled."""

        async def long_running_subscriber():
            async for _ in broadcaster.subscribe():
                pass

        task = asyncio.create_task(long_running_subscriber())
        await asyncio.sleep(0.01)

        assert broadcaster.subscriber_count == 1

        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass  # Expected: task was intentionally cancelled

        # Give time for cleanup
        await asyncio.sleep(0.01)

        assert broadcaster.subscriber_count == 0

    @pytest.mark.asyncio
    async def test_publish_session_created(
        self,
        broadcaster: InMemoryEventBroadcaster,
        sample_session: Session,
    ):
        """Test publishing session created event."""
        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        await broadcaster.publish_session_created(sample_session)

        await asyncio.wait_for(task, timeout=1.0)

        assert len(received) == 1
        assert received[0].type == EventType.SESSION_CREATED
        assert received[0].data["id"] == str(sample_session.id)
        assert received[0].data["name"] == sample_session.name
        assert received[0].data["status"] == sample_session.status.value

    @pytest.mark.asyncio
    async def test_publish_session_updated(
        self,
        broadcaster: InMemoryEventBroadcaster,
        sample_session: Session,
    ):
        """Test publishing session updated event."""
        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        await broadcaster.publish_session_updated(sample_session)

        await asyncio.wait_for(task, timeout=1.0)

        assert len(received) == 1
        assert received[0].type == EventType.SESSION_UPDATED
        assert received[0].data["id"] == str(sample_session.id)

    @pytest.mark.asyncio
    async def test_publish_session_deleted(self, broadcaster: InMemoryEventBroadcaster):
        """Test publishing session deleted event."""
        session_id = uuid4()
        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        await broadcaster.publish_session_deleted(session_id)

        await asyncio.wait_for(task, timeout=1.0)

        assert len(received) == 1
        assert received[0].type == EventType.SESSION_DELETED
        assert received[0].data["id"] == str(session_id)

    @pytest.mark.asyncio
    async def test_publish_stats(
        self,
        broadcaster: InMemoryEventBroadcaster,
        sample_stats: Stats,
    ):
        """Test publishing stats update event."""
        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        await broadcaster.publish_stats(sample_stats)

        await asyncio.wait_for(task, timeout=1.0)

        assert len(received) == 1
        assert received[0].type == EventType.STATS_UPDATED
        assert received[0].data["active_sessions"] == sample_stats.active_sessions
        assert received[0].data["total_sessions"] == sample_stats.total_sessions
        assert received[0].data["tokens_today"] == sample_stats.tokens_today

    @pytest.mark.asyncio
    async def test_publish_heartbeat(self, broadcaster: InMemoryEventBroadcaster):
        """Test publishing heartbeat event."""
        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        await broadcaster.publish_heartbeat()

        await asyncio.wait_for(task, timeout=1.0)

        assert len(received) == 1
        assert received[0].type == EventType.HEARTBEAT
        assert received[0].data == {}

    @pytest.mark.asyncio
    async def test_queue_overflow_drops_old_events(self):
        """Test that queue overflow drops oldest events."""
        broadcaster = InMemoryEventBroadcaster(max_queue_size=2)

        received: list[RealtimeEvent] = []

        async def collect():
            async for e in broadcaster.subscribe():
                received.append(e)
                if len(received) == 2:
                    break

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.01)

        # Publish 3 events but queue size is 2
        for i in range(3):
            event = RealtimeEvent(
                type=EventType.HEARTBEAT,
                data={"index": i},
                timestamp=datetime.utcnow(),
            )
            await broadcaster.publish(event)

        await asyncio.wait_for(task, timeout=1.0)

        # Should only receive the last 2 events (oldest dropped)
        assert len(received) == 2
        assert received[0].data["index"] == 1
        assert received[1].data["index"] == 2

    @pytest.mark.asyncio
    async def test_create_session_event(
        self,
        broadcaster: InMemoryEventBroadcaster,
        sample_session: Session,
    ):
        """Test creating a session event."""
        event = broadcaster.create_session_event(EventType.SESSION_CREATED, sample_session)

        assert event.type == EventType.SESSION_CREATED
        assert event.data["id"] == str(sample_session.id)
        assert event.data["name"] == sample_session.name
        assert event.data["model"] == sample_session.model
        assert event.data["repo"] == sample_session.repo
        assert event.data["branch"] == sample_session.branch
        assert event.data["status"] == sample_session.status.value

    @pytest.mark.asyncio
    async def test_create_stats_event(
        self,
        broadcaster: InMemoryEventBroadcaster,
        sample_stats: Stats,
    ):
        """Test creating a stats event."""
        event = broadcaster.create_stats_event(sample_stats)

        assert event.type == EventType.STATS_UPDATED
        assert event.data["active_sessions"] == sample_stats.active_sessions
        assert event.data["cost_today"] == float(sample_stats.cost_today)

    @pytest.mark.asyncio
    async def test_create_heartbeat_event(self, broadcaster: InMemoryEventBroadcaster):
        """Test creating a heartbeat event."""
        event = broadcaster.create_heartbeat_event()

        assert event.type == EventType.HEARTBEAT
        assert event.data == {}
        assert event.timestamp is not None

    @pytest.mark.asyncio
    async def test_no_subscribers_publish_still_works(self, broadcaster: InMemoryEventBroadcaster):
        """Test that publishing with no subscribers doesn't error."""
        assert broadcaster.subscriber_count == 0

        # Should not raise
        await broadcaster.publish_heartbeat()
