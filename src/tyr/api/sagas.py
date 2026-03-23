"""REST API for saga management.

Saga references are stored in the DB. Display data (project name, status,
milestones, issues) is fetched live from the tracker at read time.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.api.tracker import resolve_trackers
from tyr.domain.models import TrackerIssue, TrackerProject
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class RaidResponse(BaseModel):
    id: str
    identifier: str
    title: str
    status: str
    status_type: str = ""
    assignee: str | None = None
    labels: list[str] = Field(default_factory=list)
    priority: int = 0
    priority_label: str = ""
    estimate: float | None = None
    url: str = ""
    milestone_id: str | None = None


class PhaseResponse(BaseModel):
    id: str
    name: str
    description: str = ""
    sort_order: int = 0
    progress: float = 0.0
    target_date: str | None = None
    raids: list[RaidResponse] = Field(default_factory=list)


class SagaListItem(BaseModel):
    id: str
    tracker_id: str
    tracker_type: str
    slug: str
    name: str
    repos: list[str]
    feature_branch: str
    status: str
    progress: float = 0.0
    milestone_count: int = 0
    issue_count: int = 0
    url: str = ""


class SagaDetailResponse(BaseModel):
    id: str
    tracker_id: str
    tracker_type: str
    slug: str
    name: str
    description: str = ""
    repos: list[str]
    feature_branch: str
    status: str
    progress: float = 0.0
    url: str = ""
    phases: list[PhaseResponse]


# ---------------------------------------------------------------------------
# Dependency — overridden by main.py
# ---------------------------------------------------------------------------


async def resolve_saga_repo() -> SagaRepository:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Saga repository not configured",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _find_project(
    tracker_id: str,
    adapters: list[TrackerPort],
) -> TrackerProject | None:
    """Find a project across all tracker adapters."""
    for adapter in adapters:
        try:
            return await adapter.get_project(tracker_id)
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_sagas_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/sagas", tags=["Sagas"])

    @router.get("", response_model=list[SagaListItem])
    async def list_sagas(
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> list[SagaListItem]:
        """List all sagas, hydrating display data from the tracker."""
        sagas = await repo.list_sagas(owner_id=principal.user_id)

        # Fetch all projects once and index by ID
        all_projects: dict[str, TrackerProject] = {}
        for adapter in adapters:
            try:
                projects = await adapter.list_projects()
                for p in projects:
                    all_projects[p.id] = p
            except Exception:
                logger.warning("Failed to list projects from adapter", exc_info=True)

        items: list[SagaListItem] = []
        for saga in sagas:
            project = all_projects.get(saga.tracker_id)
            items.append(
                SagaListItem(
                    id=str(saga.id),
                    tracker_id=saga.tracker_id,
                    tracker_type=saga.tracker_type,
                    slug=saga.slug,
                    name=project.name if project else saga.name,
                    repos=saga.repos,
                    feature_branch=saga.feature_branch,
                    status=project.status if project else "unknown",
                    progress=project.progress if project else 0.0,
                    milestone_count=project.milestone_count if project else 0,
                    issue_count=project.issue_count if project else 0,
                    url=project.url if project else "",
                )
            )
        return items

    @router.get("/{saga_id}", response_model=SagaDetailResponse)
    async def get_saga(
        saga_id: str,
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> SagaDetailResponse:
        """Get saga detail, hydrating milestones and issues from the tracker."""
        saga = await repo.get_saga(UUID(saga_id), owner_id=principal.user_id)
        if saga is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Saga not found: {saga_id}",
            )

        # Fetch project + milestones + issues in a single call
        project = None
        milestones = []
        issues = []
        for adapter in adapters:
            try:
                if hasattr(adapter, "get_project_full"):
                    project, milestones, issues = await adapter.get_project_full(saga.tracker_id)
                else:
                    project = await adapter.get_project(saga.tracker_id)
                    milestones = await adapter.list_milestones(saga.tracker_id)
                    issues = await adapter.list_issues(saga.tracker_id)
                break
            except Exception:
                continue

        if project is None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not fetch project from tracker",
            )

        # Group issues by milestone
        issues_by_milestone: dict[str | None, list] = {}
        for issue in issues:
            key = issue.milestone_id
            issues_by_milestone.setdefault(key, []).append(issue)

        phase_responses: list[PhaseResponse] = []

        def _issue_to_raid(i: TrackerIssue) -> RaidResponse:
            return RaidResponse(
                id=i.id,
                identifier=i.identifier,
                title=i.title,
                status=i.status,
                status_type=i.status_type,
                assignee=i.assignee,
                labels=i.labels or [],
                priority=i.priority,
                priority_label=i.priority_label,
                estimate=i.estimate,
                url=i.url,
                milestone_id=i.milestone_id,
            )

        for ms in milestones:
            ms_issues = issues_by_milestone.get(ms.id, [])
            phase_responses.append(
                PhaseResponse(
                    id=ms.id,
                    name=ms.name,
                    description=ms.description,
                    sort_order=ms.sort_order,
                    progress=ms.progress,
                    target_date=ms.target_date,
                    raids=[_issue_to_raid(i) for i in ms_issues],
                )
            )

        # Unassigned issues
        unassigned = issues_by_milestone.get(None, [])
        if unassigned:
            phase_responses.append(
                PhaseResponse(
                    id="__unassigned__",
                    name="Unassigned",
                    sort_order=999999,
                    raids=[_issue_to_raid(i) for i in unassigned],
                )
            )

        return SagaDetailResponse(
            id=str(saga.id),
            tracker_id=saga.tracker_id,
            tracker_type=saga.tracker_type,
            slug=saga.slug,
            name=project.name,
            description=project.description,
            repos=saga.repos,
            feature_branch=saga.feature_branch,
            status=project.status,
            progress=project.progress,
            url=project.url,
            phases=phase_responses,
        )

    @router.delete("/{saga_id}", status_code=204)
    async def delete_saga(
        saga_id: str,
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
    ) -> None:
        """Delete a saga reference."""
        deleted = await repo.delete_saga(UUID(saga_id))
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Saga not found: {saga_id}",
            )

    return router
