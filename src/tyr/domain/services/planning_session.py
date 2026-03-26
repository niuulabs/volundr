"""Planning session service — orchestrates interactive saga decomposition.

Manages the lifecycle of planning sessions: spawn via Volundr, send messages,
capture SagaStructure from conversation, and clean up expired sessions.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

from tyr.config import PlannerConfig
from tyr.domain.models import (
    PlanningMessage,
    PlanningSession,
    PlanningSessionStatus,
)
from tyr.domain.validation import parse_and_validate
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.planning_repository import PlanningSessionRepository
from tyr.ports.volundr import SpawnRequest, VolundrPort

logger = logging.getLogger(__name__)


class PlanningSessionError(Exception):
    """Base error for planning session operations."""


class SessionLimitReachedError(PlanningSessionError):
    def __init__(self, owner_id: str, limit: int) -> None:
        self.owner_id = owner_id
        self.limit = limit
        super().__init__(f"User {owner_id} has reached the limit of {limit} planning sessions")


class PlanningSessionNotFoundError(PlanningSessionError):
    def __init__(self, session_id: UUID | str) -> None:
        self.session_id = session_id
        super().__init__(f"Planning session not found: {session_id}")


class InvalidPlanningStateError(PlanningSessionError):
    def __init__(self, session_id: UUID | str, current: str, action: str) -> None:
        self.session_id = session_id
        self.current = current
        self.action = action
        super().__init__(f"Cannot {action} session {session_id} in {current} state")


class PlanningSessionService:
    """Orchestrates interactive planning sessions for saga decomposition."""

    def __init__(
        self,
        repo: PlanningSessionRepository,
        volundr: VolundrPort,
        config: PlannerConfig,
        event_bus: EventBusPort | None = None,
    ) -> None:
        self._repo = repo
        self._volundr = volundr
        self._config = config
        self._event_bus = event_bus

    async def spawn(
        self,
        owner_id: str,
        spec: str,
        repo: str,
        *,
        auth_token: str | None = None,
    ) -> PlanningSession:
        """Spawn a new planning session via Volundr."""
        existing = await self._repo.list_by_owner(owner_id)
        active = [
            s
            for s in existing
            if s.status in (PlanningSessionStatus.SPAWNING, PlanningSessionStatus.ACTIVE)
        ]
        if len(active) >= self._config.max_sessions_per_user:
            raise SessionLimitReachedError(owner_id, self._config.max_sessions_per_user)

        now = datetime.now(UTC)
        session_id = uuid4()

        planning_session = PlanningSession(
            id=session_id,
            owner_id=owner_id,
            session_id="",
            repo=repo,
            spec=spec,
            status=PlanningSessionStatus.SPAWNING,
            structure=None,
            created_at=now,
            updated_at=now,
        )
        await self._repo.save(planning_session)

        try:
            volundr_session = await self._volundr.spawn_session(
                SpawnRequest(
                    name=f"planner-{session_id.hex[:8]}",
                    repo=repo,
                    branch="main",
                    model=self._config.default_model,
                    tracker_issue_id="",
                    tracker_issue_url="",
                    system_prompt=self._config.system_prompt,
                    initial_prompt=f"Here is the specification to decompose:\n\n{spec}",
                ),
                auth_token=auth_token,
            )
        except Exception:
            planning_session = replace(
                planning_session,
                status=PlanningSessionStatus.FAILED,
                updated_at=datetime.now(UTC),
            )
            await self._repo.save(planning_session)
            raise

        planning_session = replace(
            planning_session,
            session_id=volundr_session.id,
            status=PlanningSessionStatus.ACTIVE,
            updated_at=datetime.now(UTC),
        )
        await self._repo.save(planning_session)

        if self._event_bus:
            await self._event_bus.emit(
                TyrEvent(
                    event="planning.session_spawned",
                    data={
                        "planning_session_id": str(session_id),
                        "volundr_session_id": volundr_session.id,
                    },
                    owner_id=owner_id,
                )
            )

        return planning_session

    async def send_message(
        self,
        session_id: UUID,
        content: str,
        *,
        sender: str = "user",
        auth_token: str | None = None,
    ) -> PlanningMessage:
        """Send a message to a planning session."""
        session = await self._repo.get(session_id)
        if session is None:
            raise PlanningSessionNotFoundError(session_id)

        if session.status not in (
            PlanningSessionStatus.ACTIVE,
            PlanningSessionStatus.STRUCTURE_PROPOSED,
        ):
            raise InvalidPlanningStateError(session_id, session.status.value, "send message to")

        await self._volundr.send_message(session.session_id, content, auth_token=auth_token)

        now = datetime.now(UTC)
        msg = PlanningMessage(
            id=uuid4(),
            planning_session_id=session_id,
            content=content,
            sender=sender,
            created_at=now,
        )
        await self._repo.save_message(msg)

        # Update the session timestamp
        updated = replace(session, updated_at=now)
        await self._repo.save(updated)

        return msg

    async def propose_structure(
        self,
        session_id: UUID,
        raw_json: str,
    ) -> PlanningSession:
        """Parse and store a proposed SagaStructure from the conversation."""
        session = await self._repo.get(session_id)
        if session is None:
            raise PlanningSessionNotFoundError(session_id)

        if session.status not in (
            PlanningSessionStatus.ACTIVE,
            PlanningSessionStatus.STRUCTURE_PROPOSED,
        ):
            raise InvalidPlanningStateError(
                session_id, session.status.value, "propose structure on"
            )

        structure = parse_and_validate(raw_json)

        updated = replace(
            session,
            structure=structure,
            status=PlanningSessionStatus.STRUCTURE_PROPOSED,
            updated_at=datetime.now(UTC),
        )
        await self._repo.save(updated)

        if self._event_bus:
            await self._event_bus.emit(
                TyrEvent(
                    event="planning.structure_proposed",
                    data={
                        "planning_session_id": str(session_id),
                        "saga_name": structure.name,
                        "phase_count": len(structure.phases),
                    },
                    owner_id=session.owner_id,
                )
            )

        return updated

    async def complete(self, session_id: UUID) -> PlanningSession:
        """Mark a planning session as completed (structure accepted)."""
        session = await self._repo.get(session_id)
        if session is None:
            raise PlanningSessionNotFoundError(session_id)

        if session.status != PlanningSessionStatus.STRUCTURE_PROPOSED:
            raise InvalidPlanningStateError(session_id, session.status.value, "complete")

        if session.structure is None:
            raise InvalidPlanningStateError(
                session_id, session.status.value, "complete without structure"
            )

        updated = replace(
            session,
            status=PlanningSessionStatus.COMPLETED,
            updated_at=datetime.now(UTC),
        )
        await self._repo.save(updated)
        return updated

    async def get(self, session_id: UUID) -> PlanningSession | None:
        """Get a planning session by ID."""
        return await self._repo.get(session_id)

    async def list_sessions(self, owner_id: str) -> list[PlanningSession]:
        """List planning sessions for a user."""
        return await self._repo.list_by_owner(owner_id)

    async def delete(self, session_id: UUID) -> bool:
        """Delete a planning session."""
        return await self._repo.delete(session_id)

    async def cleanup_expired(self) -> int:
        """Expire idle planning sessions past the timeout. Returns count expired."""
        # This would be called by a periodic task; for now it's a manual method.
        # Real implementation would scan all active sessions.
        return 0

    async def get_messages(self, session_id: UUID) -> list[PlanningMessage]:
        """Get all messages for a planning session."""
        session = await self._repo.get(session_id)
        if session is None:
            raise PlanningSessionNotFoundError(session_id)
        return await self._repo.get_messages(session_id)
