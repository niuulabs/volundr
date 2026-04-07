"""Trigger port — interface for drive-loop trigger sources."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol, runtime_checkable

from ravn.domain.models import AgentTask


@runtime_checkable
class TriggerPort(Protocol):
    """Interface for a drive-loop trigger source.

    Each trigger runs indefinitely as an asyncio task, calling ``enqueue``
    whenever a new task should fire.  The drive loop registers triggers via
    ``DriveLoop.register_trigger()`` before calling ``DriveLoop.run()``.
    """

    @property
    def name(self) -> str:
        """Human-readable trigger name, e.g. ``cron:morning_check``."""
        ...

    async def run(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        """Run forever.  Call ``enqueue`` whenever a task should fire."""
        ...
