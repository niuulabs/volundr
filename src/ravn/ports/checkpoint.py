"""Checkpoint port — interface for persisting and loading task checkpoints."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ravn.domain.checkpoint import Checkpoint


class CheckpointPort(ABC):
    """Persist and load task checkpoints.

    Implementations must be safe to call concurrently from async code.
    All methods are async so adapters can use non-blocking I/O.
    """

    @abstractmethod
    async def save(self, checkpoint: Checkpoint) -> None:
        """Persist *checkpoint*, overwriting any previous checkpoint for the same task_id."""

    @abstractmethod
    async def load(self, task_id: str) -> Checkpoint | None:
        """Return the checkpoint for *task_id*, or ``None`` if it does not exist."""

    @abstractmethod
    async def delete(self, task_id: str) -> None:
        """Delete the checkpoint for *task_id*.  No-op if it does not exist."""

    @abstractmethod
    async def list_task_ids(self) -> list[str]:
        """Return the task IDs of all stored checkpoints, newest first."""
