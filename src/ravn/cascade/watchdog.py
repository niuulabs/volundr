"""Sub-agent stuck detection and replan watchdog (NIU-510).

The watchdog monitors a sub-agent task for progress and detects three stuck
conditions:

1. **Timeout** — no event emitted for > ``stuck_timeout_s`` seconds.
2. **Loop**    — same tool called with identical args >= ``loop_detection_threshold``
                 times consecutively.
3. **Budget**  — task exceeded its iteration budget (reserved for future use).

When stuck is detected the configured ``on_stuck`` strategy determines the
response:

* ``retry``    — cancel the task and restart it (up to ``max_retries`` times).
* ``replan``   — invoke the replan callback so the orchestrator can rewrite the
                 task description, then cancel.
* ``escalate`` — emit a ``ravn.task.stuck`` event on the configured channel and
                 cancel.
* ``abort``    — cancel immediately; the cascade continues with remaining tasks.

Usage
-----
::

    watchdog = TaskWatchdog(task_id="task_001", config=WatchdogConfig())
    channel  = WatchdogChannelWrapper(inner_channel, watchdog)

    handler  = build_stuck_handler(
        config=watchdog.config,
        cancel_fn=lambda: drive_loop.cancel(task_id),
        escalate_channel=sleipnir_channel,
    )
    outcome  = await watchdog.run(
        is_done=lambda: drive_loop.task_status(task_id) == "unknown",
        on_stuck=handler,
    )

Depends on NIU-435 (cascade system) and NIU-438 (Sleipnir event publishing).
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.ports.channel import ChannelPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants — overridden by CascadeConfig when wired through build_cascade_tools
# ---------------------------------------------------------------------------

_DEFAULT_STUCK_TIMEOUT_S: float = 60.0
_DEFAULT_LOOP_THRESHOLD: int = 3
_DEFAULT_ON_STUCK: OnStuckStrategy = "replan"
_DEFAULT_MAX_RETRIES: int = 2
_DEFAULT_POLL_INTERVAL_S: float = 5.0

OnStuckStrategy = Literal["retry", "replan", "escalate", "abort"]


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class StuckReason(StrEnum):
    """The cause of a stuck detection."""

    TIMEOUT = "timeout"
    LOOP = "loop"
    BUDGET = "budget"


@dataclass
class WatchdogConfig:
    """Configuration for stuck detection on a single sub-agent task.

    All timing values are in seconds.  This mirrors the fields added to
    ``CascadeConfig`` so that per-task overrides can be threaded down from
    YAML without coupling to pydantic.
    """

    stuck_timeout_s: float = _DEFAULT_STUCK_TIMEOUT_S
    loop_detection_threshold: int = _DEFAULT_LOOP_THRESHOLD
    on_stuck: OnStuckStrategy = _DEFAULT_ON_STUCK
    max_retries: int = _DEFAULT_MAX_RETRIES
    poll_interval_s: float = _DEFAULT_POLL_INTERVAL_S


@dataclass
class WatchdogOutcome:
    """Describes what the watchdog observed over a task's lifetime."""

    task_id: str
    # None means the task completed normally without triggering the watchdog.
    reason: StuckReason | None
    retry_count: int
    # None when the task completed normally.
    action_taken: OnStuckStrategy | None


# ---------------------------------------------------------------------------
# TaskWatchdog
# ---------------------------------------------------------------------------


class TaskWatchdog:
    """Monitors a sub-agent task for stuck conditions.

    The watchdog runs as a concurrent asyncio task alongside the monitored
    agent.  It is notified of events via :meth:`record_event`; typically a
    :class:`WatchdogChannelWrapper` calls this automatically.

    Parameters
    ----------
    task_id:
        Stable identifier of the task being monitored.  Used in log messages
        and in the ``WatchdogOutcome``.
    config:
        Watchdog tuning; defaults to ``WatchdogConfig()`` when omitted.
    """

    def __init__(
        self,
        task_id: str,
        config: WatchdogConfig | None = None,
    ) -> None:
        self._task_id = task_id
        self._config: WatchdogConfig = config or WatchdogConfig()
        self._last_event_at: float = time.monotonic()
        # Fixed-size deque: automatically discards entries older than the
        # threshold so we only keep the most recent N tool calls.
        self._recent_tool_calls: deque[tuple[str, str]] = deque(
            maxlen=self._config.loop_detection_threshold
        )
        self._loop_detected: bool = False
        self._retry_count: int = 0

    # ------------------------------------------------------------------
    # Public properties
    # ------------------------------------------------------------------

    @property
    def config(self) -> WatchdogConfig:
        return self._config

    @property
    def task_id(self) -> str:
        return self._task_id

    # ------------------------------------------------------------------
    # Event notification
    # ------------------------------------------------------------------

    def record_event(self, event: RavnEvent) -> None:
        """Record an event emitted by the monitored sub-agent.

        Updates the last-event timestamp and checks for tool-call loops.
        Safe to call from any coroutine — no I/O, no blocking.
        """
        self._last_event_at = time.monotonic()

        if event.type != RavnEventType.TOOL_START:
            return

        tool_name = event.payload.get("tool_name", "")
        tool_input_key = json.dumps(event.payload.get("input", {}), sort_keys=True)
        call_key = (tool_name, tool_input_key)

        self._recent_tool_calls.append(call_key)

        threshold = self._config.loop_detection_threshold
        if len(self._recent_tool_calls) == threshold and len(set(self._recent_tool_calls)) == 1:
            self._loop_detected = True
            logger.warning(
                "watchdog: task %s — loop detected (%s called %d× with identical args)",
                self._task_id,
                tool_name,
                threshold,
            )

    def seconds_since_last_event(self) -> float:
        """Elapsed seconds since the last event from the sub-agent."""
        return time.monotonic() - self._last_event_at

    # ------------------------------------------------------------------
    # Monitor loop
    # ------------------------------------------------------------------

    async def run(
        self,
        is_done: Callable[[], bool],
        on_stuck: Callable[[StuckReason, str, int], Awaitable[None]],
    ) -> WatchdogOutcome:
        """Monitor the task until it completes or a stuck condition fires.

        Parameters
        ----------
        is_done:
            Zero-argument predicate that returns ``True`` once the task has
            finished (e.g. ``drive_loop.task_status(task_id) == "unknown"``).
        on_stuck:
            Async callback invoked when stuck is detected.
            Signature: ``(reason, task_id, retry_count) -> None``.

        Returns
        -------
        WatchdogOutcome
            Clean completion has ``reason=None``; stuck detection sets the
            reason and the action that was taken.
        """
        while not is_done():
            await asyncio.sleep(self._config.poll_interval_s)

            if is_done():
                break

            reason = self._check_stuck()
            if reason is None:
                continue

            self._retry_count += 1
            logger.warning(
                "watchdog: task %s stuck (reason=%s, attempt=%d/%d, strategy=%s)",
                self._task_id,
                reason,
                self._retry_count,
                self._config.max_retries,
                self._config.on_stuck,
            )
            await on_stuck(reason, self._task_id, self._retry_count)

            strategy = self._config.on_stuck
            if strategy == "retry" and self._retry_count < self._config.max_retries:
                # Reset state and keep watching; caller has restarted the task.
                self._loop_detected = False
                self._last_event_at = time.monotonic()
                self._recent_tool_calls.clear()
                continue

            return WatchdogOutcome(
                task_id=self._task_id,
                reason=reason,
                retry_count=self._retry_count,
                action_taken=strategy,
            )

        return WatchdogOutcome(
            task_id=self._task_id,
            reason=None,
            retry_count=self._retry_count,
            action_taken=None,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_stuck(self) -> StuckReason | None:
        """Return a ``StuckReason`` if a condition is active, else ``None``."""
        if self._loop_detected:
            return StuckReason.LOOP

        if self.seconds_since_last_event() > self._config.stuck_timeout_s:
            return StuckReason.TIMEOUT

        return None


# ---------------------------------------------------------------------------
# WatchdogChannelWrapper
# ---------------------------------------------------------------------------


class WatchdogChannelWrapper(ChannelPort):
    """Wraps a :class:`~ravn.ports.channel.ChannelPort` and notifies a watchdog.

    Place this around the channel passed to an agent so that every emitted
    event is transparently forwarded *and* recorded by the watchdog.

    Parameters
    ----------
    inner:
        The real output channel (CLI, web-socket, Sleipnir, …).
    watchdog:
        The :class:`TaskWatchdog` instance monitoring the same task.
    """

    def __init__(self, inner: ChannelPort, watchdog: TaskWatchdog) -> None:
        self._inner = inner
        self._watchdog = watchdog

    async def emit(self, event: RavnEvent) -> None:
        """Record the event with the watchdog then forward to the inner channel."""
        self._watchdog.record_event(event)
        await self._inner.emit(event)


# ---------------------------------------------------------------------------
# Strategy handler factory
# ---------------------------------------------------------------------------


async def _emit_task_stuck_event(
    task_id: str,
    reason: StuckReason,
    channel: ChannelPort,
) -> None:
    """Emit a ``ravn.task.stuck`` event to *channel*."""
    event = RavnEvent(
        type=RavnEventType.TASK_STUCK,
        source=socket.gethostname(),
        payload={"task_id": task_id, "reason": str(reason)},
        timestamp=datetime.now(UTC),
        urgency=0.9,
        correlation_id=task_id,
        session_id="",
        task_id=task_id,
    )
    await channel.emit(event)


def build_stuck_handler(
    config: WatchdogConfig,
    *,
    cancel_fn: Callable[[], Awaitable[None]] | None = None,
    escalate_channel: ChannelPort | None = None,
    replan_callback: Callable[[str, StuckReason], Awaitable[None]] | None = None,
) -> Callable[[StuckReason, str, int], Awaitable[None]]:
    """Build the ``on_stuck`` callback for :meth:`TaskWatchdog.run`.

    The returned callable executes the strategy named by ``config.on_stuck``:

    * ``retry``    — calls ``cancel_fn`` so the caller can restart the task.
    * ``replan``   — calls ``replan_callback(task_id, reason)`` then
                     ``cancel_fn``.
    * ``escalate`` — emits a ``ravn.task.stuck`` event on ``escalate_channel``
                     then calls ``cancel_fn``.
    * ``abort``    — calls ``cancel_fn``; cascade continues with other tasks.

    Parameters
    ----------
    config:
        Watchdog configuration (determines the active strategy).
    cancel_fn:
        Async callable that stops/cancels the monitored task.  All strategies
        call this; pass ``None`` only in tests where cancellation is a no-op.
    escalate_channel:
        Channel for emitting the stuck event.  Required for the ``escalate``
        strategy; ignored otherwise.
    replan_callback:
        Async callable invoked with ``(task_id, reason)`` for the ``replan``
        strategy; ignored otherwise.
    """

    async def handler(reason: StuckReason, task_id: str, retry_count: int) -> None:  # noqa: ARG001
        strategy = config.on_stuck

        if strategy == "escalate":
            if escalate_channel is not None:
                await _emit_task_stuck_event(task_id, reason, escalate_channel)
            else:
                logger.warning(
                    "watchdog: escalate strategy but no escalate_channel configured"
                    " for task %s — falling back to abort",
                    task_id,
                )

        if strategy == "replan" and replan_callback is not None:
            await replan_callback(task_id, reason)

        if cancel_fn is not None:
            await cancel_fn()

    return handler
