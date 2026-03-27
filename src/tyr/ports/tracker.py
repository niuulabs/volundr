"""Tracker port — interface for issue/work-item tracking systems."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Protocol
from uuid import UUID

from tyr.domain.models import (
    ConfidenceEvent,
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SessionMessage,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)


class TrackerFactory(Protocol):
    """Protocol for resolving per-owner TrackerPort adapters."""

    async def for_owner(self, owner_id: str) -> list[TrackerPort]: ...


class TrackerPort(ABC):
    """Abstract interface for tracker integration (Linear, Jira, etc.)."""

    # -- CRUD: create entities in the external tracker --

    @abstractmethod
    async def create_saga(self, saga: Saga) -> str: ...

    @abstractmethod
    async def create_phase(self, phase: Phase) -> str: ...

    @abstractmethod
    async def create_raid(self, raid: Raid) -> str: ...

    # -- CRUD: update / close --

    @abstractmethod
    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None: ...

    @abstractmethod
    async def close_raid(self, raid_id: str) -> None: ...

    # -- Read: fetch domain entities by tracker ID --

    @abstractmethod
    async def get_saga(self, saga_id: str) -> Saga: ...

    @abstractmethod
    async def get_phase(self, tracker_id: str) -> Phase: ...

    @abstractmethod
    async def get_raid(self, tracker_id: str) -> Raid: ...

    @abstractmethod
    async def list_pending_raids(self, phase_id: str) -> list[Raid]: ...

    # -- Browsing: read-only access to external tracker hierarchy --

    @abstractmethod
    async def list_projects(self) -> list[TrackerProject]: ...

    @abstractmethod
    async def get_project(self, project_id: str) -> TrackerProject: ...

    @abstractmethod
    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]: ...

    @abstractmethod
    async def list_issues(
        self,
        project_id: str,
        milestone_id: str | None = None,
    ) -> list[TrackerIssue]: ...

    # -- Raid progress: operational state (status, session, confidence, PR) --

    @abstractmethod
    async def update_raid_progress(
        self,
        tracker_id: str,
        *,
        status: RaidStatus | None = None,
        session_id: str | None = None,
        confidence: float | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        retry_count: int | None = None,
        reason: str | None = None,
        owner_id: str | None = None,
        phase_tracker_id: str | None = None,
        saga_tracker_id: str | None = None,
        chronicle_summary: str | None = None,
        depends_on: list[str] | None = None,
    ) -> Raid: ...

    @abstractmethod
    async def get_raid_progress_for_saga(self, saga_tracker_id: str) -> list[Raid]: ...

    @abstractmethod
    async def get_raid_by_session(self, session_id: str) -> Raid | None: ...

    @abstractmethod
    async def list_raids_by_status(self, status: RaidStatus) -> list[Raid]: ...

    @abstractmethod
    async def get_raid_by_id(self, raid_id: UUID) -> Raid | None: ...

    # -- Confidence events --

    @abstractmethod
    async def add_confidence_event(self, tracker_id: str, event: ConfidenceEvent) -> None: ...

    @abstractmethod
    async def get_confidence_events(self, tracker_id: str) -> list[ConfidenceEvent]: ...

    # -- Phase gate management --

    @abstractmethod
    async def all_raids_merged(self, phase_tracker_id: str) -> bool: ...

    @abstractmethod
    async def list_phases_for_saga(self, saga_tracker_id: str) -> list[Phase]: ...

    @abstractmethod
    async def update_phase_status(
        self, phase_tracker_id: str, status: PhaseStatus
    ) -> Phase | None: ...

    # -- Cross-entity navigation --

    @abstractmethod
    async def get_saga_for_raid(self, tracker_id: str) -> Saga | None: ...

    @abstractmethod
    async def get_phase_for_raid(self, tracker_id: str) -> Phase | None: ...

    @abstractmethod
    async def get_owner_for_raid(self, tracker_id: str) -> str | None: ...

    # -- Session messages --

    @abstractmethod
    async def save_session_message(self, message: SessionMessage) -> None: ...

    @abstractmethod
    async def get_session_messages(self, tracker_id: str) -> list[SessionMessage]: ...
