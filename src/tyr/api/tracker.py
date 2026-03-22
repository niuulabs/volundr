"""REST API for tracker browsing and import."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

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


class ImportRequest(BaseModel):
    """Request body for importing a project as a saga."""

    project_id: str = Field(description="External tracker project ID")
    repo: str = Field(description="Repository (org/repo)")
    feature_branch: str = Field(description="Feature branch name")


class SagaResponse(BaseModel):
    """Response for a created saga."""

    id: str
    tracker_id: str
    name: str
    repo: str
    feature_branch: str
    status: str
    phase_count: int
    raid_count: int


def create_tracker_router(tracker: TrackerPort) -> APIRouter:
    """Create FastAPI router for tracker browsing endpoints."""
    router = APIRouter(
        prefix="/api/tracker",
        tags=["Tracker"],
    )

    @router.get("/projects", response_model=list[TrackerProject])
    async def list_projects() -> list[TrackerProject]:
        """List all projects from the external tracker."""
        return await tracker.list_projects()

    @router.get("/projects/{project_id}", response_model=TrackerProject)
    async def get_project(project_id: str) -> TrackerProject:
        """Get a single project by ID."""
        try:
            return await tracker.get_project(project_id)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(exc),
            ) from exc

    @router.get(
        "/projects/{project_id}/milestones",
        response_model=list[TrackerMilestone],
    )
    async def list_milestones(project_id: str) -> list[TrackerMilestone]:
        """List milestones for a project."""
        return await tracker.list_milestones(project_id)

    @router.get(
        "/projects/{project_id}/issues",
        response_model=list[TrackerIssue],
    )
    async def list_issues(
        project_id: str,
        milestone_id: str | None = Query(default=None),
    ) -> list[TrackerIssue]:
        """List issues for a project, optionally filtered by milestone."""
        return await tracker.list_issues(project_id, milestone_id)

    @router.post("/import", response_model=SagaResponse)
    async def import_project(body: ImportRequest) -> SagaResponse:
        """Import a tracker project as a Saga with Phases and Raids.

        Creates local references to existing tracker entities.
        The tracker remains source of truth.
        """
        project = await tracker.get_project(body.project_id)
        milestones = await tracker.list_milestones(body.project_id)
        issues = await tracker.list_issues(body.project_id)

        now = datetime.now(UTC)
        saga_id = uuid4()

        saga = Saga(
            id=saga_id,
            tracker_id=project.id,
            tracker_type="linear",
            slug=project.name.lower().replace(" ", "-").replace("—", "-"),
            name=project.name,
            repo=body.repo,
            feature_branch=body.feature_branch,
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
            "Imported saga '%s' with %d phases and %d raids from tracker project %s",
            saga.name,
            len(phases),
            len(raids),
            project.id,
        )

        return SagaResponse(
            id=str(saga.id),
            tracker_id=saga.tracker_id,
            name=saga.name,
            repo=saga.repo,
            feature_branch=saga.feature_branch,
            status=saga.status.value,
            phase_count=len(phases),
            raid_count=len(raids),
        )

    return router
