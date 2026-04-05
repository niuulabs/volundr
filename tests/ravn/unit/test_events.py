"""Unit tests for Ravn domain events."""

from __future__ import annotations

import pytest

from ravn.domain.events import RavnEvent, RavnEventType


class TestRavnEventType:
    def test_string_values(self) -> None:
        assert RavnEventType.THOUGHT == "thought"
        assert RavnEventType.TOOL_START == "tool_start"
        assert RavnEventType.TOOL_RESULT == "tool_result"
        assert RavnEventType.RESPONSE == "response"
        assert RavnEventType.ERROR == "error"


class TestRavnEventConstruction:
    def test_direct_construction(self) -> None:
        ev = RavnEvent(type=RavnEventType.RESPONSE, data="hi")
        assert ev.type == RavnEventType.RESPONSE
        assert ev.data == "hi"
        assert ev.metadata == {}

    def test_thought_factory(self) -> None:
        ev = RavnEvent.thought("I am thinking")
        assert ev.type == RavnEventType.THOUGHT
        assert ev.data == "I am thinking"
        assert ev.metadata == {}

    def test_tool_start_factory(self) -> None:
        ev = RavnEvent.tool_start("search", {"query": "hello"})
        assert ev.type == RavnEventType.TOOL_START
        assert ev.data == "search"
        assert ev.metadata["input"] == {"query": "hello"}

    def test_tool_start_empty_input(self) -> None:
        ev = RavnEvent.tool_start("no_args", {})
        assert ev.metadata["input"] == {}

    def test_tool_result_success(self) -> None:
        ev = RavnEvent.tool_result("search", "result text")
        assert ev.type == RavnEventType.TOOL_RESULT
        assert ev.data == "result text"
        assert ev.metadata["tool_name"] == "search"
        assert ev.metadata["is_error"] is False

    def test_tool_result_error(self) -> None:
        ev = RavnEvent.tool_result("search", "failed", is_error=True)
        assert ev.metadata["is_error"] is True

    def test_response_factory(self) -> None:
        ev = RavnEvent.response("Final answer")
        assert ev.type == RavnEventType.RESPONSE
        assert ev.data == "Final answer"

    def test_error_factory(self) -> None:
        ev = RavnEvent.error("something broke")
        assert ev.type == RavnEventType.ERROR
        assert ev.data == "something broke"

    def test_is_frozen(self) -> None:
        ev = RavnEvent.thought("test")
        with pytest.raises(Exception):
            ev.data = "other"  # type: ignore[misc]

    def test_metadata_independent_per_instance(self) -> None:
        ev1 = RavnEvent.tool_start("t1", {"a": 1})
        ev2 = RavnEvent.tool_start("t2", {"b": 2})
        assert ev1.metadata["input"] != ev2.metadata["input"]
