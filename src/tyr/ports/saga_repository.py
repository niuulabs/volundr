"""Saga repository port — persistence for saga references only.

The tracker (Linear, etc.) is the source of truth for project structure
(milestones, issues, names, statuses). This repo stores only the link
between a tracker project and Tyr's execution context.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from tyr.domain.models import Saga


class SagaRepository(ABC):
    """Abstract persistence for saga references."""

    @abstractmethod
    async def save_saga(self, saga: Saga) -> None:
        """Persist a saga reference."""
        ...

    @abstractmethod
    async def list_sagas(self) -> list[Saga]:
        """List all saga references."""
        ...

    @abstractmethod
    async def get_saga(self, saga_id: UUID) -> Saga | None:
        """Get a saga by ID."""
        ...

    @abstractmethod
    async def delete_saga(self, saga_id: UUID) -> bool:
        """Delete a saga. Returns True if deleted."""
        ...
