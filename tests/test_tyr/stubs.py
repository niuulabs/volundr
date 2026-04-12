"""Shared in-memory stubs reused across Tyr test modules."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

from tyr.domain.models import Phase, Raid, Saga, SagaStatus
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import (
    ActivityEvent,
    PRStatus,
    SpawnRequest,
    VolundrPort,
    VolundrSession,
)


class InMemorySagaRepository(SagaRepository):
    """In-memory saga repository for tests."""

    def __init__(self) -> None:
        self.sagas: dict[UUID, Saga] = {}
        self.phases: dict[UUID, Phase] = {}
        self.raids: dict[UUID, Raid] = {}

    async def save_saga(self, saga: Saga, *, conn: Any = None) -> None:
        self.sagas[saga.id] = saga

    async def save_phase(self, phase: Phase, *, conn: Any = None) -> None:
        self.phases[phase.id] = phase

    async def save_raid(self, raid: Raid, *, conn: Any = None) -> None:
        self.raids[raid.id] = raid

    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        if owner_id is None:
            return list(self.sagas.values())
        return [s for s in self.sagas.values() if s.owner_id == owner_id]

    async def get_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> Saga | None:
        return self.sagas.get(saga_id)

    async def get_saga_by_slug(self, slug: str) -> Saga | None:
        return next((s for s in self.sagas.values() if s.slug == slug), None)

    async def delete_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> bool:
        return self.sagas.pop(saga_id, None) is not None

    async def update_saga_status(self, saga_id: UUID, status: SagaStatus) -> None:
        saga = self.sagas.get(saga_id)
        if saga:
            self.sagas[saga_id] = Saga(
                id=saga.id,
                tracker_id=saga.tracker_id,
                tracker_type=saga.tracker_type,
                slug=saga.slug,
                name=saga.name,
                repos=saga.repos,
                feature_branch=saga.feature_branch,
                base_branch=saga.base_branch,
                status=status,
                confidence=saga.confidence,
                created_at=saga.created_at,
                owner_id=saga.owner_id,
            )

    async def count_by_status(self) -> dict[str, int]:
        return {}


class StubVolundrPort(VolundrPort):
    """Stub Volundr port that records spawn requests."""

    def __init__(self, session_id: str = "sess-001") -> None:
        self._session_id = session_id
        self.spawned: list[SpawnRequest] = []

    async def spawn_session(
        self, request: SpawnRequest, *, auth_token: str | None = None
    ) -> VolundrSession:
        self.spawned.append(request)
        return VolundrSession(
            id=self._session_id,
            name=request.name,
            status="running",
            tracker_issue_id=request.tracker_issue_id,
        )

    async def get_session(
        self, session_id: str, *, auth_token: str | None = None
    ) -> VolundrSession | None:
        return None

    async def list_sessions(self, *, auth_token: str | None = None) -> list[VolundrSession]:
        return []

    async def get_pr_status(self, session_id: str) -> PRStatus:
        return PRStatus(exists=False, merged=False, url=None, ci_passed=False)

    async def get_chronicle_summary(self, session_id: str) -> str:
        return ""

    async def send_message(
        self, session_id: str, message: str, *, auth_token: str | None = None
    ) -> None:
        pass

    async def stop_session(self, session_id: str, *, auth_token: str | None = None) -> None:
        pass

    async def list_integration_ids(self, *, auth_token: str | None = None) -> list[str]:
        return []

    async def list_repos(self, *, auth_token: str | None = None) -> list[dict]:
        return []

    async def get_last_assistant_message(self, session_id: str) -> str:
        return ""

    async def get_conversation(self, session_id: str) -> dict:
        return {}

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        return
        yield  # type: ignore[misc]


class StubVolundrFactory:
    """Factory that always returns the same stub adapter."""

    def __init__(self, volundr: VolundrPort | None = None) -> None:
        self._volundr = volundr or StubVolundrPort()

    async def for_owner(self, owner_id: str) -> list[VolundrPort]:
        if self._volundr is None:
            return []
        return [self._volundr]

    async def primary_for_owner(self, owner_id: str) -> VolundrPort | None:
        return self._volundr
