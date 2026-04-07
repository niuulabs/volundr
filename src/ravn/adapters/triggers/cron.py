"""CronTrigger — fires AgentTasks on a schedule.

Supports:
- Standard cron expressions: ``"0 8 * * *"``
- Natural language: ``"every 30m"``, ``"daily at 08:00"``
- One-shot ISO timestamps: ``"2026-04-07T08:00:00"``

State is persisted to ``~/.ravn/daemon/cron_state.json`` so last-fired
timestamps survive restarts.  A file lock at ``~/.ravn/daemon/cron.lock``
prevents duplicate firings when multiple daemon instances are (accidentally)
running.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import re
import time
from typing import IO
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path

from ravn.domain.models import AgentTask, OutputMode

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_STATE_PATH = Path.home() / ".ravn" / "daemon" / "cron_state.json"
_DEFAULT_LOCK_PATH = Path.home() / ".ravn" / "daemon" / "cron.lock"
_TICK_SECONDS = 30
_NATURAL_EVERY_RE = re.compile(
    r"every\s+(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:our)?s?)",
    re.IGNORECASE,
)
_DAILY_AT_RE = re.compile(r"daily\s+at\s+(\d{1,2}):(\d{2})", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Cron expression parser (minute-level precision)
# ---------------------------------------------------------------------------


def _field_matches(value: int, spec: str) -> bool:
    """Return True if *value* matches the cron field *spec*."""
    if spec == "*":
        return True
    for part in spec.split(","):
        part = part.strip()
        if "/" in part:
            base, step_str = part.split("/", 1)
            step = int(step_str)
            if base == "*":
                if value % step == 0:
                    return True
            else:
                start = int(base)
                if value >= start and (value - start) % step == 0:
                    return True
        elif "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= value <= int(hi):
                return True
        else:
            if value == int(part):
                return True
    return False


def _cron_matches(expr: str, dt: datetime) -> bool:
    """Return True if cron expression *expr* matches *dt* (minute-level)."""
    parts = expr.strip().split()
    if len(parts) != 5:
        return False
    minute, hour, dom, month, dow = parts
    return (
        _field_matches(dt.minute, minute)
        and _field_matches(dt.hour, hour)
        and _field_matches(dt.day, dom)
        and _field_matches(dt.month, month)
        and _field_matches((dt.weekday() + 1) % 7, dow)  # convert to cron: 0=Sun
    )


# ---------------------------------------------------------------------------
# Schedule type detection
# ---------------------------------------------------------------------------


def _parse_schedule(schedule: str) -> str:
    """Normalise *schedule* to a canonical cron expression or special form.

    Returns one of:
    - A 5-field cron string (``"0 8 * * *"``)
    - ``"every:{seconds}"`` for fixed-interval schedules
    - ``"once:{iso}"`` for one-shot timestamps
    """
    schedule = schedule.strip()

    # Natural: "every 30m", "every 5s", "every 2h"
    m = _NATURAL_EVERY_RE.fullmatch(schedule)
    if m:
        count = int(m.group(1))
        unit = m.group(2).lower()[0]
        multipliers = {"s": 1, "m": 60, "h": 3600}
        seconds = count * multipliers.get(unit, 60)
        return f"every:{seconds}"

    # Natural: "daily at HH:MM"
    m = _DAILY_AT_RE.fullmatch(schedule)
    if m:
        hh, mm = int(m.group(1)), int(m.group(2))
        return f"{mm} {hh} * * *"

    # ISO timestamp (one-shot)
    try:
        dt = datetime.fromisoformat(schedule)
        return f"once:{dt.isoformat()}"
    except ValueError:
        pass

    # Assume it's already a cron expression
    return schedule


# ---------------------------------------------------------------------------
# CronJob descriptor
# ---------------------------------------------------------------------------


class CronJob:
    """A single scheduled job within a CronTrigger."""

    def __init__(
        self,
        name: str,
        schedule: str,
        context: str,
        output_mode: OutputMode = OutputMode.SILENT,
        persona: str | None = None,
        priority: int = 10,
    ) -> None:
        self.name = name
        self.raw_schedule = schedule
        self.canonical = _parse_schedule(schedule)
        self.context = context
        self.output_mode = output_mode
        self.persona = persona
        self.priority = priority


# ---------------------------------------------------------------------------
# CronTrigger
# ---------------------------------------------------------------------------


class CronTrigger:
    """Trigger that fires tasks on a cron schedule.

    All jobs share the same state file so that last-fired timestamps
    survive daemon restarts.
    """

    def __init__(
        self,
        jobs: list[CronJob],
        state_path: Path = _DEFAULT_STATE_PATH,
        lock_path: Path = _DEFAULT_LOCK_PATH,
        tick_seconds: float = _TICK_SECONDS,
    ) -> None:
        self._jobs = jobs
        self._state_path = state_path
        self._lock_path = lock_path
        self._tick = tick_seconds
        self._counter = 0

    @property
    def name(self) -> str:
        return "cron"

    # ------------------------------------------------------------------
    # State persistence
    # ------------------------------------------------------------------

    def _load_state(self) -> dict[str, str]:
        if not self._state_path.exists():
            return {}
        try:
            return json.loads(self._state_path.read_text())
        except Exception:
            return {}

    def _save_state(self, state: dict[str, str]) -> None:
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        self._state_path.write_text(json.dumps(state))

    # ------------------------------------------------------------------
    # Lock
    # ------------------------------------------------------------------

    def _acquire_lock(self) -> IO[str] | None:
        """Try to acquire the cron lock.  Returns fd on success, None on failure."""
        try:
            self._lock_path.parent.mkdir(parents=True, exist_ok=True)
            fd = open(self._lock_path, "w")  # noqa: SIM115
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except (OSError, BlockingIOError):
            return None

    # ------------------------------------------------------------------
    # Task ID generation
    # ------------------------------------------------------------------

    def _make_task_id(self) -> str:
        self._counter += 1
        hex_ts = hex(int(time.time() * 1000))[2:]
        return f"task_{hex_ts}_{self._counter:04d}"

    # ------------------------------------------------------------------
    # Due detection
    # ------------------------------------------------------------------

    def _is_due(self, job: CronJob, now: datetime, state: dict[str, str]) -> bool:
        canonical = job.canonical

        if canonical.startswith("once:"):
            iso = canonical[5:]
            try:
                fire_at = datetime.fromisoformat(iso)
            except ValueError:
                return False
            if now < fire_at:
                return False
            # Only fire once
            return job.name not in state

        if canonical.startswith("every:"):
            interval = int(canonical[6:])
            last_str = state.get(job.name)
            if last_str is None:
                return True
            last = datetime.fromisoformat(last_str)
            return (now - last).total_seconds() >= interval

        # Standard cron expression
        last_str = state.get(job.name)
        if last_str is not None:
            last = datetime.fromisoformat(last_str)
            # Don't fire more than once per minute
            if (now - last).total_seconds() < 60:
                return False
        return _cron_matches(canonical, now)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def run(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        lock_fd = self._acquire_lock()
        if lock_fd is None:
            logger.warning("cron: another instance holds the lock — skipping")
            return

        try:
            while True:
                now = datetime.now(UTC)
                state = self._load_state()
                changed = False

                for job in self._jobs:
                    if not self._is_due(job, now, state):
                        continue

                    task_id = self._make_task_id()
                    task = AgentTask(
                        task_id=task_id,
                        title=job.name,
                        initiative_context=job.context,
                        triggered_by=f"cron:{job.name}",
                        output_mode=job.output_mode,
                        persona=job.persona,
                        priority=job.priority,
                    )
                    logger.info("cron: firing job %r (task_id=%s)", job.name, task_id)
                    await enqueue(task)
                    state[job.name] = now.isoformat()
                    changed = True

                if changed:
                    self._save_state(state)

                await asyncio.sleep(self._tick)
        finally:
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                lock_fd.close()
            except Exception:
                pass
