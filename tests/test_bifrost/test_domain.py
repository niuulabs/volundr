"""Tests for Bifrost domain models."""

from __future__ import annotations

from datetime import UTC, datetime

from bifrost.domain.models import ModelInfo, RequestLog, TokenUsage


class TestTokenUsage:
    def test_default_values(self) -> None:
        usage = TokenUsage()
        assert usage.input_tokens == 0
        assert usage.output_tokens == 0
        assert usage.cache_creation_input_tokens == 0
        assert usage.cache_read_input_tokens == 0

    def test_custom_values(self) -> None:
        usage = TokenUsage(
            input_tokens=10,
            output_tokens=5,
            cache_creation_input_tokens=2,
            cache_read_input_tokens=3,
        )
        assert usage.input_tokens == 10
        assert usage.output_tokens == 5
        assert usage.cache_creation_input_tokens == 2
        assert usage.cache_read_input_tokens == 3


class TestModelInfo:
    def test_fields(self) -> None:
        model = ModelInfo(id="claude-sonnet-4-6", display_name="Claude Sonnet 4.6")
        assert model.id == "claude-sonnet-4-6"
        assert model.display_name == "Claude Sonnet 4.6"


class TestRequestLog:
    def test_default_values(self) -> None:
        log = RequestLog(timestamp=datetime.now(UTC), model="claude-sonnet-4-6")
        assert log.latency_ms == 0.0
        assert log.stream is False
        assert isinstance(log.usage, TokenUsage)

    def test_all_fields(self) -> None:
        ts = datetime.now(UTC)
        usage = TokenUsage(input_tokens=10, output_tokens=5)
        log = RequestLog(
            timestamp=ts,
            model="claude-opus-4-6",
            usage=usage,
            latency_ms=42.5,
            stream=True,
        )
        assert log.timestamp == ts
        assert log.model == "claude-opus-4-6"
        assert log.usage.input_tokens == 10
        assert log.latency_ms == 42.5
        assert log.stream is True
