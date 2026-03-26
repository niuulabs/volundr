"""In-memory planning session repository — suitable for dev and tests."""

from __future__ import annotations

from uuid import UUID

from tyr.domain.models import PlanningMessage, PlanningSession
from tyr.ports.planning_repository import PlanningSessionRepository


class InMemoryPlanningSessionRepository(PlanningSessionRepository):
    """Stores planning sessions in memory (no persistence across restarts)."""

    def __init__(self) -> None:
        self._sessions: dict[UUID, PlanningSession] = {}
        self._messages: dict[UUID, list[PlanningMessage]] = {}

    async def save(self, session: PlanningSession) -> None:
        self._sessions[session.id] = session

    async def get(self, session_id: UUID) -> PlanningSession | None:
        return self._sessions.get(session_id)

    async def get_by_volundr_id(self, volundr_session_id: str) -> PlanningSession | None:
        for s in self._sessions.values():
            if s.session_id == volundr_session_id:
                return s
        return None

    async def list_by_owner(self, owner_id: str) -> list[PlanningSession]:
        return [s for s in self._sessions.values() if s.owner_id == owner_id]

    async def delete(self, session_id: UUID) -> bool:
        if session_id in self._sessions:
            del self._sessions[session_id]
            self._messages.pop(session_id, None)
            return True
        return False

    async def save_message(self, message: PlanningMessage) -> None:
        self._messages.setdefault(message.planning_session_id, []).append(message)

    async def get_messages(self, session_id: UUID) -> list[PlanningMessage]:
        return list(self._messages.get(session_id, []))
