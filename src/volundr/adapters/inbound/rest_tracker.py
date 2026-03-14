"""FastAPI REST adapter for issue tracker integration."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.domain.models import ProjectMapping, TrackerConnectionStatus, TrackerIssue
from volundr.domain.services.tracker import (
    TrackerIssueNotFoundError,
    TrackerMappingNotFoundError,
    TrackerService,
)

logger = logging.getLogger(__name__)


# --- Request/Response models ---


class IssueResponse(BaseModel):
    """Response model for a tracker issue."""

    id: str = Field(description="Unique issue identifier")
    identifier: str = Field(
        description="Human-readable issue key (e.g. PROJ-123)",
    )
    title: str = Field(description="Issue title")
    status: str = Field(
        description="Current issue status (e.g. In Progress)",
    )
    assignee: str | None = Field(
        description="Assigned user, if any",
    )
    labels: list[str] = Field(
        description="Labels attached to the issue",
    )
    priority: int = Field(
        description="Priority level (lower is higher priority)",
    )
    url: str = Field(description="URL to the issue in the tracker")

    @classmethod
    def from_issue(cls, issue: TrackerIssue) -> IssueResponse:
        """Create response from domain model."""
        return cls(
            id=issue.id,
            identifier=issue.identifier,
            title=issue.title,
            status=issue.status,
            assignee=issue.assignee,
            labels=issue.labels,
            priority=issue.priority,
            url=issue.url,
        )


class StatusResponse(BaseModel):
    """Response model for tracker connection status."""

    connected: bool = Field(
        description="Whether the tracker is connected",
    )
    provider: str = Field(
        description="Tracker provider name (e.g. linear)",
    )
    workspace: str | None = Field(
        description="Connected workspace or organization",
    )
    user: str | None = Field(
        description="Authenticated tracker user",
    )

    @classmethod
    def from_status(cls, s: TrackerConnectionStatus) -> StatusResponse:
        """Create response from domain model."""
        return cls(
            connected=s.connected,
            provider=s.provider,
            workspace=s.workspace,
            user=s.user,
        )


class IssueStatusUpdate(BaseModel):
    """Request model for updating an issue's status."""

    status: str = Field(
        ...,
        min_length=1,
        description="New status value for the issue",
    )


class MappingCreate(BaseModel):
    """Request model for creating a project mapping."""

    repo_url: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Git repository URL to map",
    )
    project_id: str = Field(
        ...,
        min_length=1,
        description="Tracker project identifier",
    )
    project_name: str = Field(
        default="",
        description="Human-readable project name",
    )


class MappingResponse(BaseModel):
    """Response model for a project mapping."""

    id: UUID = Field(description="Unique mapping identifier")
    repo_url: str = Field(description="Mapped git repository URL")
    project_id: str = Field(
        description="Tracker project identifier",
    )
    project_name: str = Field(
        description="Human-readable project name",
    )
    created_at: str = Field(
        description="ISO 8601 creation timestamp",
    )

    @classmethod
    def from_mapping(cls, m: ProjectMapping) -> MappingResponse:
        """Create response from domain model."""
        return cls(
            id=m.id,
            repo_url=m.repo_url,
            project_id=m.project_id,
            project_name=m.project_name,
            created_at=m.created_at.isoformat(),
        )


class ErrorResponse(BaseModel):
    """Response model for errors."""

    detail: str = Field(
        description="Human-readable error message",
    )


# --- Router factory ---


def create_tracker_router(tracker_service: TrackerService) -> APIRouter:
    """Create FastAPI router for issue tracker endpoints."""
    router = APIRouter(prefix="/api/v1/volundr/tracker")

    @router.get(
        "/status",
        response_model=StatusResponse,
        tags=["Issue Tracker"],
    )
    async def get_status() -> StatusResponse:
        """Check the connection to the issue tracker."""
        status_result = await tracker_service.check_connection()
        return StatusResponse.from_status(status_result)

    @router.get(
        "/issues",
        response_model=list[IssueResponse],
        tags=["Issue Tracker"],
    )
    async def search_issues(
        q: str = Query(
            ...,
            min_length=1,
            description="Search query string",
        ),
        project_id: str | None = Query(
            default=None,
            description="Filter by tracker project ID",
        ),
    ) -> list[IssueResponse]:
        """Search issues by query string."""
        issues = await tracker_service.search_issues(
            query=q,
            project_id=project_id,
        )
        return [IssueResponse.from_issue(i) for i in issues]

    @router.get(
        "/issues/recent",
        response_model=list[IssueResponse],
        tags=["Issue Tracker"],
    )
    async def get_recent_issues(
        project_id: str = Query(
            ...,
            description="Tracker project ID",
        ),
        limit: int = Query(
            default=10,
            ge=1,
            le=100,
            description="Maximum number of issues to return",
        ),
    ) -> list[IssueResponse]:
        """Get recent issues for a project."""
        issues = await tracker_service.get_recent_issues(
            project_id=project_id,
            limit=limit,
        )
        return [IssueResponse.from_issue(i) for i in issues]

    @router.patch(
        "/issues/{issue_id}",
        response_model=IssueResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Issue Tracker"],
    )
    async def update_issue(
        issue_id: str,
        data: IssueStatusUpdate,
    ) -> IssueResponse:
        """Update the status of an issue."""
        try:
            issue = await tracker_service.update_issue_status(
                issue_id=issue_id,
                status=data.status,
            )
            return IssueResponse.from_issue(issue)
        except TrackerIssueNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Issue not found: {issue_id}",
            )

    @router.get(
        "/mappings",
        response_model=list[MappingResponse],
        tags=["Issue Tracker"],
    )
    async def list_mappings() -> list[MappingResponse]:
        """List all project mappings."""
        mappings = await tracker_service.list_mappings()
        return [MappingResponse.from_mapping(m) for m in mappings]

    @router.post(
        "/mappings",
        response_model=MappingResponse,
        status_code=status.HTTP_201_CREATED,
        tags=["Issue Tracker"],
    )
    async def create_mapping(data: MappingCreate) -> MappingResponse:
        """Create a new project mapping."""
        mapping = await tracker_service.create_mapping(
            repo_url=data.repo_url,
            project_id=data.project_id,
            project_name=data.project_name,
        )
        return MappingResponse.from_mapping(mapping)

    @router.delete(
        "/mappings/{mapping_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={404: {"model": ErrorResponse}},
        tags=["Issue Tracker"],
    )
    async def delete_mapping(mapping_id: UUID) -> None:
        """Delete a project mapping."""
        try:
            await tracker_service.delete_mapping(mapping_id)
        except TrackerMappingNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Mapping not found: {mapping_id}",
            )

    return router
