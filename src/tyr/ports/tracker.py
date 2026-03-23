"""Tracker port — interface for issue/work-item tracking systems."""

from __future__ import annotations

from abc import ABC, abstractmethod

from tyr.domain.models import (
    Phase,
    Raid,
    RaidStatus,
    Saga,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)


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
