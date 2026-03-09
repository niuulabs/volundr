"""Tests for the LiteLLM adapter (format translation only — no real API calls)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from volundr.bifrost.adapters.litellm_adapter import (
    LiteLLMAdapter,
    _anthropic_to_openai,
    _convert_tool,
    _openai_response_to_anthropic,
    _stream_to_anthropic_sse,
)
from volundr.bifrost.config import UpstreamAuthConfig, UpstreamEntryConfig


class TestAnthropicToOpenai:
    def test_simple_text_message(self):
        body = {
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "Hello"},
            ],
        }
        result = _anthropic_to_openai(body)

        assert result["model"] == "gpt-4o"
        assert len(result["messages"]) == 1
        assert result["messages"][0] == {"role": "user", "content": "Hello"}

    def test_system_prompt_becomes_system_message(self):
        body = {
            "model": "gpt-4o",
            "system": "You are helpful.",
            "messages": [
                {"role": "user", "content": "Hi"},
            ],
        }
        result = _anthropic_to_openai(body)

        assert result["messages"][0] == {
            "role": "system",
            "content": "You are helpful.",
        }
        assert result["messages"][1] == {"role": "user", "content": "Hi"}

    def test_system_prompt_as_list(self):
        body = {
            "model": "gpt-4o",
            "system": [
                {"type": "text", "text": "Part 1."},
                {"type": "text", "text": "Part 2."},
            ],
            "messages": [
                {"role": "user", "content": "Hi"},
            ],
        }
        result = _anthropic_to_openai(body)

        assert result["messages"][0]["content"] == "Part 1. Part 2."

    def test_content_blocks_with_text(self):
        body = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Hello"},
                        {"type": "text", "text": " world"},
                    ],
                },
            ],
        }
        result = _anthropic_to_openai(body)

        assert result["messages"][0]["content"] == "Hello\n world"

    def test_tool_use_in_assistant_message(self):
        body = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Let me check."},
                        {
                            "type": "tool_use",
                            "id": "tool_1",
                            "name": "bash",
                            "input": {"command": "ls"},
                        },
                    ],
                },
            ],
        }
        result = _anthropic_to_openai(body)

        msg = result["messages"][0]
        assert msg["role"] == "assistant"
        assert msg["content"] == "Let me check."
        assert len(msg["tool_calls"]) == 1
        assert msg["tool_calls"][0]["function"]["name"] == "bash"
        assert json.loads(msg["tool_calls"][0]["function"]["arguments"]) == {
            "command": "ls",
        }

    def test_tool_result_becomes_tool_message(self):
        body = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool_1",
                            "content": "file.txt",
                        },
                    ],
                },
            ],
        }
        result = _anthropic_to_openai(body)

        msg = result["messages"][0]
        assert msg["role"] == "tool"
        assert msg["tool_call_id"] == "tool_1"
        assert msg["content"] == "file.txt"

    def test_tool_result_with_list_content(self):
        body = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "tool_1",
                            "content": [
                                {"type": "text", "text": "line 1"},
                                {"type": "text", "text": "line 2"},
                            ],
                        },
                    ],
                },
            ],
        }
        result = _anthropic_to_openai(body)

        msg = result["messages"][0]
        assert msg["content"] == "line 1 line 2"

    def test_preserves_max_tokens(self):
        body = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1024,
        }
        result = _anthropic_to_openai(body)
        assert result["max_tokens"] == 1024

    def test_preserves_temperature(self):
        body = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "temperature": 0.7,
        }
        result = _anthropic_to_openai(body)
        assert result["temperature"] == 0.7

    def test_preserves_top_p(self):
        body = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "top_p": 0.9,
        }
        result = _anthropic_to_openai(body)
        assert result["top_p"] == 0.9

    def test_converts_tools(self):
        body = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [
                {
                    "name": "bash",
                    "description": "Run command",
                    "input_schema": {"type": "object"},
                }
            ],
        }
        result = _anthropic_to_openai(body)
        assert len(result["tools"]) == 1
        assert result["tools"][0]["type"] == "function"

    def test_empty_content_blocks(self):
        body = {
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": []}],
        }
        result = _anthropic_to_openai(body)
        # Should still produce a message
        assert len(result["messages"]) == 1
        assert result["messages"][0]["content"] == ""


class TestConvertTool:
    def test_converts_tool_definition(self):
        tool = {
            "name": "bash",
            "description": "Run a shell command",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                },
            },
        }
        result = _convert_tool(tool)

        assert result["type"] == "function"
        assert result["function"]["name"] == "bash"
        assert result["function"]["description"] == "Run a shell command"
        assert result["function"]["parameters"]["type"] == "object"


class TestOpenaiResponseToAnthropic:
    def test_text_response(self):
        class MockMessage:
            content = "Hello world"
            tool_calls = None

        class MockChoice:
            message = MockMessage()
            finish_reason = "stop"

        class MockUsage:
            prompt_tokens = 10
            completion_tokens = 5

        class MockResponse:
            id = "chatcmpl-123"
            choices = [MockChoice()]
            usage = MockUsage()

        result = _openai_response_to_anthropic(MockResponse(), "gpt-4o")

        assert result["type"] == "message"
        assert result["role"] == "assistant"
        assert result["model"] == "gpt-4o"
        assert result["stop_reason"] == "end_turn"
        assert result["content"][0]["type"] == "text"
        assert result["content"][0]["text"] == "Hello world"
        assert result["usage"]["input_tokens"] == 10
        assert result["usage"]["output_tokens"] == 5

    def test_tool_call_response(self):
        class MockFunction:
            name = "bash"
            arguments = '{"command": "ls"}'

        class MockToolCall:
            id = "call_1"
            function = MockFunction()

        class MockMessage:
            content = None
            tool_calls = [MockToolCall()]

        class MockChoice:
            message = MockMessage()
            finish_reason = "tool_calls"

        class MockUsage:
            prompt_tokens = 10
            completion_tokens = 5

        class MockResponse:
            id = "chatcmpl-123"
            choices = [MockChoice()]
            usage = MockUsage()

        result = _openai_response_to_anthropic(MockResponse(), "gpt-4o")

        assert result["stop_reason"] == "tool_use"
        tool_block = result["content"][0]
        assert tool_block["type"] == "tool_use"
        assert tool_block["name"] == "bash"
        assert tool_block["input"] == {"command": "ls"}

    def test_max_tokens_finish_reason(self):
        class MockMessage:
            content = "Partial..."
            tool_calls = None

        class MockChoice:
            message = MockMessage()
            finish_reason = "length"

        class MockUsage:
            prompt_tokens = 10
            completion_tokens = 100

        class MockResponse:
            id = "chatcmpl-123"
            choices = [MockChoice()]
            usage = MockUsage()

        result = _openai_response_to_anthropic(MockResponse(), "gpt-4o")
        assert result["stop_reason"] == "max_tokens"

    def test_empty_choices(self):
        class MockUsage:
            prompt_tokens = 0
            completion_tokens = 0

        class MockResponse:
            id = "chatcmpl-123"
            choices = []
            usage = MockUsage()

        result = _openai_response_to_anthropic(MockResponse(), "gpt-4o")
        assert result["content"][0]["type"] == "text"
        assert result["content"][0]["text"] == ""


_HAS_LITELLM_PATCH = "volundr.bifrost.adapters.litellm_adapter.HAS_LITELLM"


class TestLiteLLMAdapterConstruction:
    @patch(_HAS_LITELLM_PATCH, True)
    def test_creates_with_openai_url(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="https://api.openai.com",
            auth=UpstreamAuthConfig(mode="api_key", key="sk-test"),
        )
        adapter = LiteLLMAdapter(config)
        assert adapter._api_key == "sk-test"
        assert adapter._model_prefix == ""

    @patch(_HAS_LITELLM_PATCH, True)
    def test_creates_with_localhost_url(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="http://localhost:11434",
        )
        adapter = LiteLLMAdapter(config)
        assert adapter._model_prefix == "ollama/"

    @patch(_HAS_LITELLM_PATCH, True)
    def test_resolve_model_adds_prefix(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="http://localhost:11434",
        )
        adapter = LiteLLMAdapter(config)
        assert adapter._resolve_model("qwen3-coder") == "ollama/qwen3-coder"

    @patch(_HAS_LITELLM_PATCH, True)
    def test_resolve_model_no_double_prefix(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="http://localhost:11434",
        )
        adapter = LiteLLMAdapter(config)
        assert adapter._resolve_model("ollama/qwen3-coder") == "ollama/qwen3-coder"

    @patch(_HAS_LITELLM_PATCH, True)
    def test_no_api_key_when_passthrough(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="https://api.openai.com",
            auth=UpstreamAuthConfig(mode="passthrough"),
        )
        adapter = LiteLLMAdapter(config)
        assert adapter._api_key is None

    @patch(_HAS_LITELLM_PATCH, True)
    async def test_close_is_noop(self):
        config = UpstreamEntryConfig(
            adapter="litellm",
            url="https://api.openai.com",
        )
        adapter = LiteLLMAdapter(config)
        await adapter.close()  # Should not raise

    @patch(_HAS_LITELLM_PATCH, False)
    def test_raises_when_litellm_not_installed(self):
        config = UpstreamEntryConfig(adapter="litellm", url="https://api.openai.com")
        with pytest.raises(RuntimeError, match="litellm is not installed"):
            LiteLLMAdapter(config)


class TestLiteLLMAdapterForward:
    @pytest.fixture
    def adapter(self):
        with patch(_HAS_LITELLM_PATCH, True):
            config = UpstreamEntryConfig(
                adapter="litellm",
                url="https://api.openai.com",
                auth=UpstreamAuthConfig(mode="api_key", key="sk-test"),
            )
            return LiteLLMAdapter(config)

    async def test_forward_success(self, adapter):
        class MockMessage:
            content = "Hello!"
            tool_calls = None

        class MockChoice:
            message = MockMessage()
            finish_reason = "stop"

        class MockUsage:
            prompt_tokens = 10
            completion_tokens = 5

        mock_response = MagicMock()
        mock_response.choices = [MockChoice()]
        mock_response.usage = MockUsage()
        mock_response.id = "chatcmpl-123"

        body = json.dumps(
            {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "hi"}],
            }
        ).encode()

        with patch("volundr.bifrost.adapters.litellm_adapter.litellm", create=True) as mock_litellm:
            mock_litellm.acompletion = AsyncMock(return_value=mock_response)
            status, headers, resp_body = await adapter.forward(body, {})

        assert status == 200
        data = json.loads(resp_body)
        assert data["type"] == "message"
        assert data["content"][0]["text"] == "Hello!"

    async def test_forward_error(self, adapter):
        body = json.dumps(
            {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "hi"}],
            }
        ).encode()

        with patch("volundr.bifrost.adapters.litellm_adapter.litellm", create=True) as mock_litellm:
            mock_litellm.acompletion = AsyncMock(side_effect=RuntimeError("API error"))
            status, headers, resp_body = await adapter.forward(body, {})

        assert status == 502
        data = json.loads(resp_body)
        assert data["error"]["type"] == "upstream_error"

    async def test_stream_forward_error(self, adapter):
        body = json.dumps(
            {
                "model": "gpt-4o",
                "messages": [{"role": "user", "content": "hi"}],
                "stream": True,
            }
        ).encode()

        with patch("volundr.bifrost.adapters.litellm_adapter.litellm", create=True) as mock_litellm:
            mock_litellm.acompletion = AsyncMock(side_effect=RuntimeError("API error"))
            status, headers, chunk_iter = await adapter.stream_forward(body, {})

        assert status == 502
        chunks = []
        async for c in chunk_iter:
            chunks.append(c)
        data = json.loads(b"".join(chunks))
        assert data["error"]["type"] == "upstream_error"


class TestStreamToAnthropicSse:
    async def test_text_stream(self):
        """Test streaming translation of text-only response."""

        class MockDelta:
            content = "Hello"
            tool_calls = None

        class MockChoice:
            delta = MockDelta()
            finish_reason = None

        class MockFinishDelta:
            content = None
            tool_calls = None

        class MockFinishChoice:
            delta = MockFinishDelta()
            finish_reason = "stop"

        chunks = [
            MagicMock(choices=[MockChoice()], usage=None),
            MagicMock(choices=[MockFinishChoice()], usage=None),
        ]

        async def mock_response():
            for c in chunks:
                yield c

        events = []
        async for event in _stream_to_anthropic_sse(mock_response(), "gpt-4o"):
            events.append(event)

        combined = b"".join(events).decode()
        assert "message_start" in combined
        assert "content_block_start" in combined
        assert "text_delta" in combined
        assert "Hello" in combined
        assert "message_delta" in combined
        assert "message_stop" in combined
