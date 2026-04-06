"""Tests for FallbackLLMAdapter.

Coverage:
- Primary succeeds → used, no fallback attempted
- Primary fails (429) → fallback used
- Primary fails (auth 401) → fallback used, warning logged
- All fail → AllProvidersExhaustedError raised
- Next turn → primary attempted again (restoration — no sticky state)
- Transparent to caller (same LLMPort interface)
- generate() and stream() both exercise the fallback path
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest

from ravn.adapters.llm.fallback import FallbackLLMAdapter
from ravn.domain.exceptions import AllProvidersExhaustedError, LLMError
from ravn.domain.models import (
    LLMResponse,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
    ToolCall,
)
from ravn.ports.llm import LLMPort

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

_USAGE = TokenUsage(input_tokens=10, output_tokens=5)
_MESSAGES = [{"role": "user", "content": "hello"}]
_KWARGS = dict(tools=[], system="sys", model="m", max_tokens=100)


def _ok_response(text: str = "OK") -> LLMResponse:
    return LLMResponse(
        content=text,
        tool_calls=[],
        stop_reason=StopReason.END_TURN,
        usage=_USAGE,
    )


def _make_llm(*, raises: Exception | None = None, text: str = "OK") -> LLMPort:
    """Build a mock LLMPort that either succeeds or raises on every call."""
    llm = MagicMock(spec=LLMPort)

    if raises is not None:
        llm.generate = AsyncMock(side_effect=raises)

        async def _failing_stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            raise raises  # type: ignore[misc]
            yield  # make it a generator

        llm.stream = _failing_stream
    else:
        llm.generate = AsyncMock(return_value=_ok_response(text))

        async def _ok_stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
            yield StreamEvent(type=StreamEventType.TEXT_DELTA, text=text)
            yield StreamEvent(type=StreamEventType.MESSAGE_DONE, usage=_USAGE)

        llm.stream = _ok_stream

    return llm


async def _collect_stream(adapter: FallbackLLMAdapter) -> list[StreamEvent]:
    """Collect all events from adapter.stream()."""
    events: list[StreamEvent] = []
    async for event in adapter.stream(_MESSAGES, **_KWARGS):
        events.append(event)
    return events


# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------


class TestFallbackLLMAdapterInit:
    def test_requires_at_least_one_provider(self) -> None:
        with pytest.raises(ValueError, match="at least one provider"):
            FallbackLLMAdapter([])

    def test_provider_count(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm(), _make_llm()])
        assert adapter.provider_count == 2

    def test_implements_llm_port(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm()])
        assert isinstance(adapter, LLMPort)


# ---------------------------------------------------------------------------
# generate() — fallback chain
# ---------------------------------------------------------------------------


class TestFallbackLLMGenerate:
    async def test_primary_succeeds_is_used(self) -> None:
        primary = _make_llm(text="from primary")
        fallback = _make_llm(text="from fallback")
        adapter = FallbackLLMAdapter([primary, fallback])

        response = await adapter.generate(_MESSAGES, **_KWARGS)

        assert response.content == "from primary"
        fallback.generate.assert_not_called()

    async def test_primary_fails_429_fallback_used(self) -> None:
        primary = _make_llm(raises=LLMError("rate limited", status_code=429))
        fallback = _make_llm(text="from fallback")
        adapter = FallbackLLMAdapter([primary, fallback])

        response = await adapter.generate(_MESSAGES, **_KWARGS)

        assert response.content == "from fallback"

    async def test_primary_fails_401_fallback_used(self) -> None:
        primary = _make_llm(raises=LLMError("unauthorised", status_code=401))
        fallback = _make_llm(text="auth fallback")
        adapter = FallbackLLMAdapter([primary, fallback])

        response = await adapter.generate(_MESSAGES, **_KWARGS)

        assert response.content == "auth fallback"

    async def test_primary_fails_warning_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        primary = _make_llm(raises=LLMError("upstream error", status_code=500))
        fallback = _make_llm()
        adapter = FallbackLLMAdapter([primary, fallback])

        with caplog.at_level(logging.WARNING, logger="ravn.adapters.llm.fallback"):
            await adapter.generate(_MESSAGES, **_KWARGS)

        assert any("primary" in record.message for record in caplog.records)

    async def test_all_fail_raises_all_providers_exhausted(self) -> None:
        err = LLMError("gone", status_code=503)
        adapter = FallbackLLMAdapter([_make_llm(raises=err), _make_llm(raises=err)])

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            await adapter.generate(_MESSAGES, **_KWARGS)

        assert exc_info.value.provider_count == 2

    async def test_all_providers_exhausted_has_last_error(self) -> None:
        last_err = LLMError("final failure", status_code=503)
        adapter = FallbackLLMAdapter(
            [
                _make_llm(raises=LLMError("first", status_code=429)),
                _make_llm(raises=last_err),
            ]
        )

        with pytest.raises(AllProvidersExhaustedError) as exc_info:
            await adapter.generate(_MESSAGES, **_KWARGS)

        assert exc_info.value.last_error is last_err

    async def test_restoration_primary_tried_on_next_call(self) -> None:
        """After a failure, the next call starts from the primary again."""
        call_count = {"primary": 0, "fallback": 0}

        primary_llm = MagicMock(spec=LLMPort)
        fallback_llm = MagicMock(spec=LLMPort)

        # First call: primary fails
        async def _primary_generate_first_fail(*args, **kwargs):
            call_count["primary"] += 1
            if call_count["primary"] == 1:
                raise LLMError("first call fails", status_code=429)
            return _ok_response("primary restored")

        fallback_llm.generate = AsyncMock(return_value=_ok_response("fallback"))
        primary_llm.generate = _primary_generate_first_fail

        adapter = FallbackLLMAdapter([primary_llm, fallback_llm])

        # First call: primary fails → fallback used.
        r1 = await adapter.generate(_MESSAGES, **_KWARGS)
        assert r1.content == "fallback"
        assert call_count["primary"] == 1

        # Second call: primary is tried again (restoration).
        r2 = await adapter.generate(_MESSAGES, **_KWARGS)
        assert r2.content == "primary restored"
        assert call_count["primary"] == 2

    async def test_three_providers_second_fallback_used(self) -> None:
        err = LLMError("fail", status_code=500)
        p1 = _make_llm(raises=err)
        p2 = _make_llm(raises=err)
        p3 = _make_llm(text="third")
        adapter = FallbackLLMAdapter([p1, p2, p3])

        response = await adapter.generate(_MESSAGES, **_KWARGS)
        assert response.content == "third"

    async def test_single_provider_raises_on_failure(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm(raises=LLMError("oops", status_code=500))])

        with pytest.raises(AllProvidersExhaustedError):
            await adapter.generate(_MESSAGES, **_KWARGS)


# ---------------------------------------------------------------------------
# stream() — fallback chain
# ---------------------------------------------------------------------------


class TestFallbackLLMStream:
    async def test_primary_stream_succeeds(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm(text="streamed")])
        events = await _collect_stream(adapter)

        text_events = [e for e in events if e.type == StreamEventType.TEXT_DELTA]
        assert len(text_events) == 1
        assert text_events[0].text == "streamed"

    async def test_primary_stream_fails_fallback_used(self) -> None:
        primary = _make_llm(raises=LLMError("stream error", status_code=429))
        fallback = _make_llm(text="fallback stream")
        adapter = FallbackLLMAdapter([primary, fallback])

        events = await _collect_stream(adapter)

        text_events = [e for e in events if e.type == StreamEventType.TEXT_DELTA]
        assert any(e.text == "fallback stream" for e in text_events)

    async def test_all_streams_fail_raises(self) -> None:
        err = LLMError("stream gone", status_code=503)
        adapter = FallbackLLMAdapter([_make_llm(raises=err), _make_llm(raises=err)])

        with pytest.raises(AllProvidersExhaustedError):
            await _collect_stream(adapter)

    async def test_stream_message_done_event_present(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm(text="hello")])
        events = await _collect_stream(adapter)

        done_events = [e for e in events if e.type == StreamEventType.MESSAGE_DONE]
        assert len(done_events) == 1
        assert done_events[0].usage is not None

    async def test_stream_fallback_warning_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        primary = _make_llm(raises=LLMError("503", status_code=503))
        fallback = _make_llm(text="ok")
        adapter = FallbackLLMAdapter([primary, fallback])

        with caplog.at_level(logging.WARNING, logger="ravn.adapters.llm.fallback"):
            await _collect_stream(adapter)

        assert any("primary" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Transparency — same LLMPort interface
# ---------------------------------------------------------------------------


class TestFallbackLLMTransparency:
    async def test_generate_returns_llm_response(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm()])
        result = await adapter.generate(_MESSAGES, **_KWARGS)
        assert isinstance(result, LLMResponse)

    async def test_stream_yields_stream_events(self) -> None:
        adapter = FallbackLLMAdapter([_make_llm()])
        events = await _collect_stream(adapter)
        for event in events:
            assert isinstance(event, StreamEvent)

    async def test_tool_calls_pass_through(self) -> None:
        tc = ToolCall(id="call-1", name="my_tool", input={"x": 1})
        llm = MagicMock(spec=LLMPort)
        llm.generate = AsyncMock(
            return_value=LLMResponse(
                content="",
                tool_calls=[tc],
                stop_reason=StopReason.TOOL_USE,
                usage=_USAGE,
            )
        )
        adapter = FallbackLLMAdapter([llm])
        result = await adapter.generate(_MESSAGES, **_KWARGS)
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0].name == "my_tool"
