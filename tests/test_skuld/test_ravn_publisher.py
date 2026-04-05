"""Tests for skuld.ravn_publisher.RavnPublisher."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from skuld.ravn_publisher import RavnPublisher
from sleipnir.adapters.in_process import InProcessBus
from sleipnir.domain.registry import (
    RAVN_INTERRUPT,
    RAVN_RESPONSE_COMPLETE,
    RAVN_SESSION_END,
    RAVN_SESSION_START,
    RAVN_STEP_COMPLETE,
    RAVN_STEP_START,
    RAVN_TOOL_CALL,
    RAVN_TOOL_COMPLETE,
    RAVN_TOOL_ERROR,
)
from sleipnir.testing import EventCapture

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_publisher(session_id="sess-001") -> tuple[RavnPublisher, InProcessBus]:
    bus = InProcessBus()
    pub = RavnPublisher(bus, session_id=session_id)
    return pub, bus


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


class TestRavnPublisherSessionLifecycle:
    async def test_on_session_start_publishes_event(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_SESSION_START]) as capture:
            await pub.on_session_start(model="claude-sonnet-4-6")
            await bus.flush()

        assert len(capture.events) == 1
        evt = capture.events[0]
        assert evt.event_type == RAVN_SESSION_START
        assert evt.payload["session_id"] == "sess-001"
        assert evt.payload["model"] == "claude-sonnet-4-6"
        assert evt.correlation_id == "sess-001"

    async def test_on_session_end_publishes_event(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_SESSION_END]) as capture:
            await pub.on_session_end(reason="interrupted")
            await bus.flush()

        assert len(capture.events) == 1
        evt = capture.events[0]
        assert evt.event_type == RAVN_SESSION_END
        assert evt.payload["reason"] == "interrupted"

    async def test_on_interrupt_publishes_event(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_INTERRUPT]) as capture:
            await pub.on_interrupt()
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].urgency == pytest.approx(0.9)


# ---------------------------------------------------------------------------
# NDJSON line handling
# ---------------------------------------------------------------------------


class TestRavnPublisherNdjsonLines:
    async def test_tool_use_line_emits_tool_call(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_TOOL_CALL]) as capture:
            await pub.on_ndjson_line(
                {"type": "tool_use", "id": "tu-1", "name": "bash", "input": {"command": "ls"}}
            )
            await bus.flush()

        assert len(capture.events) == 1
        evt = capture.events[0]
        assert evt.event_type == RAVN_TOOL_CALL
        assert evt.payload["tool"] == "bash"
        assert evt.payload["tool_use_id"] == "tu-1"

    async def test_tool_result_success_emits_tool_complete(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_TOOL_COMPLETE]) as capture:
            await pub.on_ndjson_line(
                {"type": "tool_result", "tool_use_id": "tu-1", "is_error": False}
            )
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == RAVN_TOOL_COMPLETE

    async def test_tool_result_error_emits_tool_error(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_TOOL_ERROR]) as capture:
            await pub.on_ndjson_line(
                {"type": "tool_result", "tool_use_id": "tu-2", "is_error": True}
            )
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == RAVN_TOOL_ERROR

    async def test_user_message_emits_step_start(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_STEP_START]) as capture:
            await pub.on_ndjson_line({"type": "message", "role": "user"})
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == RAVN_STEP_START

    async def test_assistant_end_turn_emits_response_complete(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_RESPONSE_COMPLETE]) as capture:
            await pub.on_ndjson_line(
                {"type": "message", "role": "assistant", "stop_reason": "end_turn"}
            )
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == RAVN_RESPONSE_COMPLETE

    async def test_assistant_non_end_turn_emits_step_complete(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_STEP_COMPLETE]) as capture:
            await pub.on_ndjson_line(
                {"type": "message", "role": "assistant", "stop_reason": "tool_use"}
            )
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].event_type == RAVN_STEP_COMPLETE

    async def test_system_init_emits_session_start(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, [RAVN_SESSION_START]) as capture:
            await pub.on_ndjson_line(
                {
                    "type": "system",
                    "subtype": "init",
                    "session": {"model": "claude-opus-4-6"},
                }
            )
            await bus.flush()

        assert len(capture.events) == 1
        assert capture.events[0].payload["model"] == "claude-opus-4-6"

    async def test_unknown_type_produces_no_event(self):
        pub, bus = _make_publisher()
        async with EventCapture(bus, ["ravn.*"]) as capture:
            await pub.on_ndjson_line({"type": "unknown_thing"})
            await bus.flush()

        assert len(capture.events) == 0


# ---------------------------------------------------------------------------
# Custom source identity
# ---------------------------------------------------------------------------


class TestRavnPublisherSource:
    async def test_default_source_uses_session_id(self):
        pub, bus = _make_publisher(session_id="my-session")
        async with EventCapture(bus, [RAVN_SESSION_START]) as capture:
            await pub.on_session_start()
            await bus.flush()

        assert capture.events[0].source == "ravn:my-session"

    async def test_custom_source_is_used(self):
        bus = InProcessBus()
        pub = RavnPublisher(bus, session_id="sess", source="custom-source")
        async with EventCapture(bus, [RAVN_SESSION_START]) as capture:
            await pub.on_session_start()
            await bus.flush()

        assert capture.events[0].source == "custom-source"


# ---------------------------------------------------------------------------
# Fault tolerance
# ---------------------------------------------------------------------------


class TestRavnPublisherFaultTolerance:
    async def test_publish_error_is_swallowed(self):
        publisher = AsyncMock()
        publisher.publish.side_effect = RuntimeError("broker down")
        pub = RavnPublisher(publisher, session_id="sess-x")
        await pub.on_session_start()  # must not raise
