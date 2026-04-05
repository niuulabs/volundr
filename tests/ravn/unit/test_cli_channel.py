"""Unit tests for CliChannel and _format_input."""

from __future__ import annotations

import io

import pytest

from ravn.adapters.cli_channel import CliChannel, _format_input
from ravn.domain.events import RavnEvent, RavnEventType


def _channel() -> tuple[CliChannel, io.StringIO]:
    buf = io.StringIO()
    return CliChannel(file=buf), buf


class TestThoughtEvent:
    @pytest.mark.asyncio
    async def test_thought_writes_inline(self) -> None:
        ch, buf = _channel()
        await ch.emit(RavnEvent(type=RavnEventType.THOUGHT, data="hello"))
        assert buf.getvalue() == "hello"
        assert ch._in_response is True

    @pytest.mark.asyncio
    async def test_multiple_thoughts_concatenate(self) -> None:
        ch, buf = _channel()
        await ch.emit(RavnEvent(type=RavnEventType.THOUGHT, data="foo"))
        await ch.emit(RavnEvent(type=RavnEventType.THOUGHT, data="bar"))
        assert buf.getvalue() == "foobar"


class TestResponseEvent:
    @pytest.mark.asyncio
    async def test_response_when_in_response_prints_newline(self) -> None:
        ch, buf = _channel()
        # Put channel into in_response state via a THOUGHT event
        await ch.emit(RavnEvent(type=RavnEventType.THOUGHT, data="thinking..."))
        assert ch._in_response is True

        await ch.emit(RavnEvent(type=RavnEventType.RESPONSE, data="done"))
        assert ch._in_response is False
        assert buf.getvalue().endswith("\n")

    @pytest.mark.asyncio
    async def test_response_when_not_in_response_no_extra_newline(self) -> None:
        ch, buf = _channel()
        assert ch._in_response is False
        before = buf.getvalue()
        await ch.emit(RavnEvent(type=RavnEventType.RESPONSE, data="done"))
        # No change — not in_response so nothing printed
        assert buf.getvalue() == before


class TestToolStartEvent:
    @pytest.mark.asyncio
    async def test_tool_start_basic(self) -> None:
        ch, buf = _channel()
        await ch.emit(
            RavnEvent(
                type=RavnEventType.TOOL_START,
                data="read_file",
                metadata={"input": {"path": "/tmp/x.txt"}},
            )
        )
        output = buf.getvalue()
        assert "read_file" in output
        assert "path=" in output

    @pytest.mark.asyncio
    async def test_tool_start_when_in_response_flushes_newline(self) -> None:
        ch, buf = _channel()
        await ch.emit(RavnEvent(type=RavnEventType.THOUGHT, data="thinking"))
        assert ch._in_response is True

        await ch.emit(
            RavnEvent(
                type=RavnEventType.TOOL_START,
                data="write_file",
                metadata={"input": {}},
            )
        )
        assert ch._in_response is False
        output = buf.getvalue()
        # The newline flush from in_response=True should be present
        assert "\n" in output
        assert "write_file" in output

    @pytest.mark.asyncio
    async def test_tool_start_no_input(self) -> None:
        ch, buf = _channel()
        await ch.emit(
            RavnEvent(
                type=RavnEventType.TOOL_START,
                data="list_files",
                metadata={"input": {}},
            )
        )
        output = buf.getvalue()
        assert "list_files()" in output


class TestToolResultEvent:
    @pytest.mark.asyncio
    async def test_tool_result_success(self) -> None:
        ch, buf = _channel()
        await ch.emit(
            RavnEvent(
                type=RavnEventType.TOOL_RESULT,
                data="file content here",
                metadata={"tool_name": "read_file", "is_error": False},
            )
        )
        output = buf.getvalue()
        assert "✓" in output
        assert "read_file" in output
        assert "file content here" in output

    @pytest.mark.asyncio
    async def test_tool_result_error(self) -> None:
        ch, buf = _channel()
        await ch.emit(
            RavnEvent(
                type=RavnEventType.TOOL_RESULT,
                data="permission denied",
                metadata={"tool_name": "write_file", "is_error": True},
            )
        )
        output = buf.getvalue()
        assert "✗" in output
        assert "permission denied" in output

    @pytest.mark.asyncio
    async def test_tool_result_truncates_long_content(self) -> None:
        # Use a short truncation limit to trigger truncation
        buf = io.StringIO()
        ch_small = CliChannel(file=buf, result_truncation_limit=10)
        long_content = "x" * 200
        await ch_small.emit(
            RavnEvent(
                type=RavnEventType.TOOL_RESULT,
                data=long_content,
                metadata={"tool_name": "t", "is_error": False},
            )
        )
        output = buf.getvalue()
        assert "…" in output
        # Truncated to 10 chars + "…"
        assert len(output) < len(long_content)


class TestErrorEvent:
    @pytest.mark.asyncio
    async def test_error_event_printed(self) -> None:
        ch, buf = _channel()
        await ch.emit(RavnEvent(type=RavnEventType.ERROR, data="something went wrong"))
        output = buf.getvalue()
        assert "[error]" in output
        assert "something went wrong" in output


class TestFinish:
    def test_finish_when_in_response_prints_newline(self) -> None:
        ch, buf = _channel()
        ch._in_response = True
        ch.finish()
        assert buf.getvalue() == "\n"
        assert ch._in_response is False

    def test_finish_when_not_in_response_no_output(self) -> None:
        ch, buf = _channel()
        ch.finish()
        assert buf.getvalue() == ""


class TestFormatInput:
    def test_empty_dict_returns_empty(self) -> None:
        assert _format_input({}) == ""

    def test_single_key(self) -> None:
        result = _format_input({"path": "/tmp/x"})
        assert "path=" in result
        assert "/tmp/x" in result

    def test_multiple_keys_joined_by_comma(self) -> None:
        result = _format_input({"a": "1", "b": "2"})
        assert ", " in result

    def test_long_value_truncated(self) -> None:
        long_val = "x" * 200
        result = _format_input({"key": long_val}, value_limit=10)
        assert "…" in result
        # key='' prefix + 10 chars + "…"
        assert result.count("…") == 1

    def test_short_value_not_truncated(self) -> None:
        result = _format_input({"key": "short"}, value_limit=100)
        assert "…" not in result
        assert "short" in result
