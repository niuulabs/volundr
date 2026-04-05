"""Tests for SleipnirEventSink and ChronicleEventSink adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from sleipnir.domain import registry
from sleipnir.domain.events import SleipnirEvent
from volundr.adapters.outbound.sleipnir_event_sink import (
    _DEFAULT_URGENCY,
    _SESSION_TO_SLEIPNIR,
    _URGENCY_MAP,
    ChronicleEventSink,
    SleipnirEventSink,
)
from volundr.domain.models import SessionEvent, SessionEventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TS = datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC)


def _make_event(**overrides) -> SessionEvent:
    defaults = {
        "id": uuid4(),
        "session_id": uuid4(),
        "event_type": SessionEventType.MESSAGE_ASSISTANT,
        "timestamp": _TS,
        "data": {"content_preview": "hello"},
        "sequence": 0,
        "tokens_in": 100,
        "tokens_out": 50,
        "cost": Decimal("0.003"),
        "model": "claude-sonnet-4-20250514",
    }
    defaults.update(overrides)
    return SessionEvent(**defaults)


def _make_sink(**kwargs) -> tuple[SleipnirEventSink, AsyncMock]:
    publisher = AsyncMock()
    publisher.publish = AsyncMock()
    publisher.publish_batch = AsyncMock()
    sink = SleipnirEventSink(publisher=publisher, **kwargs)
    return sink, publisher


# ---------------------------------------------------------------------------
# sink_name / healthy
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkProperties:
    def test_sink_name(self):
        sink, _ = _make_sink()
        assert sink.sink_name == "sleipnir"

    def test_healthy_initially(self):
        sink, _ = _make_sink()
        assert sink.healthy is True


# ---------------------------------------------------------------------------
# flush / close
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkNoOps:
    async def test_flush_is_noop(self):
        sink, publisher = _make_sink()
        await sink.flush()
        publisher.publish.assert_not_called()

    async def test_close_is_noop(self):
        sink, publisher = _make_sink()
        await sink.close()
        publisher.publish.assert_not_called()


# ---------------------------------------------------------------------------
# emit — session lifecycle
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkSessionLifecycle:
    async def test_session_start_publishes_started_event(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_START,
            data={"model": "claude-sonnet-4-6"},
            tokens_in=None,
            tokens_out=None,
            cost=None,
            model=None,
        )

        await sink.emit(event)

        publisher.publish.assert_called_once()
        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.event_type == registry.VOLUNDR_SESSION_STARTED
        assert published.payload["session_id"] == str(event.session_id)
        assert published.correlation_id == str(event.session_id)

    async def test_session_stop_publishes_stopped_event(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_STOP,
            data={"reason": "user_requested"},
            tokens_in=None,
            tokens_out=None,
            cost=None,
            model=None,
        )

        await sink.emit(event)

        publisher.publish.assert_called_once()
        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.event_type == registry.VOLUNDR_SESSION_STOPPED
        assert published.payload["reason"] == "user_requested"

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

        publisher.publish.assert_called_once()
        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.event_type == registry.VOLUNDR_TOKEN_USAGE
        assert published.payload["tokens_in"] == 1000
        assert published.payload["tokens_out"] == 500
        assert published.payload["cost"] == pytest.approx(0.005)
        assert published.payload["model"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# emit — full type coverage
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkEmit:
    async def test_emit_calls_publish(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.MESSAGE_ASSISTANT)

        await sink.emit(event)

        publisher.publish.assert_called_once()
        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert isinstance(arg, SleipnirEvent)

    async def test_emit_sets_correct_event_type(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.SESSION_START)

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.event_type == registry.VOLUNDR_SESSION_STARTED

    async def test_emit_includes_session_id_in_payload(self):
        sink, publisher = _make_sink()
        event = _make_event()

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.payload["session_id"] == str(event.session_id)

    async def test_emit_sets_correlation_id(self):
        sink, publisher = _make_sink()
        event = _make_event()

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.correlation_id == str(event.session_id)

    async def test_emit_includes_tokens_when_present(self):
        sink, publisher = _make_sink()
        event = _make_event(tokens_in=42, tokens_out=7)

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.payload["tokens_in"] == 42
        assert arg.payload["tokens_out"] == 7

    async def test_emit_includes_model_when_present(self):
        sink, publisher = _make_sink()
        event = _make_event(model="claude-opus-4-6")

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.payload["model"] == "claude-opus-4-6"

    def test_emit_skips_unmapped_event_type_mapping_is_complete(self):
        """All critical event types have a Sleipnir mapping."""
        assert SessionEventType.MESSAGE_ASSISTANT in _SESSION_TO_SLEIPNIR

    async def test_emit_skips_none_mapping(self):
        """When event type has no Sleipnir mapping, publish is not called."""
        sink, publisher = _make_sink()
        event = _make_event()
        original = _SESSION_TO_SLEIPNIR.pop(SessionEventType.MESSAGE_ASSISTANT, None)
        try:
            await sink.emit(event)
            publisher.publish.assert_not_called()
        finally:
            if original is not None:
                _SESSION_TO_SLEIPNIR[SessionEventType.MESSAGE_ASSISTANT] = original

    async def test_emit_sets_healthy_true_on_success(self):
        sink, publisher = _make_sink()
        sink._healthy = False
        event = _make_event()

        await sink.emit(event)

        assert sink.healthy is True

    async def test_emit_sets_healthy_false_on_failure(self):
        sink, publisher = _make_sink()
        publisher.publish.side_effect = RuntimeError("bus down")
        event = _make_event()

        with pytest.raises(RuntimeError):
            await sink.emit(event)

        assert sink.healthy is False

    async def test_emit_raises_on_failure(self):
        sink, publisher = _make_sink()
        publisher.publish.side_effect = ValueError("oops")
        event = _make_event()

        with pytest.raises(ValueError):
            await sink.emit(event)

    async def test_emit_uses_custom_source(self):
        sink, publisher = _make_sink(source="volundr:prod")
        event = _make_event()

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.source == "volundr:prod"

    async def test_emit_urgency_error_is_higher(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.ERROR)

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.urgency == _URGENCY_MAP[SessionEventType.ERROR]

    async def test_emit_urgency_default_for_unmapped_urgency(self):
        sink, publisher = _make_sink()
        event = _make_event(event_type=SessionEventType.TOOL_USE)

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.urgency == _DEFAULT_URGENCY

    async def test_emit_domain_is_code(self):
        sink, publisher = _make_sink()
        event = _make_event()

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.domain == "code"

    async def test_emit_timestamp_preserved(self):
        sink, publisher = _make_sink()
        event = _make_event(timestamp=_TS)

        await sink.emit(event)

        arg: SleipnirEvent = publisher.publish.call_args[0][0]
        assert arg.timestamp == _TS


# ---------------------------------------------------------------------------
# tenant_id propagation
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkTenant:
    async def test_tenant_id_forwarded_from_payload(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_START,
            data={"tenant_id": "tenant-123"},
            tokens_in=None,
            tokens_out=None,
            cost=None,
            model=None,
        )

        await sink.emit(event)

        published = publisher.publish.call_args[0][0]
        assert published.tenant_id == "tenant-123"

    async def test_no_tenant_id_when_missing(self):
        sink, publisher = _make_sink()
        event = _make_event(
            event_type=SessionEventType.SESSION_START,
            data={},
            tokens_in=None,
            tokens_out=None,
            cost=None,
            model=None,
        )

        await sink.emit(event)

        published = publisher.publish.call_args[0][0]
        assert published.tenant_id is None


# ---------------------------------------------------------------------------
# emit_batch
# ---------------------------------------------------------------------------


class TestSleipnirEventSinkEmitBatch:
    async def test_emit_batch_calls_publish_batch(self):
        sink, publisher = _make_sink()
        events = [_make_event(sequence=i) for i in range(3)]

        await sink.emit_batch(events)

        publisher.publish_batch.assert_called_once()
        batch = publisher.publish_batch.call_args[0][0]
        assert len(batch) == 3

    async def test_emit_batch_filters_unmapped(self):
        sink, publisher = _make_sink()
        mapped = _make_event(event_type=SessionEventType.SESSION_START)
        unmapped = _make_event()
        original = _SESSION_TO_SLEIPNIR.pop(unmapped.event_type, None)
        try:
            await sink.emit_batch([mapped, unmapped])
            batch = publisher.publish_batch.call_args[0][0]
            assert len(batch) == 1
        finally:
            if original is not None:
                _SESSION_TO_SLEIPNIR[unmapped.event_type] = original

    async def test_emit_batch_empty_is_noop(self):
        sink, publisher = _make_sink()

        await sink.emit_batch([])

        publisher.publish_batch.assert_not_called()

    async def test_emit_batch_all_unmapped_is_noop(self):
        sink, publisher = _make_sink()
        event = _make_event()
        original = _SESSION_TO_SLEIPNIR.pop(event.event_type, None)
        try:
            await sink.emit_batch([event])
            publisher.publish_batch.assert_not_called()
        finally:
            if original is not None:
                _SESSION_TO_SLEIPNIR[event.event_type] = original

    async def test_emit_batch_sets_healthy_true_on_success(self):
        sink, publisher = _make_sink()
        sink._healthy = False

        await sink.emit_batch([_make_event()])

        assert sink.healthy is True

    async def test_emit_batch_sets_healthy_false_on_failure(self):
        sink, publisher = _make_sink()
        publisher.publish_batch.side_effect = RuntimeError("bus down")

        with pytest.raises(RuntimeError):
            await sink.emit_batch([_make_event()])

        assert sink.healthy is False


# ---------------------------------------------------------------------------
# All SessionEventType are mapped
# ---------------------------------------------------------------------------


class TestSessionToSleipnirMapping:
    def test_all_common_types_are_mapped(self):
        """The most critical session event types must have a Sleipnir mapping."""
        required = {
            SessionEventType.SESSION_START,
            SessionEventType.SESSION_STOP,
            SessionEventType.TOKEN_USAGE,
            SessionEventType.MESSAGE_USER,
            SessionEventType.MESSAGE_ASSISTANT,
            SessionEventType.ERROR,
            SessionEventType.GIT_COMMIT,
            SessionEventType.TOOL_USE,
        }
        missing = required - set(_SESSION_TO_SLEIPNIR.keys())
        assert not missing, f"Missing Sleipnir mappings for: {missing}"


# ---------------------------------------------------------------------------
# ChronicleEventSink
# ---------------------------------------------------------------------------


class TestChronicleEventSink:
    def _make_chronicle_sink(self) -> tuple[ChronicleEventSink, AsyncMock]:
        publisher = AsyncMock()
        publisher.publish = AsyncMock()
        sink = ChronicleEventSink(publisher)
        return sink, publisher

    async def test_publish_created(self):
        sink, publisher = self._make_chronicle_sink()
        await sink.publish_created("chr-1", "session-1")

        publisher.publish.assert_called_once()
        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.event_type == registry.VOLUNDR_CHRONICLE_CREATED
        assert published.payload["chronicle_id"] == "chr-1"
        assert published.payload["session_id"] == "session-1"
        assert published.correlation_id == "session-1"

    async def test_publish_updated(self):
        sink, publisher = self._make_chronicle_sink()
        await sink.publish_updated("chr-2", "session-2", tenant_id="t1")

        publisher.publish.assert_called_once()
        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.event_type == registry.VOLUNDR_CHRONICLE_UPDATED
        assert published.tenant_id == "t1"

    async def test_publish_created_with_tenant_id(self):
        sink, publisher = self._make_chronicle_sink()
        await sink.publish_created("chr-3", "session-3", tenant_id="tenant-xyz")

        published: SleipnirEvent = publisher.publish.call_args[0][0]
        assert published.tenant_id == "tenant-xyz"

    async def test_publish_error_is_swallowed(self):
        """Publisher failures in ChronicleEventSink must not raise."""
        sink, publisher = self._make_chronicle_sink()
        publisher.publish.side_effect = RuntimeError("network error")

        await sink.publish_created("chr-x", "session-x")  # must not raise

    async def test_publish_updated_error_is_swallowed(self):
        sink, publisher = self._make_chronicle_sink()
        publisher.publish.side_effect = RuntimeError("network error")

        await sink.publish_updated("chr-x", "session-x")  # must not raise
