"""DriveLoop — perpetually-running initiative engine.

Runs as three concurrent asyncio tasks:
- ``_trigger_watcher``  — polls all registered TriggerPorts
- ``_task_executor``    — drains PriorityQueue, runs agent turns
- ``_heartbeat``        — publishes periodic heartbeat events via EventPublisherPort

The queue is persisted to ``queue_journal_path`` on every enqueue/dequeue so
that pending tasks survive daemon restarts.  A file lock prevents concurrent
daemon instances.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

from niuu.domain.mimir import ThreadState
from niuu.ports.mimir import MimirPort
from ravn.adapters.channels.capture import CaptureChannel, TaskResult, TaskResultStore
from ravn.adapters.channels.silent import SilentChannel
from ravn.adapters.events.noop_publisher import NoOpEventPublisher
from ravn.config import BudgetConfig, InitiativeConfig, Settings
from ravn.domain.budget import DailyBudgetTracker, compute_cost
from ravn.domain.events import RavnEvent, RavnEventType
from ravn.domain.models import AgentTask, OutputMode
from ravn.ports.channel import ChannelPort
from ravn.ports.event_publisher import EventPublisherPort
from ravn.ports.trigger import TriggerPort
from ravn.prompt_builder import build_initiative_prompt

logger = logging.getLogger(__name__)

# Type alias for the mesh RPC handler callable
MeshRpcHandler = Callable[[dict], Awaitable[dict]]


class DriveLoop:
    """Perpetually-running initiative engine.

    ``agent_factory(channel, task_id, persona, triggered_by)`` is called per
    task to create an isolated :class:`ravn.agent.RavnAgent` instance.  The
    ``task_id`` parameter lets the agent (and its SleipnirChannel) tag all
    emitted events with the correct task correlation ID.  The ``persona``
    parameter allows per-task persona overrides (may be ``None`` to use the
    default).  The ``triggered_by`` parameter carries the trigger source
    (e.g. ``"thread:<slug>"``) so the factory can apply trust constraints.

    Human-initiated turns (from the gateway) are NOT subject to the
    ``max_concurrent_tasks`` cap — that cap only applies to initiative tasks
    started by the drive loop.
    """

    def __init__(
        self,
        agent_factory: Callable[[ChannelPort, str | None, str | None, str | None], object],
        config: InitiativeConfig,
        settings: Settings,
        event_publisher: EventPublisherPort | None = None,
        resume: bool = False,
        budget: DailyBudgetTracker | None = None,
        mimir: MimirPort | None = None,
    ) -> None:
        self._agent_factory = agent_factory
        self._config = config
        self._settings = settings
        self._event_publisher: EventPublisherPort = event_publisher or NoOpEventPublisher()
        self._resume = resume
        self._mimir = mimir
        self._triggers: list[TriggerPort] = []
        # (priority, counter, AgentTask)
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue(maxsize=config.task_queue_max)
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._semaphore = asyncio.Semaphore(config.max_concurrent_tasks)
        self._journal_path = Path(config.queue_journal_path).expanduser()
        self._source_id = "drive_loop"
        self._counter = 0
        self._rpc_handler: MeshRpcHandler | None = None
        self._result_store: TaskResultStore = TaskResultStore()
        budget_cfg = getattr(settings, "budget", None)
        if isinstance(budget_cfg, BudgetConfig):
            _cap = budget_cfg.daily_cap_usd
            _warn = budget_cfg.warn_at_percent
        else:
            _cap = 1.0
            _warn = 80
        self._budget: DailyBudgetTracker = budget or DailyBudgetTracker(
            daily_cap_usd=_cap,
            warn_at_percent=_warn,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def _next_counter(self) -> int:
        self._counter += 1
        return self._counter

    def register_trigger(self, trigger: TriggerPort) -> None:
        """Register a trigger source before calling ``run()``."""
        self._triggers.append(trigger)

    async def enqueue(self, task: AgentTask) -> None:
        """Add a task to the priority queue, honouring deadline and capacity."""
        if task.deadline is not None and datetime.now(UTC) > task.deadline:
            logger.info(
                "drive_loop: task %s (%r) deadline exceeded before enqueue — discarding",
                task.task_id,
                task.title,
            )
            return

        if self._queue.full():
            logger.info(
                "drive_loop: queue full (max=%d) — discarding task %s",
                self._config.task_queue_max,
                task.task_id,
            )
            return

        counter = self._next_counter()
        await self._queue.put((task.priority, counter, task))
        self._persist_queue()

    async def cancel(self, task_id: str) -> None:
        """Request cancellation of a running task by ID."""
        running = self._active_tasks.get(task_id)
        if running is not None:
            running.cancel()
            logger.info("drive_loop: cancel requested for task %s", task_id)

    def active_task_ids(self) -> list[str]:
        """Return task IDs that are currently executing."""
        return list(self._active_tasks.keys())

    def queued_task_ids(self) -> list[str]:
        """Return task IDs waiting in the priority queue (not yet started)."""
        return [
            task.task_id
            for _prio, _counter, task in list(self._queue._queue)  # type: ignore[attr-defined]
        ]

    def task_status(self, task_id: str, include_progress: bool = False) -> str | dict:
        """Return the current status of a task by ID.

        When ``include_progress=False`` (default) returns one of:
        - ``"running"``  — task is actively executing
        - ``"queued"``   — task is in the priority queue, not yet started
        - ``"unknown"``  — task_id not found (may have completed or never existed)

        When ``include_progress=True`` returns a dict::

            {
                "status": "<running|queued|unknown>",
                "events": [{"type": ..., "summary": ..., "timestamp": ...}, ...],
            }

        The event list reflects all events accumulated so far by CaptureChannel.
        """
        if task_id in self._active_tasks:
            status = "running"
        elif task_id in self.queued_task_ids():
            status = "queued"
        else:
            status = "unknown"

        if not include_progress:
            return status

        result = self._result_store.get(task_id)
        events_data: list[dict] = []
        if result is not None:
            events_data = [
                {
                    "type": e.type,
                    "summary": e.summary,
                    "timestamp": e.timestamp.isoformat(),
                }
                for e in result.events
            ]
        return {"status": status, "events": events_data}

    def get_result(self, task_id: str) -> TaskResult | None:
        """Return the full TaskResult for a completed (or running) task, or None."""
        return self._result_store.get(task_id)

    def set_rpc_handler(self, handler: MeshRpcHandler) -> None:
        """Register a coroutine handler for incoming mesh RPC messages.

        The handler is called with the raw message dict and must return a
        dict reply.  Registered via MeshPort.set_rpc_handler() in _run_daemon().
        """
        self._rpc_handler = handler

    async def handle_rpc(self, message: dict) -> dict:
        """Dispatch an incoming mesh RPC message to the registered handler.

        Falls back to an error reply if no handler is registered.
        """
        if self._rpc_handler is None:
            return {"error": "no_rpc_handler_registered"}
        try:
            return await self._rpc_handler(message)
        except Exception as exc:
            logger.error("drive_loop: rpc handler raised: %s", exc)
            return {"error": str(exc)}

    # ------------------------------------------------------------------
    # Main run loop
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Start all three internal loops and run until cancelled."""
        if self._resume:
            self._load_journal()
        elif self._journal_path.exists():
            logger.info("drive_loop: discarding stale journal (use --resume to restore)")
            try:
                self._journal_path.unlink()
            except OSError:
                pass

        coros: list[Awaitable] = [
            self._task_executor(),
            self._heartbeat(),
        ]
        for trigger in self._triggers:
            coros.append(self._trigger_watcher(trigger))

        try:
            await asyncio.gather(*coros)
        except asyncio.CancelledError:
            logger.info("drive_loop: shutting down")
            self._persist_queue()
            raise

    # ------------------------------------------------------------------
    # Internal coroutines
    # ------------------------------------------------------------------

    async def _trigger_watcher(self, trigger: TriggerPort) -> None:
        """Run a single trigger indefinitely, forwarding tasks to the queue."""
        logger.info("drive_loop: starting trigger %r", trigger.name)
        try:
            await trigger.run(self.enqueue)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.error("drive_loop: trigger %r raised unexpected error: %s", trigger.name, exc)

    async def _task_executor(self) -> None:
        """Drain the priority queue and execute tasks with the semaphore cap."""
        while True:
            _, _, task = await self._queue.get()
            self._persist_queue()

            # Check deadline again after any time in queue
            if task.deadline is not None and datetime.now(UTC) > task.deadline:
                logger.info(
                    "drive_loop: task %s (%r) deadline exceeded — discarding",
                    task.task_id,
                    task.title,
                )
                self._queue.task_done()
                continue

            # Acquire semaphore slot before spawning the task
            await self._semaphore.acquire()
            asyncio_task = asyncio.create_task(
                self._run_task(task),
                name=f"initiative:{task.task_id}",
            )
            self._active_tasks[task.task_id] = asyncio_task
            asyncio_task.add_done_callback(lambda _t, tid=task.task_id: self._on_task_done(tid))
            self._queue.task_done()

    def _on_task_done(self, task_id: str) -> None:
        self._active_tasks.pop(task_id, None)
        self._semaphore.release()

    async def _run_task(self, task: AgentTask) -> None:
        """Execute a single initiative task."""
        # Budget pre-check: skip when daily cap is reached.
        # The task is already persisted in the journal and will be retried
        # after the UTC day rolls over and the budget resets.
        if not self._budget.can_spend():
            logger.info(
                "drive_loop: task %s (%r) skipped — daily budget cap reached "
                "(spent=%.4f remaining=%.4f)",
                task.task_id,
                task.title,
                self._budget.spent_today_usd,
                self._budget.remaining_usd,
            )
            return

        if self._settings.cascade.enabled:
            self._result_store.start(task.task_id, task.triggered_by)
            channel: ChannelPort = CaptureChannel(task.task_id, self._result_store)
        else:
            channel = SilentChannel()
        agent = self._agent_factory(channel, task.task_id, task.persona, task.triggered_by)
        prompt = build_initiative_prompt(task)

        logger.info(
            "drive_loop: executing task %s (%r) triggered_by=%r",
            task.task_id,
            task.title,
            task.triggered_by,
        )

        await self._event_publisher.publish(
            RavnEvent(
                type=RavnEventType.TASK_STARTED,
                source=self._source_id,
                payload={
                    "task_id": task.task_id,
                    "title": task.title,
                    "triggered_by": task.triggered_by,
                },
                timestamp=datetime.now(UTC),
                urgency=0.2,
                correlation_id=task.task_id,
                session_id=task.session_id,
                task_id=task.task_id,
            )
        )

        success = False
        try:
            turn_result = await agent.run_turn(prompt)  # type: ignore[attr-defined]
            success = True
            self._record_task_cost(task, turn_result)
            await self._maybe_publish_budget_warning(task)
            self._save_task_output(task, channel)
            response_text = getattr(channel, "response_text", "")
            if response_text:
                logger.info(
                    "drive_loop: task %s output: %s",
                    task.task_id,
                    response_text[:500],
                )
        except asyncio.CancelledError:
            logger.info("drive_loop: task %s cancelled mid-turn", task.task_id)
            self._result_store.set_status(task.task_id, "cancelled")
            await self._event_publisher.publish(
                RavnEvent(
                    type=RavnEventType.TASK_COMPLETE,
                    source=self._source_id,
                    payload={"task_id": task.task_id, "success": False},
                    timestamp=datetime.now(UTC),
                    urgency=0.7,
                    correlation_id=task.task_id,
                    session_id=task.session_id,
                    task_id=task.task_id,
                )
            )
            if task.triggered_by and task.triggered_by.startswith("thread:"):
                thread_path = task.triggered_by.removeprefix("thread:")
                await self._finalise_thread(thread_path, False)
            return
        except Exception as exc:
            logger.error("drive_loop: task %s failed: %s", task.task_id, exc)
            self._result_store.set_status(task.task_id, "failed")

        await self._event_publisher.publish(
            RavnEvent(
                type=RavnEventType.TASK_COMPLETE,
                source=self._source_id,
                payload={"task_id": task.task_id, "success": success},
                timestamp=datetime.now(UTC),
                urgency=0.2 if success else 0.7,
                correlation_id=task.task_id,
                session_id=task.session_id,
                task_id=task.task_id,
            )
        )

        if channel.surface_triggered:
            await self._re_deliver_surface(task, channel.response_text)

        if task.triggered_by and task.triggered_by.startswith("thread:"):
            thread_path = task.triggered_by.removeprefix("thread:")
            await self._finalise_thread(thread_path, success)

    def _save_task_output(self, task: AgentTask, channel: ChannelPort) -> None:
        """Persist agent response to ``task.output_path`` when set (cron tasks)."""
        if task.output_path is None:
            return
        text = getattr(channel, "response_text", "")
        try:
            task.output_path.parent.mkdir(parents=True, exist_ok=True)
            header = f"# {task.title}\n\ntriggered_by: {task.triggered_by}\n\n"
            task.output_path.write_text(header + text)
            logger.debug("drive_loop: saved task output to %s", task.output_path)
        except Exception as exc:
            logger.warning("drive_loop: failed to save task output: %s", exc)

    async def _maybe_publish_budget_warning(self, task: AgentTask) -> None:
        """Publish a DECISION warning event once per UTC day when spend crosses the threshold."""
        if not self._budget.warn_threshold_reached:
            return
        if self._budget.warn_emitted_today:
            return
        budget_cfg = getattr(self._settings, "budget", None)
        if isinstance(budget_cfg, BudgetConfig):
            daily_cap_usd = budget_cfg.daily_cap_usd
            warn_at_percent = budget_cfg.warn_at_percent
        else:
            daily_cap_usd = self._budget._daily_cap_usd
            warn_at_percent = self._budget._warn_at_percent
        logger.warning(
            "drive_loop: daily budget warning — spent=%.4f remaining=%.4f cap=%.4f",
            self._budget.spent_today_usd,
            self._budget.remaining_usd,
            daily_cap_usd,
        )
        self._budget.mark_warn_emitted()
        await self._event_publisher.publish(
            RavnEvent(
                type=RavnEventType.DECISION,
                source=self._source_id,
                payload={
                    "budget_warning": True,
                    "spent_today_usd": self._budget.spent_today_usd,
                    "remaining_usd": self._budget.remaining_usd,
                    "daily_cap_usd": daily_cap_usd,
                    "warn_at_percent": warn_at_percent,
                },
                timestamp=datetime.now(UTC),
                urgency=0.5,
                correlation_id=task.task_id,
                session_id=task.session_id,
                task_id=task.task_id,
            )
        )

    def _record_task_cost(self, task: AgentTask, turn_result: object) -> None:
        """Compute cost from turn_result.usage and record it on the budget tracker."""
        usage = getattr(turn_result, "usage", None)
        if usage is None:
            return
        input_tokens: int = getattr(usage, "input_tokens", 0)
        output_tokens: int = getattr(usage, "output_tokens", 0)
        budget_cfg = getattr(self._settings, "budget", None)
        if isinstance(budget_cfg, BudgetConfig):
            input_rate = budget_cfg.input_token_cost_per_million
            output_rate = budget_cfg.output_token_cost_per_million
        else:
            input_rate = 3.0
            output_rate = 15.0
        cost_usd = compute_cost(input_tokens, output_tokens, input_rate, output_rate)
        self._budget.record(cost_usd)
        logger.debug(
            "drive_loop: task %s cost=%.6f spent_today=%.6f remaining=%.6f",
            task.task_id,
            cost_usd,
            self._budget.spent_today_usd,
            self._budget.remaining_usd,
        )

    async def _re_deliver_surface(self, task: AgentTask, text: str) -> None:
        """Re-publish a [SURFACE]-prefixed response to Sleipnir at AMBIENT urgency."""
        logger.info(
            "drive_loop: task %s surface escalation — publishing to Sleipnir",
            task.task_id,
        )
        event = RavnEvent(
            type=RavnEventType.RESPONSE,
            source=self._source_id,
            payload={"text": text, "surface_escalation": True},
            timestamp=datetime.now(UTC),
            urgency=0.7,
            correlation_id=task.task_id,
            session_id=task.session_id,
            task_id=task.task_id,
        )
        await self._event_publisher.publish(event)

    async def _finalise_thread(self, thread_path: str, success: bool) -> None:
        """Transition thread state after task completion.

        On success: ``pulling → closed``.
        On failure: ``pulling → open`` and ownership is released.
        All Mímir errors are caught and logged; never propagated.
        """
        if self._mimir is None:
            return
        try:
            if success:
                await self._mimir.update_thread_state(thread_path, ThreadState.closed)
                logger.info("drive_loop: thread %r closed after successful task", thread_path)
            else:
                await self._mimir.update_thread_state(thread_path, ThreadState.open)
                await self._mimir.assign_thread_owner(thread_path, None)
                logger.info("drive_loop: thread %r returned to open after failed task", thread_path)
        except Exception as exc:
            logger.warning("drive_loop: failed to finalise thread %r: %s", thread_path, exc)

    async def _heartbeat(self) -> None:
        """Publish periodic heartbeat events via the event publisher."""
        while True:
            await asyncio.sleep(self._config.heartbeat_interval_seconds)
            active = len(self._active_tasks)
            queued = self._queue.qsize()
            event = RavnEvent(
                type=RavnEventType.TASK_STARTED,
                source=self._source_id,
                payload={
                    "active_tasks": active,
                    "queued_tasks": queued,
                    "trigger_count": len(self._triggers),
                    "budget_spent_usd": round(self._budget.spent_today_usd, 6),
                    "budget_remaining_usd": round(self._budget.remaining_usd, 6),
                    "heartbeat": True,
                },
                timestamp=datetime.now(UTC),
                urgency=0.0,
                correlation_id="heartbeat",
                session_id="daemon",
                task_id=None,
            )
            await self._event_publisher.publish(event)
            logger.debug(
                "drive_loop: heartbeat — active=%d queued=%d triggers=%d",
                active,
                queued,
                len(self._triggers),
            )

    # ------------------------------------------------------------------
    # Queue journal
    # ------------------------------------------------------------------

    def _persist_queue(self) -> None:
        """Snapshot all pending tasks to the journal file."""
        try:
            self._journal_path.parent.mkdir(parents=True, exist_ok=True)
            items = list(self._queue._queue)  # type: ignore[attr-defined]
            records = []
            for _prio, _counter, task in items:
                records.append(
                    {
                        "task_id": task.task_id,
                        "title": task.title,
                        "initiative_context": task.initiative_context,
                        "triggered_by": task.triggered_by,
                        "output_mode": str(task.output_mode),
                        "persona": task.persona,
                        "priority": task.priority,
                        "max_tokens": task.max_tokens,
                        "deadline": task.deadline.isoformat() if task.deadline else None,
                        "output_path": str(task.output_path) if task.output_path else None,
                        "created_at": task.created_at.isoformat(),
                    }
                )
            self._journal_path.write_text(json.dumps(records, indent=2))
        except Exception as exc:
            logger.warning("drive_loop: failed to persist queue journal: %s", exc)

    def _load_journal(self) -> None:
        """Restore pending tasks from the journal file on startup."""
        if not self._journal_path.exists():
            return
        try:
            records = json.loads(self._journal_path.read_text())
        except Exception as exc:
            logger.warning("drive_loop: failed to load queue journal: %s", exc)
            return

        restored = 0
        for rec in records:
            try:
                deadline = datetime.fromisoformat(rec["deadline"]) if rec.get("deadline") else None
                created_at = (
                    datetime.fromisoformat(rec["created_at"])
                    if rec.get("created_at")
                    else datetime.now(UTC)
                )
                output_path_str = rec.get("output_path")
                task = AgentTask(
                    task_id=rec["task_id"],
                    title=rec["title"],
                    initiative_context=rec["initiative_context"],
                    triggered_by=rec["triggered_by"],
                    output_mode=OutputMode(rec.get("output_mode", "silent")),
                    persona=rec.get("persona"),
                    priority=rec.get("priority", 10),
                    max_tokens=rec.get("max_tokens"),
                    deadline=deadline,
                    output_path=Path(output_path_str) if output_path_str else None,
                    created_at=created_at,
                )
                # Check deadline before restoring
                if deadline is not None and datetime.now(UTC) > deadline:
                    logger.info(
                        "drive_loop: journal task %s deadline exceeded — skipping",
                        task.task_id,
                    )
                    continue
                counter = self._next_counter()
                self._queue.put_nowait((task.priority, counter, task))
                restored += 1
            except Exception as exc:
                logger.warning("drive_loop: failed to restore journal entry: %s", exc)

        if restored:
            logger.info("drive_loop: restored %d task(s) from journal", restored)
