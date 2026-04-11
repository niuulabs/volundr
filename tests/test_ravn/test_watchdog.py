"""Tests for NIU-510 — sub-agent stuck detection watchdog.

Coverage targets:
- WatchdogConfig defaults
- TaskWatchdog.record_event: timestamp reset, loop detection
- TaskWatchdog.run: clean completion, timeout, loop, budget (reserved)
- TaskWatchdog.run: retry strategy resets state and continues
- TaskWatchdog.run: abort/replan/escalate each exit after one detection
- WatchdogChannelWrapper: forwards events to inner channel and watchdog
- build_stuck_handler: all four strategies (retry, replan, escalate, abort)
- _emit_task_stuck_event: emits TASK_STUCK event with correct payload
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from ravn.cascade.watchdog import (
    StuckReason,
    TaskWatchdog,
    WatchdogChannelWrapper,
    WatchdogConfig,
    WatchdogOutcome,
    build_stuck_handler,
)
from ravn.domain.events import RavnEvent, RavnEventType

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tool_start_event(tool_name: str, tool_input: dict | None = None) -> RavnEvent:
    payload: dict = {"tool_name": tool_name, "input": tool_input or {}}
    return RavnEvent(
        type=RavnEventType.TOOL_START,
        source="test-agent",
        payload=payload,
        timestamp=MagicMock(),
        urgency=0.1,
        correlation_id="cid-1",
        session_id="sid-1",
        task_id="task_001",
    )


def _other_event(event_type: RavnEventType = RavnEventType.THOUGHT) -> RavnEvent:
    return RavnEvent(
        type=event_type,
        source="test-agent",
        payload={"text": "thinking"},
        timestamp=MagicMock(),
        urgency=0.1,
        correlation_id="cid-1",
        session_id="sid-1",
        task_id="task_001",
    )


def _fast_config(**kwargs) -> WatchdogConfig:
    """Return a WatchdogConfig with a tiny poll_interval for tests."""
    defaults = {"poll_interval_s": 0.01, "stuck_timeout_s": 0.05}
    defaults.update(kwargs)
    return WatchdogConfig(**defaults)


# ---------------------------------------------------------------------------
# WatchdogConfig
# ---------------------------------------------------------------------------


class TestWatchdogConfig:
    def test_defaults(self):
        cfg = WatchdogConfig()
        assert cfg.stuck_timeout_s == 60.0
        assert cfg.loop_detection_threshold == 3
        assert cfg.on_stuck == "replan"
        assert cfg.max_retries == 2
        assert cfg.poll_interval_s == 5.0

    def test_custom_values(self):
        cfg = WatchdogConfig(
            stuck_timeout_s=30.0,
            loop_detection_threshold=5,
            on_stuck="abort",
            max_retries=0,
            poll_interval_s=1.0,
        )
        assert cfg.stuck_timeout_s == 30.0
        assert cfg.loop_detection_threshold == 5
        assert cfg.on_stuck == "abort"
        assert cfg.max_retries == 0
        assert cfg.poll_interval_s == 1.0


# ---------------------------------------------------------------------------
# TaskWatchdog.record_event
# ---------------------------------------------------------------------------


class TestRecordEvent:
    def test_non_tool_start_resets_timestamp(self):
        watchdog = TaskWatchdog("task_001", WatchdogConfig())
        old_time = watchdog._last_event_at
        watchdog.record_event(_other_event())
        assert watchdog._last_event_at >= old_time

    def test_tool_start_resets_timestamp(self):
        watchdog = TaskWatchdog("task_001", WatchdogConfig())
        old_time = watchdog._last_event_at
        watchdog.record_event(_tool_start_event("my_tool"))
        assert watchdog._last_event_at >= old_time

    def test_no_loop_with_different_inputs(self):
        cfg = WatchdogConfig(loop_detection_threshold=3)
        watchdog = TaskWatchdog("task_001", cfg)
        watchdog.record_event(_tool_start_event("tool_a", {"x": 1}))
        watchdog.record_event(_tool_start_event("tool_a", {"x": 2}))
        watchdog.record_event(_tool_start_event("tool_a", {"x": 3}))
        assert not watchdog._loop_detected

    def test_loop_detected_same_tool_same_args(self):
        cfg = WatchdogConfig(loop_detection_threshold=3)
        watchdog = TaskWatchdog("task_001", cfg)
        ev = _tool_start_event("grep", {"pattern": "foo"})
        watchdog.record_event(ev)
        watchdog.record_event(ev)
        watchdog.record_event(ev)
        assert watchdog._loop_detected

    def test_loop_detection_threshold_2(self):
        cfg = WatchdogConfig(loop_detection_threshold=2)
        watchdog = TaskWatchdog("task_001", cfg)
        ev = _tool_start_event("grep", {"pattern": "foo"})
        watchdog.record_event(ev)
        assert not watchdog._loop_detected
        watchdog.record_event(ev)
        assert watchdog._loop_detected

    def test_loop_resets_after_different_tool(self):
        cfg = WatchdogConfig(loop_detection_threshold=3)
        watchdog = TaskWatchdog("task_001", cfg)
        ev = _tool_start_event("grep", {"pattern": "foo"})
        watchdog.record_event(ev)
        watchdog.record_event(ev)
        # Different tool breaks the streak
        watchdog.record_event(_tool_start_event("cat", {}))
        watchdog.record_event(ev)
        # Only 1 × grep at the end — not a loop
        assert not watchdog._loop_detected

    def test_non_tool_start_does_not_affect_loop_counter(self):
        cfg = WatchdogConfig(loop_detection_threshold=3)
        watchdog = TaskWatchdog("task_001", cfg)
        ev = _tool_start_event("grep", {"pattern": "foo"})
        watchdog.record_event(ev)
        watchdog.record_event(ev)
        # A THOUGHT event does not break the consecutive run
        watchdog.record_event(_other_event())
        # Still only 2 tool_start events in the deque — not a loop
        assert not watchdog._loop_detected

    def test_seconds_since_last_event(self):
        watchdog = TaskWatchdog("task_001", WatchdogConfig())
        elapsed = watchdog.seconds_since_last_event()
        assert elapsed >= 0.0


# ---------------------------------------------------------------------------
# TaskWatchdog.run — clean completion
# ---------------------------------------------------------------------------


class TestRunCleanCompletion:
    @pytest.mark.asyncio
    async def test_returns_no_reason_when_done_immediately(self):
        watchdog = TaskWatchdog("task_001", _fast_config())
        on_stuck = AsyncMock()

        outcome = await watchdog.run(is_done=lambda: True, on_stuck=on_stuck)

        assert outcome.reason is None
        assert outcome.action_taken is None
        assert outcome.retry_count == 0
        on_stuck.assert_not_called()

    @pytest.mark.asyncio
    async def test_returns_no_reason_when_done_after_one_poll(self):
        cfg = _fast_config()
        watchdog = TaskWatchdog("task_001", cfg)
        done_flag = {"v": False}

        async def complete_after_delay():
            await asyncio.sleep(cfg.poll_interval_s * 1.5)
            done_flag["v"] = True

        on_stuck = AsyncMock()

        # Inject events so timeout does not fire during the wait
        async def emit_events():
            for _ in range(10):
                watchdog.record_event(_other_event())
                await asyncio.sleep(cfg.poll_interval_s * 0.3)

        outcome, *_ = await asyncio.gather(
            watchdog.run(is_done=lambda: done_flag["v"], on_stuck=on_stuck),
            complete_after_delay(),
            emit_events(),
        )

        assert outcome.reason is None
        on_stuck.assert_not_called()


# ---------------------------------------------------------------------------
# TaskWatchdog.run — timeout detection
# ---------------------------------------------------------------------------


class TestRunTimeout:
    @pytest.mark.asyncio
    async def test_timeout_fires_when_no_events(self):
        cfg = _fast_config(stuck_timeout_s=0.02, on_stuck="abort")
        watchdog = TaskWatchdog("task_001", cfg)
        on_stuck = AsyncMock()

        outcome = await watchdog.run(is_done=lambda: False, on_stuck=on_stuck)

        assert outcome.reason == StuckReason.TIMEOUT
        assert outcome.action_taken == "abort"
        assert outcome.retry_count == 1
        on_stuck.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_timeout_reason_and_task_id_passed_to_callback(self):
        cfg = _fast_config(stuck_timeout_s=0.02, on_stuck="abort")
        watchdog = TaskWatchdog("task_001", cfg)
        captured: list = []

        async def on_stuck(reason, task_id, retry_count):
            captured.append((reason, task_id, retry_count))

        await watchdog.run(is_done=lambda: False, on_stuck=on_stuck)

        assert captured == [(StuckReason.TIMEOUT, "task_001", 1)]


# ---------------------------------------------------------------------------
# TaskWatchdog.run — loop detection
# ---------------------------------------------------------------------------


class TestRunLoopDetection:
    @pytest.mark.asyncio
    async def test_loop_fires_on_consecutive_calls(self):
        cfg = _fast_config(loop_detection_threshold=3, on_stuck="abort")
        watchdog = TaskWatchdog("task_001", cfg)
        on_stuck = AsyncMock()

        ev = _tool_start_event("grep", {"pattern": "foo"})
        # Pre-trigger loop before run() starts
        watchdog.record_event(ev)
        watchdog.record_event(ev)
        watchdog.record_event(ev)

        outcome = await watchdog.run(is_done=lambda: False, on_stuck=on_stuck)

        assert outcome.reason == StuckReason.LOOP
        assert outcome.action_taken == "abort"
        on_stuck.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_loop_reason_in_callback(self):
        cfg = _fast_config(loop_detection_threshold=2, on_stuck="replan")
        watchdog = TaskWatchdog("task_001", cfg)
        captured: list = []

        async def on_stuck(reason, task_id, retry_count):
            captured.append(reason)

        ev = _tool_start_event("write_file", {"path": "/tmp/x"})
        watchdog.record_event(ev)
        watchdog.record_event(ev)

        await watchdog.run(is_done=lambda: False, on_stuck=on_stuck)

        assert captured == [StuckReason.LOOP]


# ---------------------------------------------------------------------------
# TaskWatchdog.run — retry strategy
# ---------------------------------------------------------------------------


class TestRunRetryStrategy:
    @pytest.mark.asyncio
    async def test_retry_resets_state_and_continues(self):
        cfg = _fast_config(
            stuck_timeout_s=0.02,
            on_stuck="retry",
            max_retries=2,
        )
        watchdog = TaskWatchdog("task_001", cfg)
        call_count = {"n": 0}

        async def on_stuck(reason, task_id, retry_count):
            call_count["n"] += 1
            # After first retry simulate events arriving so timeout clears
            if retry_count == 1:
                watchdog.record_event(_other_event())

        outcome = await asyncio.wait_for(
            watchdog.run(is_done=lambda: False, on_stuck=on_stuck),
            timeout=2.0,
        )

        assert outcome.action_taken == "retry"
        assert outcome.retry_count == 2

    @pytest.mark.asyncio
    async def test_retry_exhausted_returns_outcome(self):
        cfg = _fast_config(
            stuck_timeout_s=0.02,
            on_stuck="retry",
            max_retries=1,
        )
        watchdog = TaskWatchdog("task_001", cfg)
        on_stuck = AsyncMock()

        outcome = await asyncio.wait_for(
            watchdog.run(is_done=lambda: False, on_stuck=on_stuck),
            timeout=2.0,
        )

        # max_retries=1 → fires once then exits (retry_count == max_retries)
        assert outcome.retry_count == 1
        assert outcome.action_taken == "retry"


# ---------------------------------------------------------------------------
# WatchdogChannelWrapper
# ---------------------------------------------------------------------------


class TestWatchdogChannelWrapper:
    @pytest.mark.asyncio
    async def test_forwards_event_to_inner_channel(self):
        inner = AsyncMock()
        watchdog = MagicMock(spec=TaskWatchdog)
        wrapper = WatchdogChannelWrapper(inner, watchdog)

        ev = _other_event()
        await wrapper.emit(ev)

        inner.emit.assert_awaited_once_with(ev)

    @pytest.mark.asyncio
    async def test_notifies_watchdog(self):
        inner = AsyncMock()
        watchdog = MagicMock(spec=TaskWatchdog)
        wrapper = WatchdogChannelWrapper(inner, watchdog)

        ev = _tool_start_event("grep", {})
        await wrapper.emit(ev)

        watchdog.record_event.assert_called_once_with(ev)

    @pytest.mark.asyncio
    async def test_watchdog_called_before_inner(self):
        """record_event must be called before inner.emit so state is up to date."""
        call_order: list[str] = []

        class _OrderedMockChannel(AsyncMock):
            async def emit(self, event):  # noqa: ANN001, ARG002
                call_order.append("inner")

        class _OrderedMockWatchdog:
            def record_event(self, event):  # noqa: ANN001, ARG002
                call_order.append("watchdog")

        wrapper = WatchdogChannelWrapper(_OrderedMockChannel(), _OrderedMockWatchdog())
        await wrapper.emit(_other_event())

        assert call_order == ["watchdog", "inner"]


# ---------------------------------------------------------------------------
# build_stuck_handler
# ---------------------------------------------------------------------------


class TestBuildStuckHandler:
    @pytest.mark.asyncio
    async def test_abort_calls_cancel(self):
        cfg = WatchdogConfig(on_stuck="abort")
        cancel_fn = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn)

        await handler(StuckReason.TIMEOUT, "task_001", 1)

        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_retry_calls_cancel(self):
        cfg = WatchdogConfig(on_stuck="retry")
        cancel_fn = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn)

        await handler(StuckReason.TIMEOUT, "task_001", 1)

        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_replan_calls_callback_then_cancel(self):
        cfg = WatchdogConfig(on_stuck="replan")
        cancel_fn = AsyncMock()
        replan_callback = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn, replan_callback=replan_callback)

        await handler(StuckReason.LOOP, "task_001", 1)

        replan_callback.assert_awaited_once_with("task_001", StuckReason.LOOP)
        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_replan_without_callback_still_cancels(self):
        cfg = WatchdogConfig(on_stuck="replan")
        cancel_fn = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn)

        await handler(StuckReason.TIMEOUT, "task_001", 1)

        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_escalate_emits_event_then_cancels(self):
        cfg = WatchdogConfig(on_stuck="escalate")
        cancel_fn = AsyncMock()
        escalate_channel = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn, escalate_channel=escalate_channel)

        await handler(StuckReason.TIMEOUT, "task_001", 1)

        escalate_channel.emit.assert_awaited_once()
        emitted_event = escalate_channel.emit.call_args[0][0]
        assert emitted_event.type == RavnEventType.TASK_STUCK
        assert emitted_event.payload["task_id"] == "task_001"
        assert emitted_event.payload["reason"] == str(StuckReason.TIMEOUT)
        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_escalate_without_channel_falls_back_gracefully(self):
        """Missing escalate_channel must not raise — just log a warning."""
        cfg = WatchdogConfig(on_stuck="escalate")
        cancel_fn = AsyncMock()
        handler = build_stuck_handler(cfg, cancel_fn=cancel_fn)

        # Should not raise
        await handler(StuckReason.TIMEOUT, "task_001", 1)

        cancel_fn.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_cancel_fn_does_not_raise(self):
        """cancel_fn=None must not raise for any strategy."""
        for strategy in ("retry", "replan", "escalate", "abort"):
            cfg = WatchdogConfig(on_stuck=strategy)  # type: ignore[arg-type]
            handler = build_stuck_handler(cfg)
            await handler(StuckReason.TIMEOUT, "task_001", 1)


# ---------------------------------------------------------------------------
# WatchdogOutcome
# ---------------------------------------------------------------------------


class TestWatchdogOutcome:
    def test_fields(self):
        outcome = WatchdogOutcome(
            task_id="task_001",
            reason=StuckReason.LOOP,
            retry_count=2,
            action_taken="replan",
        )
        assert outcome.task_id == "task_001"
        assert outcome.reason == StuckReason.LOOP
        assert outcome.retry_count == 2
        assert outcome.action_taken == "replan"

    def test_clean_completion_fields(self):
        outcome = WatchdogOutcome(
            task_id="task_002",
            reason=None,
            retry_count=0,
            action_taken=None,
        )
        assert outcome.reason is None
        assert outcome.action_taken is None


# ---------------------------------------------------------------------------
# CascadeConfig stuck-detection fields (regression)
# ---------------------------------------------------------------------------


class TestCascadeConfigStuckFields:
    def test_defaults_present(self):
        from ravn.config import CascadeConfig

        cfg = CascadeConfig()
        assert cfg.stuck_timeout_seconds == 60
        assert cfg.loop_detection_threshold == 3
        assert cfg.on_stuck == "replan"
        assert cfg.max_retries == 2

    def test_custom_values(self):
        from ravn.config import CascadeConfig

        cfg = CascadeConfig(
            stuck_timeout_seconds=120,
            loop_detection_threshold=5,
            on_stuck="abort",
            max_retries=0,
        )
        assert cfg.stuck_timeout_seconds == 120
        assert cfg.loop_detection_threshold == 5
        assert cfg.on_stuck == "abort"
        assert cfg.max_retries == 0


# ---------------------------------------------------------------------------
# TASK_STUCK event type (regression)
# ---------------------------------------------------------------------------


class TestTaskStuckEventType:
    def test_task_stuck_in_enum(self):
        from ravn.domain.events import RavnEventType

        assert RavnEventType.TASK_STUCK == "task_stuck"
