"""Unit tests for AnthropicAdapter."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from ravn.adapters.anthropic_adapter import (
    ANTHROPIC_API_VERSION,
    ANTHROPIC_BETA_HEADER,
    AnthropicAdapter,
)
from ravn.domain.exceptions import LLMError
from ravn.domain.models import StopReason, StreamEventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter(**kwargs) -> AnthropicAdapter:
    defaults = {
        "api_key": "test-key",
        "base_url": "https://api.anthropic.com",
        "model": "claude-test",
        "max_tokens": 1024,
        "max_retries": 0,
        "retry_base_delay": 0.0,
        "timeout": 5.0,
    }
    defaults.update(kwargs)
    return AnthropicAdapter(**defaults)


def _sse(event_data: dict) -> str:
    return f"data: {json.dumps(event_data)}\n\n"


def _sse_done() -> str:
    return "data: [DONE]\n\n"


def _text_response_sse(text: str = "Hello!") -> str:
    block_start = {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "text", "text": ""},
    }
    block_delta = {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "text_delta", "text": text},
    }
    msg_done = {
        "type": "message_delta",
        "delta": {"stop_reason": "end_turn"},
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }
    return (
        _sse(block_start)
        + _sse(block_delta)
        + _sse({"type": "content_block_stop", "index": 0})
        + _sse(msg_done)
        + _sse_done()
    )


def _tool_call_sse(
    tool_name: str = "echo",
    tool_id: str = "tc_1",
    tool_input: dict | None = None,
) -> str:
    raw_input = json.dumps(tool_input or {})
    block_start = {
        "type": "content_block_start",
        "index": 0,
        "content_block": {"type": "tool_use", "id": tool_id, "name": tool_name},
    }
    block_delta = {
        "type": "content_block_delta",
        "index": 0,
        "delta": {"type": "input_json_delta", "partial_json": raw_input},
    }
    msg_done = {
        "type": "message_delta",
        "delta": {"stop_reason": "tool_use"},
        "usage": {"input_tokens": 20, "output_tokens": 10},
    }
    return (
        _sse(block_start)
        + _sse(block_delta)
        + _sse({"type": "content_block_stop", "index": 0})
        + _sse(msg_done)
        + _sse_done()
    )


# ---------------------------------------------------------------------------
# Constructor & headers
# ---------------------------------------------------------------------------


class TestConstruction:
    def test_defaults(self) -> None:
        adapter = AnthropicAdapter(api_key="key")
        assert adapter._api_key == "key"
        assert "api.anthropic.com" in adapter._base_url

    def test_custom_base_url_stripped(self) -> None:
        adapter = AnthropicAdapter(api_key="k", base_url="https://proxy.example.com/")
        assert not adapter._base_url.endswith("/")

    def test_headers_include_api_key(self) -> None:
        adapter = _make_adapter(api_key="sk-test")
        headers = adapter._headers()
        assert headers["x-api-key"] == "sk-test"
        assert headers["anthropic-version"] == ANTHROPIC_API_VERSION
        assert headers["anthropic-beta"] == ANTHROPIC_BETA_HEADER

    def test_build_system_empty(self) -> None:
        adapter = _make_adapter()
        assert adapter._build_system("") == []

    def test_build_system_non_empty(self) -> None:
        adapter = _make_adapter()
        result = adapter._build_system("You are helpful.")
        assert len(result) == 1
        assert result[0]["type"] == "text"
        assert result[0]["text"] == "You are helpful."
        assert result[0]["cache_control"] == {"type": "ephemeral"}


class TestBuildRequest:
    def test_request_structure(self) -> None:
        adapter = _make_adapter(model="claude-fast", max_tokens=512)
        body = adapter._build_request(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="sys",
            model="claude-fast",
            max_tokens=512,
            stream=False,
        )
        assert body["model"] == "claude-fast"
        assert body["max_tokens"] == 512
        assert body["messages"] == [{"role": "user", "content": "hi"}]
        assert not body["stream"]
        assert "system" in body

    def test_tools_included_when_provided(self) -> None:
        adapter = _make_adapter()
        tools = [{"name": "search", "description": "Search", "input_schema": {"type": "object"}}]
        body = adapter._build_request(
            [], tools=tools, system="", model="m", max_tokens=100, stream=False
        )
        assert body["tools"] == tools

    def test_empty_tools_excluded(self) -> None:
        adapter = _make_adapter()
        body = adapter._build_request(
            [], tools=[], system="", model="m", max_tokens=100, stream=False
        )
        assert "tools" not in body

    def test_empty_system_excluded(self) -> None:
        adapter = _make_adapter()
        body = adapter._build_request(
            [], tools=[], system="", model="m", max_tokens=100, stream=False
        )
        assert "system" not in body


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


class TestStream:
    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_text_delta(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=_text_response_sse("Hello world").encode(),
                headers={"content-type": "text/event-stream"},
            )
        )
        adapter = _make_adapter()
        events = []
        async for ev in adapter.stream(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        ):
            events.append(ev)

        text_events = [e for e in events if e.type == StreamEventType.TEXT_DELTA]
        assert len(text_events) >= 1
        assert any("Hello world" in (e.text or "") for e in text_events)

    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_message_done_with_usage(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=_text_response_sse("hi").encode(),
                headers={"content-type": "text/event-stream"},
            )
        )
        adapter = _make_adapter()
        events = []
        async for ev in adapter.stream(
            [{"role": "user", "content": "ping"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        ):
            events.append(ev)

        done_events = [e for e in events if e.type == StreamEventType.MESSAGE_DONE]
        assert len(done_events) == 1
        assert done_events[0].usage is not None
        assert done_events[0].usage.input_tokens == 10
        assert done_events[0].usage.output_tokens == 5

    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_tool_call(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=_tool_call_sse("search", "tc_99", {"query": "hello"}).encode(),
                headers={"content-type": "text/event-stream"},
            )
        )
        adapter = _make_adapter()
        events = []
        async for ev in adapter.stream(
            [{"role": "user", "content": "search for hello"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        ):
            events.append(ev)

        tool_events = [e for e in events if e.type == StreamEventType.TOOL_CALL]
        assert len(tool_events) == 1
        assert tool_events[0].tool_call is not None
        assert tool_events[0].tool_call.name == "search"
        assert tool_events[0].tool_call.id == "tc_99"
        assert tool_events[0].tool_call.input == {"query": "hello"}

    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_non_200_raises(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(401, json={"error": "unauthorized"})
        )
        adapter = _make_adapter()
        with pytest.raises(LLMError, match="401"):
            async for _ in adapter.stream(
                [{"role": "user", "content": "hi"}],
                tools=[],
                system="",
                model="claude-test",
                max_tokens=100,
            ):
                pass

    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_invalid_json_lines_skipped(self) -> None:
        body = "data: not-json\n\ndata: [DONE]\n\n"
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={"content-type": "text/event-stream"},
            )
        )
        adapter = _make_adapter()
        events = []
        async for ev in adapter.stream(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        ):
            events.append(ev)
        # Should not raise — invalid lines are silently skipped
        assert isinstance(events, list)

    @pytest.mark.asyncio
    @respx.mock
    async def test_stream_non_data_lines_ignored(self) -> None:
        body = "event: message_start\ndata: [DONE]\n\n"
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                content=body.encode(),
                headers={"content-type": "text/event-stream"},
            )
        )
        adapter = _make_adapter()
        events = []
        async for ev in adapter.stream(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        ):
            events.append(ev)
        # Should complete without error
        assert isinstance(events, list)


# ---------------------------------------------------------------------------
# Generate (non-streaming)
# ---------------------------------------------------------------------------


class TestGenerate:
    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_text_response(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "42"}],
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 5, "output_tokens": 1},
                },
            )
        )
        adapter = _make_adapter()
        response = await adapter.generate(
            [{"role": "user", "content": "what is 6*7?"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.content == "42"
        assert response.stop_reason == StopReason.END_TURN
        assert response.usage.input_tokens == 5
        assert response.usage.output_tokens == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_tool_call_response(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "tc_1",
                            "name": "search",
                            "input": {"query": "python"},
                        }
                    ],
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 10, "output_tokens": 20},
                },
            )
        )
        adapter = _make_adapter()
        response = await adapter.generate(
            [{"role": "user", "content": "search python"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert len(response.tool_calls) == 1
        assert response.tool_calls[0].name == "search"
        assert response.tool_calls[0].id == "tc_1"
        assert response.tool_calls[0].input == {"query": "python"}
        assert response.stop_reason == StopReason.TOOL_USE

    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_non_200_raises(self) -> None:
        # 400 is not retryable — returned immediately, then generate() raises
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(400, json={"error": "bad request"})
        )
        adapter = _make_adapter()
        with pytest.raises(LLMError, match="400"):
            await adapter.generate(
                [{"role": "user", "content": "hi"}],
                tools=[],
                system="",
                model="claude-test",
                max_tokens=100,
            )

    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_unknown_stop_reason_defaults(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "done"}],
                    "stop_reason": "unknown_future_reason",
                    "usage": {"input_tokens": 1, "output_tokens": 1},
                },
            )
        )
        adapter = _make_adapter()
        response = await adapter.generate(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.stop_reason == StopReason.END_TURN

    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_mixed_content(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [
                        {"type": "text", "text": "I'll search for that."},
                        {
                            "type": "tool_use",
                            "id": "tc_2",
                            "name": "search",
                            "input": {},
                        },
                    ],
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 8, "output_tokens": 12},
                },
            )
        )
        adapter = _make_adapter()
        response = await adapter.generate(
            [{"role": "user", "content": "search"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.content == "I'll search for that."
        assert len(response.tool_calls) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_generate_cache_tokens_parsed(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "hi"}],
                    "stop_reason": "end_turn",
                    "usage": {
                        "input_tokens": 5,
                        "output_tokens": 2,
                        "cache_read_input_tokens": 100,
                        "cache_creation_input_tokens": 50,
                    },
                },
            )
        )
        adapter = _make_adapter()
        response = await adapter.generate(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.usage.cache_read_tokens == 100
        assert response.usage.cache_write_tokens == 50


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------


class TestRetry:
    @pytest.mark.asyncio
    @respx.mock
    async def test_retries_on_429(self) -> None:
        # First call: 429, second: 200
        call_count = 0

        def side_effect(request):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return httpx.Response(429, json={"error": "rate limit"})
            return httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "ok"}],
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 1, "output_tokens": 1},
                },
            )

        respx.post("https://api.anthropic.com/v1/messages").mock(side_effect=side_effect)
        adapter = _make_adapter(max_retries=2, retry_base_delay=0.0)
        response = await adapter.generate(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.content == "ok"
        assert call_count == 2

    @pytest.mark.asyncio
    @respx.mock
    async def test_exhausted_retries_raises(self) -> None:
        respx.post("https://api.anthropic.com/v1/messages").mock(
            return_value=httpx.Response(503, json={"error": "unavailable"})
        )
        adapter = _make_adapter(max_retries=1, retry_base_delay=0.0)
        with pytest.raises(LLMError, match="failed after"):
            await adapter.generate(
                [{"role": "user", "content": "hi"}],
                tools=[],
                system="",
                model="claude-test",
                max_tokens=100,
            )

    @pytest.mark.asyncio
    @respx.mock
    async def test_transport_error_retried(self) -> None:
        call_count = 0

        def side_effect(request):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise httpx.ConnectError("connection refused")
            return httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "recovered"}],
                    "stop_reason": "end_turn",
                    "usage": {"input_tokens": 1, "output_tokens": 1},
                },
            )

        respx.post("https://api.anthropic.com/v1/messages").mock(side_effect=side_effect)
        adapter = _make_adapter(max_retries=2, retry_base_delay=0.0)
        response = await adapter.generate(
            [{"role": "user", "content": "hi"}],
            tools=[],
            system="",
            model="claude-test",
            max_tokens=100,
        )
        assert response.content == "recovered"
