"""FastAPI REST adapter for generic issue search/get/update across connected trackers."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import extract_principal
from volundr.domain.models import IntegrationType, Principal, TrackerIssue
from volundr.domain.ports import IntegrationRepository
from volundr.domain.services.tracker_factory import TrackerFactory

logger = logging.getLogger(__name__)


class StatusUpdateRequest(BaseModel):
    """Request body for updating an issue status."""

    status: str = Field(
        min_length=1,
        description="New status for the issue",
        examples=["In Progress"],
    )


def create_issues_router(
    integration_repo: IntegrationRepository,
    tracker_factory: TrackerFactory,
) -> APIRouter:
    """Create FastAPI router for generic issue endpoints."""
    router = APIRouter(
        prefix="/api/v1/volundr/issues",
        tags=["Issues"],
    )

    @router.get(
        "/search",
        response_model=list[TrackerIssue],
    )
    async def search_issues(
        q: str = Query(description="Search query", min_length=1),
        principal: Principal = Depends(extract_principal),
    ) -> list[TrackerIssue]:
        """Search issues across all connected issue trackers."""
        connections = await integration_repo.list_connections(
            principal.user_id,
            integration_type=IntegrationType.ISSUE_TRACKER,
        )
        if not connections:
            return []

        results: list[TrackerIssue] = []
        for conn in connections:
            if not conn.enabled:
                continue
            try:
                adapter = await tracker_factory.create(conn)
                issues = await adapter.search_issues(q)
                results.extend(issues)
            except Exception:
                logger.warning(
                    "Issue search failed for connection %s",
                    conn.id,
                    exc_info=True,
                )
        return results

    @router.get(
        "/{issue_id}",
        response_model=TrackerIssue,
    )
    async def get_issue(
        issue_id: str,
        principal: Principal = Depends(extract_principal),
    ) -> TrackerIssue:
        """Get a single issue by ID, searching across connected trackers."""
        connections = await integration_repo.list_connections(
            principal.user_id,
            integration_type=IntegrationType.ISSUE_TRACKER,
        )
        for conn in connections:
            if not conn.enabled:
                continue
            try:
                adapter = await tracker_factory.create(conn)
                issue = await adapter.get_issue(issue_id)
                if issue is not None:
                    return issue
            except Exception:
                logger.warning(
                    "Issue get failed for connection %s",
                    conn.id,
                    exc_info=True,
                )

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue not found: {issue_id}",
        )

    @router.post(
        "/{issue_id}/status",
        response_model=TrackerIssue,
    )
    async def update_issue_status(
        issue_id: str,
        data: StatusUpdateRequest,
        principal: Principal = Depends(extract_principal),
    ) -> TrackerIssue:
        """Update the status of an issue."""
        connections = await integration_repo.list_connections(
            principal.user_id,
            integration_type=IntegrationType.ISSUE_TRACKER,
        )
        for conn in connections:
            if not conn.enabled:
                continue
            try:
                adapter = await tracker_factory.create(conn)
                issue = await adapter.get_issue(issue_id)
                if issue is not None:
                    updated = await adapter.update_issue_status(issue_id, data.status)
                    return updated
            except Exception:
                logger.warning(
                    "Issue status update failed for connection %s",
                    conn.id,
                    exc_info=True,
                )

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue not found: {issue_id}",
        )

    return router
