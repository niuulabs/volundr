"""REST API for tracker browsing and import.

Thin REST layer — delegates all business logic to TrackerPort adapters.
The API receives pre-configured adapters (with credentials already resolved)
via a FastAPI dependency. Supports multiple trackers in parallel.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import TrackerIssue, TrackerMilestone, TrackerProject
from tyr.domain.models import Saga, SagaStatus
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    """Convert a project name to a clean slug for branch names."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


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

    @router.post("/import", response_model=SagaResponse)
    async def import_project(
        request: Request,
        body: ImportRequest,
        adapters: list[TrackerPort] = Depends(resolve_trackers),
    ) -> SagaResponse:
        """Import a tracker project as a Saga reference.

        Only stores the link between the tracker project and Tyr's
        execution context. All display data is fetched live from the
        tracker at read time.
        """
        project: TrackerProject | None = None
        for adapter in adapters:
            try:
                project = await adapter.get_project(body.project_id)
                break
            except Exception:
                continue

        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project not found: {body.project_id}",
            )

        now = datetime.now(UTC)
        saga = Saga(
            id=uuid4(),
            tracker_id=project.id,
            tracker_type="linear",
            slug=project.slug or _slugify(project.name),
            name=project.name,
            repos=body.repos,
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

        saga_repo: SagaRepository = request.app.state.saga_repo
        await saga_repo.save_saga(saga)

        logger.info(
            "Imported saga '%s' from project %s",
            saga.name,
            project.id,
        )

        return SagaResponse(
            id=str(saga.id),
            tracker_id=saga.tracker_id,
            name=saga.name,
            repos=saga.repos,
            feature_branch=saga.feature_branch,
            status=saga.status.value,
            phase_count=project.milestone_count,
            raid_count=project.issue_count,
        )

    return router
