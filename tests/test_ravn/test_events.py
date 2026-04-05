"""Tests for Ravn domain events."""

from __future__ import annotations

import pytest

from ravn.domain.events import RavnEvent, RavnEventType


class TestRavnEventType:
    def test_values(self) -> None:
        assert RavnEventType.THOUGHT == "thought"
        assert RavnEventType.TOOL_START == "tool_start"
        assert RavnEventType.TOOL_RESULT == "tool_result"
        assert RavnEventType.RESPONSE == "response"
        assert RavnEventType.ERROR == "error"

    def test_member_count(self) -> None:
        assert len(RavnEventType) == 5


class TestRavnEvent:
    def test_thought_factory(self) -> None:
        ev = RavnEvent.thought("thinking...")
        assert ev.type == RavnEventType.THOUGHT
        assert ev.data == "thinking..."
        assert ev.metadata == {}

    def test_tool_start_factory(self) -> None:
        ev = RavnEvent.tool_start("echo", {"message": "hi"})
        assert ev.type == RavnEventType.TOOL_START
        assert ev.data == "echo"
        assert ev.metadata == {"input": {"message": "hi"}}

    def test_tool_result_factory(self) -> None:
        ev = RavnEvent.tool_result("echo", "pong")
        assert ev.type == RavnEventType.TOOL_RESULT
        assert ev.data == "pong"
        assert ev.metadata["is_error"] is False
        assert ev.metadata["tool_name"] == "echo"

    def test_tool_result_error(self) -> None:
        ev = RavnEvent.tool_result("fail", "boom", is_error=True)
        assert ev.metadata["is_error"] is True

    def test_response_factory(self) -> None:
        ev = RavnEvent.response("Hello there!")
        assert ev.type == RavnEventType.RESPONSE
        assert ev.data == "Hello there!"

    def test_error_factory(self) -> None:
        ev = RavnEvent.error("something went wrong")
        assert ev.type == RavnEventType.ERROR
        assert ev.data == "something went wrong"

    def test_frozen(self) -> None:
        ev = RavnEvent.thought("test")
        with pytest.raises(Exception):
            ev.data = "other"  # type: ignore[misc]

    def test_default_metadata(self) -> None:
        ev = RavnEvent(type=RavnEventType.RESPONSE, data="hi")
        assert ev.metadata == {}
