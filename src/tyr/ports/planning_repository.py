"""PlanningSessionRepository port — persistence for interactive planning sessions."""

from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from tyr.domain.models import PlanningMessage, PlanningSession


class PlanningSessionRepository(ABC):
    """Abstract interface for planning session persistence."""

    @abstractmethod
    async def save(self, session: PlanningSession) -> None: ...

    @abstractmethod
    async def get(self, session_id: UUID) -> PlanningSession | None: ...

    @abstractmethod
    async def get_by_volundr_id(self, volundr_session_id: str) -> PlanningSession | None: ...

    @abstractmethod
    async def list_by_owner(self, owner_id: str) -> list[PlanningSession]: ...

    @abstractmethod
    async def list_active(self) -> list[PlanningSession]: ...

    @abstractmethod
    async def delete(self, session_id: UUID) -> bool: ...

    @abstractmethod
    async def save_message(self, message: PlanningMessage) -> None: ...

    @abstractmethod
    async def get_messages(self, session_id: UUID) -> list[PlanningMessage]: ...
