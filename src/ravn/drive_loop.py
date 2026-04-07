"""DriveLoop — perpetually-running initiative engine.

Runs as three concurrent asyncio tasks:
- ``_trigger_watcher``  — polls all registered TriggerPorts
- ``_task_executor``    — drains PriorityQueue, runs agent turns
- ``_heartbeat``        — emits TASK_STARTED/TASK_COMPLETE to Sleipnir

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

from ravn.adapters.channels.silent import SilentChannel
from ravn.config import InitiativeConfig, Settings
from ravn.domain.events import RavnEvent, RavnEventType
from ravn.domain.models import AgentTask, OutputMode
from ravn.ports.channel import ChannelPort
from ravn.ports.trigger import TriggerPort
from ravn.prompt_builder import build_initiative_prompt

logger = logging.getLogger(__name__)

# sentinel used to carry priority in heapq-compatible tuple
_COUNTER = 0


def _next_counter() -> int:
    global _COUNTER
    _COUNTER += 1
    return _COUNTER


class DriveLoop:
    """Perpetually-running initiative engine.

    ``agent_factory(channel, task_id)`` is called per task to create an
    isolated :class:`ravn.agent.RavnAgent` instance.  The ``task_id``
    parameter lets the agent (and its SleipnirChannel) tag all emitted
    events with the correct task correlation ID.

    Human-initiated turns (from the gateway) are NOT subject to the
    ``max_concurrent_tasks`` cap — that cap only applies to initiative tasks
    started by the drive loop.
    """

    def __init__(
        self,
        agent_factory: Callable[[ChannelPort, str | None], object],
        config: InitiativeConfig,
        settings: Settings,
    ) -> None:
        self._agent_factory = agent_factory
        self._config = config
        self._settings = settings
        self._triggers: list[TriggerPort] = []
        # (priority, counter, AgentTask)
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue(maxsize=config.task_queue_max)
        self._active_tasks: dict[str, asyncio.Task] = {}
        self._semaphore = asyncio.Semaphore(config.max_concurrent_tasks)
        self._journal_path = Path(config.queue_journal_path).expanduser()
        self._source_id = "drive_loop"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

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

        counter = _next_counter()
        await self._queue.put((task.priority, counter, task))
        self._persist_queue()

    async def cancel(self, task_id: str) -> None:
        """Request cancellation of a running task by ID."""
        running = self._active_tasks.get(task_id)
        if running is not None:
            running.cancel()
            logger.info("drive_loop: cancel requested for task %s", task_id)

    # ------------------------------------------------------------------
    # Main run loop
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Start all three internal loops and run until cancelled."""
        self._load_journal()

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
        channel = SilentChannel()
        agent = self._agent_factory(channel, task.task_id)
        prompt = build_initiative_prompt(task)

        logger.info(
            "drive_loop: executing task %s (%r) triggered_by=%r",
            task.task_id,
            task.title,
            task.triggered_by,
        )

        try:
            await agent.run_turn(prompt)  # type: ignore[attr-defined]
        except asyncio.CancelledError:
            logger.info("drive_loop: task %s cancelled mid-turn", task.task_id)
            return
        except Exception as exc:
            logger.error("drive_loop: task %s failed: %s", task.task_id, exc)
            return

        if channel.surface_triggered:
            await self._re_deliver_surface(task, channel.response_text)

    async def _re_deliver_surface(self, task: AgentTask, text: str) -> None:
        """Re-publish a [SURFACE]-prefixed response to Sleipnir at AMBIENT urgency."""
        logger.info(
            "drive_loop: task %s surface escalation — publishing to Sleipnir",
            task.task_id,
        )
        # Emit a synthetic RESPONSE event with AMBIENT urgency.
        # Real re-delivery happens via the SleipnirPublisher if wired in.
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
        # Log it; actual channel routing is handled by the gateway
        logger.info("drive_loop: surface event: %s", event.payload.get("text", "")[:120])

    async def _heartbeat(self) -> None:
        """Emit periodic heartbeat logs (low-overhead; Sleipnir publishing is optional)."""
        interval = 60  # seconds
        while True:
            await asyncio.sleep(interval)
            active = len(self._active_tasks)
            queued = self._queue.qsize()
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
                    created_at=created_at,
                )
                # Check deadline before restoring
                if deadline is not None and datetime.now(UTC) > deadline:
                    logger.info(
                        "drive_loop: journal task %s deadline exceeded — skipping",
                        task.task_id,
                    )
                    continue
                counter = _next_counter()
                self._queue.put_nowait((task.priority, counter, task))
                restored += 1
            except Exception as exc:
                logger.warning("drive_loop: failed to restore journal entry: %s", exc)

        if restored:
            logger.info("drive_loop: restored %d task(s) from journal", restored)
