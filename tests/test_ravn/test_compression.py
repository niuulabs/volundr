"""Tests for ContextCompressor and CompressionResult (ravn.compression)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from ravn.compression import (
    CompressionResult,
    ContextCompressor,
    _extract_content_text,
    _format_transcript,
)
from ravn.domain.models import LLMResponse, Message, StopReason, TokenUsage
from ravn.ports.llm import LLMPort

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_llm(summary_text: str = "Summary of conversation.") -> LLMPort:
    llm = MagicMock(spec=LLMPort)
    llm.generate = AsyncMock(
        return_value=LLMResponse(
            content=summary_text,
            tool_calls=[],
            stop_reason=StopReason.END_TURN,
            usage=TokenUsage(input_tokens=10, output_tokens=20),
        )
    )
    return llm


def _make_messages(n: int, role_alternating: bool = True) -> list[Message]:
    """Return a list of n simple messages."""
    msgs = []
    for i in range(n):
        role = "user" if (i % 2 == 0 or not role_alternating) else "assistant"
        msgs.append(Message(role=role, content=f"Message {i}"))
    return msgs


def _char_count_for_tokens(tokens: int) -> int:
    """Return chars needed to produce roughly *tokens* tokens."""
    return tokens * 4


# ---------------------------------------------------------------------------
# CompressionResult
# ---------------------------------------------------------------------------


class TestCompressionResult:
    def test_was_compressed_true(self):
        r = CompressionResult(original_count=10, final_count=5, compression_count=1)
        assert r.was_compressed is True

    def test_was_compressed_false(self):
        r = CompressionResult(original_count=10, final_count=10, compression_count=0)
        assert r.was_compressed is False

    def test_defaults(self):
        r = CompressionResult(original_count=5, final_count=5)
        assert r.compression_count == 0
        assert r.removed_message_count == 0


# ---------------------------------------------------------------------------
# ContextCompressor — basic behaviour
# ---------------------------------------------------------------------------


class TestContextCompressorNoCompression:
    @pytest.mark.asyncio
    async def test_below_threshold_no_compression(self):
        llm = _make_llm()
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=100_000,
            compression_threshold=0.5,
        )
        # Very short messages → well below 50 000 tokens
        msgs = _make_messages(4)
        result_msgs, result = await compressor.maybe_compress(msgs)
        assert result_msgs is msgs
        assert not result.was_compressed
        assert result.original_count == 4
        assert result.final_count == 4

    @pytest.mark.asyncio
    async def test_system_tokens_counted(self):
        llm = _make_llm()
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=20,
            compression_threshold=0.5,  # 10 token threshold
        )
        # 3 messages × ~1 char per token ≈ 3 tokens; system_tokens=0 → no compress
        msgs = [Message(role="user", content="x" * 4)]  # ~1 token
        result_msgs, result = await compressor.maybe_compress(msgs, system_tokens=0)
        assert not result.was_compressed


class TestContextCompressorCompression:
    @pytest.mark.asyncio
    async def test_compresses_when_over_threshold(self):
        llm = _make_llm("Short summary.")
        context_window = 200
        threshold = 0.5  # 100 tokens
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=context_window,
            compression_threshold=threshold,
            protect_first=1,
            protect_last=1,
        )
        # Build messages that collectively exceed 100 tokens (400 chars)
        long_content = "x" * 160  # 40 tokens each
        msgs = [
            Message(role="user", content=long_content),
            Message(role="assistant", content=long_content),
            Message(role="user", content=long_content),
            Message(role="assistant", content=long_content),
        ]
        result_msgs, result = await compressor.maybe_compress(msgs)
        assert result.was_compressed
        assert result.compression_count >= 1
        # Protected first (1) + summary (1) + protected last (1) = 3 messages
        assert len(result_msgs) < len(msgs)
        # Summary message should contain the placeholder text
        assert any("[Conversation summary:" in str(m.content) for m in result_msgs)

    @pytest.mark.asyncio
    async def test_protects_first_and_last(self):
        llm = _make_llm("Summary.")
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=100,
            compression_threshold=0.1,  # Very low to always trigger
            protect_first=2,
            protect_last=2,
        )
        msgs = [
            Message(role="user", content="First 1"),
            Message(role="assistant", content="First 2"),
            Message(role="user", content="Middle A " * 30),
            Message(role="assistant", content="Middle B " * 30),
            Message(role="user", content="Last 1"),
            Message(role="assistant", content="Last 2"),
        ]
        result_msgs, _ = await compressor.maybe_compress(msgs)
        # First two messages preserved
        assert result_msgs[0].content == "First 1"
        assert result_msgs[1].content == "First 2"
        # Last two messages preserved
        assert result_msgs[-1].content == "Last 2"
        assert result_msgs[-2].content == "Last 1"

    @pytest.mark.asyncio
    async def test_no_compression_when_protected_zone_covers_all(self):
        """When protect_first + protect_last >= total messages, no middle to compress."""
        llm = _make_llm()
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=10,
            compression_threshold=0.01,  # Always triggers
            protect_first=3,
            protect_last=3,
        )
        msgs = _make_messages(4)  # Only 4 messages; protected zones overlap
        result_msgs, result = await compressor.maybe_compress(msgs)
        # No compression possible
        assert result.removed_message_count == 0

    @pytest.mark.asyncio
    async def test_compression_count_increments(self):
        llm = _make_llm("Summary.")
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=50,
            compression_threshold=0.1,  # Always triggers
            protect_first=1,
            protect_last=1,
        )
        # Build enough messages to trigger multiple compression passes
        msgs = []
        for i in range(20):
            msgs.append(Message(role="user", content="x" * 16))  # 4 tokens each
        result_msgs, result = await compressor.maybe_compress(msgs)
        assert result.compression_count >= 1

    @pytest.mark.asyncio
    async def test_llm_failure_falls_back_to_placeholder(self):
        llm = MagicMock(spec=LLMPort)
        llm.generate = AsyncMock(side_effect=RuntimeError("API error"))
        compressor = ContextCompressor(
            llm,
            model="claude-sonnet-4-6",
            context_window=20,
            compression_threshold=0.1,
            protect_first=1,
            protect_last=1,
        )
        # Need at least 2 compressible middle messages so removed >= 1
        msgs = [
            Message(role="user", content="x" * 40),  # protected head
            Message(role="assistant", content="x" * 40),  # middle 1
            Message(role="user", content="x" * 40),  # middle 2
            Message(role="assistant", content="x" * 40),  # protected tail
        ]
        result_msgs, result = await compressor.maybe_compress(msgs)
        # Should still compress; summary = "[summary unavailable]"
        assert result.was_compressed
        summary_msg = result_msgs[1]  # protected(1) + summary + protected(1)
        assert "summary unavailable" in str(summary_msg.content)


class TestContextCompressorContextWindowLookup:
    def test_known_model_context_window(self):
        llm = _make_llm()
        c = ContextCompressor(llm, model="claude-sonnet-4-6")
        assert c._context_window == 200_000

    def test_unknown_model_uses_default(self):
        llm = _make_llm()
        c = ContextCompressor(llm, model="gpt-unknown")
        assert c._context_window == 200_000

    def test_explicit_context_window_override(self):
        llm = _make_llm()
        c = ContextCompressor(llm, model="claude-sonnet-4-6", context_window=50_000)
        assert c._context_window == 50_000


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


class TestExtractContentText:
    def test_string_passthrough(self):
        assert _extract_content_text("hello") == "hello"

    def test_text_block(self):
        content = [{"type": "text", "text": "block text"}]
        assert "block text" in _extract_content_text(content)

    def test_tool_use_block(self):
        content = [{"type": "tool_use", "name": "bash", "input": {"cmd": "ls"}}]
        result = _extract_content_text(content)
        assert "tool_call:bash" in result

    def test_tool_result_block(self):
        content = [{"type": "tool_result", "content": "output"}]
        result = _extract_content_text(content)
        assert "output" in result

    def test_unknown_block_ignored(self):
        content = [{"type": "mystery", "data": "stuff"}]
        result = _extract_content_text(content)
        assert result == ""

    def test_non_dict_ignored(self):
        assert _extract_content_text(["not_a_dict"]) == ""  # type: ignore[arg-type]


class TestFormatTranscript:
    def test_basic(self):
        msgs = [
            Message(role="user", content="Hello"),
            Message(role="assistant", content="Hi"),
        ]
        transcript = _format_transcript(msgs)
        assert "USER: Hello" in transcript
        assert "ASSISTANT: Hi" in transcript

    def test_empty_messages_excluded(self):
        msgs = [
            Message(role="user", content=""),
            Message(role="assistant", content="Response"),
        ]
        transcript = _format_transcript(msgs)
        assert "USER:" not in transcript
        assert "ASSISTANT: Response" in transcript

    def test_list_content_extracted(self):
        content = [{"type": "text", "text": "tool output"}]
        msgs = [Message(role="user", content=content)]
        transcript = _format_transcript(msgs)
        assert "tool output" in transcript
