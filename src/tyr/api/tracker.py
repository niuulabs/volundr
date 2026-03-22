"""REST API for tracker browsing and import.

Thin REST layer — delegates all business logic to TrackerPort adapters.
The API receives pre-configured adapters (with credentials already resolved)
via a FastAPI dependency. Supports multiple trackers in parallel.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from niuu.domain.models import RepoInfo
from niuu.ports.git import GitProvider
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ImportRequest(BaseModel):
    """Request body for importing a project as a saga."""

    project_id: str = Field(description="External tracker project ID")
    repos: list[str] = Field(description="Repositories (org/repo)")


class SagaResponse(BaseModel):
    """Response for a created saga."""

    id: str
    tracker_id: str
    name: str
    repos: list[str]
    feature_branch: str
    status: str
    phase_count: int
    raid_count: int


# ---------------------------------------------------------------------------
# Dependency type — injected by the composition root
# ---------------------------------------------------------------------------


# This is the dependency function that main.py overrides to provide
# per-request TrackerPort adapters resolved from user credentials.
# The API layer never touches credentials directly.
async def resolve_trackers() -> list[TrackerPort]:
    """Default dependency — overridden by the composition root."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Tracker adapters not configured",
    )


async def resolve_git_providers() -> list[GitProvider]:
    """Default dependency — overridden by the composition root."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Git provider adapters not configured",
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_tracker_router() -> APIRouter:
    """Create FastAPI router for tracker browsing endpoints."""
    router = APIRouter(
        prefix="/api/v1/tyr/tracker",
        tags=["Tracker Browser"],
    )

    @router.get("/projects", response_model=list[TrackerProject])
    async def list_projects(
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> list[TrackerProject]:
        """List all projects across all connected trackers."""
        results: list[TrackerProject] = []
        for adapter in adapters:
            try:
                projects = await adapter.list_projects()
                results.extend(projects)
            except Exception:
                logger.warning("list_projects failed for adapter", exc_info=True)
        return results

    @router.get("/projects/{project_id}", response_model=TrackerProject)
    async def get_project(
        project_id: str,
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> TrackerProject:
        """Get a single project by ID, searching across connected trackers."""
        for adapter in adapters:
            try:
                return await adapter.get_project(project_id)
            except Exception:
                continue
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project not found: {project_id}",
        )

    @router.get(
        "/projects/{project_id}/milestones",
        response_model=list[TrackerMilestone],
    )
    async def list_milestones(
        project_id: str,
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> list[TrackerMilestone]:
        """List milestones for a project."""
        for adapter in adapters:
            try:
                return await adapter.list_milestones(project_id)
            except Exception:
                continue
        return []

    @router.get(
        "/projects/{project_id}/issues",
        response_model=list[TrackerIssue],
    )
    async def list_issues(
        project_id: str,
        milestone_id: str | None = Query(default=None),
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> list[TrackerIssue]:
        """List issues for a project, optionally filtered by milestone."""
        for adapter in adapters:
            try:
                return await adapter.list_issues(project_id, milestone_id)
            except Exception:
                continue
        return []

    @router.get("/repos", response_model=list[RepoInfo])
    async def list_repos(
        providers: list[GitProvider] = Depends(resolve_git_providers),
    ) -> list[RepoInfo]:
        """List repos from all connected source control integrations."""
        results: list[RepoInfo] = []
        for provider in providers:
            try:
                repos = await provider.list_repos("")
                results.extend(repos)
            except Exception:
                logger.warning("list_repos failed for provider %s", provider.name, exc_info=True)
        return results

    @router.post("/import", response_model=SagaResponse)
    async def import_project(
        body: ImportRequest,
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> SagaResponse:
        """Import a tracker project as a Saga with Phases and Raids.

        Creates local references to existing tracker entities.
        The tracker remains source of truth.
        """
        # Find the adapter that owns this project
        project: TrackerProject | None = None
        owning_adapter: TrackerPort | None = None
        for adapter in adapters:
            try:
                project = await adapter.get_project(body.project_id)
                owning_adapter = adapter
                break
            except Exception:
                continue

        if project is None or owning_adapter is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project not found: {body.project_id}",
            )

        milestones = await owning_adapter.list_milestones(body.project_id)
        issues = await owning_adapter.list_issues(body.project_id)

        now = datetime.now(UTC)
        saga_id = uuid4()

        saga = Saga(
            id=saga_id,
            tracker_id=project.id,
            tracker_type="linear",
            slug=project.name.lower().replace(" ", "-").replace("—", "-"),
            name=project.name,
            repos=body.repos,
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

        phases: list[Phase] = []
        for i, ms in enumerate(milestones):
            phase = Phase(
                id=uuid4(),
                saga_id=saga_id,
                tracker_id=ms.id,
                number=i + 1,
                name=ms.name,
                status=PhaseStatus.PENDING,
                confidence=0.0,
            )
            phases.append(phase)

        milestone_to_phase = {p.tracker_id: p.id for p in phases}

        raids: list[Raid] = []
        for issue in issues:
            phase_id = milestone_to_phase.get(issue.milestone_id or "", uuid4())
            raid = Raid(
                id=uuid4(),
                phase_id=phase_id,
                tracker_id=issue.id,
                name=issue.title,
                description=issue.description,
                acceptance_criteria=[],
                declared_files=[],
                estimate_hours=None,
                status=RaidStatus.PENDING,
                confidence=0.0,
                session_id=None,
                branch=None,
                chronicle_summary=None,
                retry_count=0,
                created_at=now,
                updated_at=now,
            )
            raids.append(raid)

        logger.info(
            "Imported saga '%s' with %d phases and %d raids from project %s",
            saga.name,
            len(phases),
            len(raids),
            project.id,
        )

        return SagaResponse(
            id=str(saga.id),
            tracker_id=saga.tracker_id,
            name=saga.name,
            repos=saga.repos,
            feature_branch=saga.feature_branch,
            status=saga.status.value,
            phase_count=len(phases),
            raid_count=len(raids),
        )

    return router
