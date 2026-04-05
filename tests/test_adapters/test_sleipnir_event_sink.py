"""Tests for SleipnirEventSink and ChronicleEventSink adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from sleipnir.domain.registry import (
    VOLUNDR_CHRONICLE_CREATED,
    VOLUNDR_CHRONICLE_UPDATED,
    VOLUNDR_SESSION_STARTED,
    VOLUNDR_SESSION_STOPPED,
    VOLUNDR_TOKEN_USAGE,
)
from volundr.adapters.outbound.sleipnir_event_sink import (
    ChronicleEventSink,
    SleipnirEventSink,
)
from volundr.domain.models import SessionEvent, SessionEventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(**overrides) -> SessionEvent:
    defaults = {
        "id": uuid4(),
        "session_id": uuid4(),
        "event_type": SessionEventType.SESSION_START,
        "timestamp": datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC),
        "data": {"model": "claude-sonnet-4-6", "repo": "niuulabs/volundr"},
        "sequence": 0,
        "tokens_in": None,
        "tokens_out": None,
        "cost": None,
        "model": None,
        "duration_ms": None,
    }
    defaults.update(overrides)
    return SessionEvent(**defaults)


def _make_sink() -> tuple[SleipnirEventSink, AsyncMock]:
    publisher = AsyncMock()
    sink = SleipnirEventSink(publisher)
    return sink, publisher


# ---------------------------------------------------------------------------
# SleipnirEventSink — properties
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkProperties:
    def test_sink_name(self):
        sink, _ = _make_sink()
        assert sink.sink_name == "sleipnir"

    def test_healthy_initially_true(self):
        sink, _ = _make_sink()
        assert sink.healthy is True


# ---------------------------------------------------------------------------
# SleipnirEventSink — session lifecycle
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkSessionLifecycle:
    async def test_session_start_publishes_started_event(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.SESSION_START)
        await sink.emit(event)

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.event_type == VOLUNDR_SESSION_STARTED
        assert published.payload["session_id"] == str(event.session_id)
        assert published.correlation_id == str(event.session_id)

    async def test_session_stop_publishes_stopped_event(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_STOP,
            data={"reason": "user_requested"},
        )
        await sink.emit(event)

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.event_type == VOLUNDR_SESSION_STOPPED
        assert published.payload["reason"] == "user_requested"

    async def test_non_lifecycle_event_not_published(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.FILE_CREATED)
        await sink.emit(event)

        publisher.publish.assert_not_awaited()

    async def test_message_event_not_published(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.MESSAGE_ASSISTANT)
        await sink.emit(event)

        publisher.publish.assert_not_awaited()


# ---------------------------------------------------------------------------
# SleipnirEventSink — token usage
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkTokenUsage:
    async def test_token_usage_publishes_event(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.TOKEN_USAGE,
            tokens_in=1000,
            tokens_out=500,
            cost=Decimal("0.005"),
            model="claude-sonnet-4-6",
            data={"provider": "anthropic"},
        )
        await sink.emit(event)

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.event_type == VOLUNDR_TOKEN_USAGE
        assert published.payload["tokens_in"] == 1000
        assert published.payload["tokens_out"] == 500
        assert published.payload["cost"] == pytest.approx(0.005)
        assert published.payload["model"] == "claude-sonnet-4-6"

    async def test_token_usage_zero_tokens(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.TOKEN_USAGE,
            tokens_in=None,
            tokens_out=None,
            data={},
        )
        await sink.emit(event)

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.payload["tokens_in"] == 0
        assert published.payload["tokens_out"] == 0


# ---------------------------------------------------------------------------
# SleipnirEventSink — batch
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkBatch:
    async def test_batch_publishes_all_matching_events(self):
        sink, publisher = _make_sink()
        events = [
            _make_event(event_type=SessionEventType.SESSION_START),
            _make_event(event_type=SessionEventType.MESSAGE_ASSISTANT),  # not forwarded
            _make_event(event_type=SessionEventType.TOKEN_USAGE, data={}),
        ]
        await sink.emit_batch(events)

        assert publisher.publish.await_count == 2

    async def test_empty_batch_is_noop(self):
        sink, publisher = _make_sink()
        await sink.emit_batch([])
        publisher.publish.assert_not_awaited()


# ---------------------------------------------------------------------------
# SleipnirEventSink — fault tolerance
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkFaultTolerance:
    async def test_publish_failure_marks_unhealthy(self):
        sink, publisher = _make_sink()
        publisher.publish.side_effect = RuntimeError("broker down")

        event = _make_event(event_type=SessionEventType.SESSION_START)
        await sink.emit(event)  # must not raise

        assert sink.healthy is False

    async def test_healthy_restored_after_success(self):
        sink, publisher = _make_sink()
        publisher.publish.side_effect = RuntimeError("transient")

        event = _make_event(event_type=SessionEventType.SESSION_START)
        await sink.emit(event)
        assert sink.healthy is False

        publisher.publish.side_effect = None
        await sink.emit(event)
        assert sink.healthy is True

    async def test_flush_is_noop(self):
        sink, publisher = _make_sink()
        await sink.flush()  # must not raise or call publisher

    async def test_close_is_noop(self):
        sink, publisher = _make_sink()
        await sink.close()  # must not raise or call publisher


# ---------------------------------------------------------------------------
# SleipnirEventSink — tenant propagation
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkTenant:
    async def test_tenant_id_forwarded_from_payload(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_START,
            data={"tenant_id": "tenant-123"},
        )
        await sink.emit(event)

        published = publisher.publish.call_args[0][0]
        assert published.tenant_id == "tenant-123"

    async def test_no_tenant_id_when_missing(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.SESSION_START, data={})
        await sink.emit(event)

        published = publisher.publish.call_args[0][0]
        assert published.tenant_id is None


# ---------------------------------------------------------------------------
# ChronicleEventSink
# ---------------------------------------------------------------------------


class TestChronicleEventSink:
    def _make_chronicle_sink(self):
        publisher = AsyncMock()
        sink = ChronicleEventSink(publisher)
        return sink, publisher

    async def test_publish_created(self):
        sink, publisher = self._make_chronicle_sink()
        await sink.publish_created("chr-1", "session-1")

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.event_type == VOLUNDR_CHRONICLE_CREATED
        assert published.payload["chronicle_id"] == "chr-1"
        assert published.payload["session_id"] == "session-1"
        assert published.correlation_id == "session-1"

    async def test_publish_updated(self):
        sink, publisher = self._make_chronicle_sink()
        await sink.publish_updated("chr-2", "session-2", tenant_id="t1")

        publisher.publish.assert_awaited_once()
        published = publisher.publish.call_args[0][0]
        assert published.event_type == VOLUNDR_CHRONICLE_UPDATED
        assert published.tenant_id == "t1"

    async def test_publish_error_is_swallowed(self):
        sink, publisher = self._make_chronicle_sink()
        publisher.publish.side_effect = RuntimeError("network error")

        await sink.publish_created("chr-x", "session-x")  # must not raise
