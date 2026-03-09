"""FastAPI REST adapter for git workflow operations."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.domain.models import PullRequest
from volundr.domain.services.git_workflow import (
    GitWorkflowService,
    SessionNotFoundError,
)

logger = logging.getLogger(__name__)


# --- Request models ---


class PRCreateRequest(BaseModel):
    """Request to create a PR from a session."""

    session_id: UUID
    title: str | None = None
    target_branch: str = "main"


class PRMergeRequest(BaseModel):
    """Request to merge a PR."""

    merge_method: str = "squash"


class ConfidenceRequest(BaseModel):
    """Request to calculate merge confidence."""

    tests_pass: bool
    coverage_delta: float = Field(default=0.0)
    lines_changed: int
    files_changed: int
    has_dependency_changes: bool = False
    change_categories: list[str] = Field(default_factory=list)


# --- Response models ---


class PullRequestResponse(BaseModel):
    """Response model for a pull request."""

    number: int
    title: str
    url: str
    repo_url: str
    provider: str
    source_branch: str
    target_branch: str
    status: str
    description: str | None = None
    ci_status: str | None = None
    review_status: str | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_pull_request(cls, pr: PullRequest) -> PullRequestResponse:
        """Create response from domain model."""
        return cls(
            number=pr.number,
            title=pr.title,
            url=pr.url,
            repo_url=pr.repo_url,
            provider=pr.provider.value,
            source_branch=pr.source_branch,
            target_branch=pr.target_branch,
            status=pr.status.value,
            description=pr.description,
            ci_status=pr.ci_status.value if pr.ci_status else None,
            review_status=pr.review_status.value if pr.review_status else None,
            created_at=pr.created_at.isoformat() if pr.created_at else None,
            updated_at=pr.updated_at.isoformat() if pr.updated_at else None,
        )


class MergeConfidenceResponse(BaseModel):
    """Response model for merge confidence scoring."""

    score: float
    factors: dict[str, float]
    action: str
    reason: str


class CIStatusResponse(BaseModel):
    """Response model for CI status."""

    status: str


class MergeResultResponse(BaseModel):
    """Response model for merge result."""

    merged: bool


class ErrorResponse(BaseModel):
    """Response model for errors."""

    detail: str


# --- Router factory ---


def create_git_router(
    git_workflow_service: GitWorkflowService,
) -> APIRouter:
    """Create FastAPI router for git workflow endpoints."""
    router = APIRouter(prefix="/api/v1/volundr")

    @router.post(
        "/repos/prs",
        response_model=PullRequestResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            404: {"model": ErrorResponse},
            400: {"model": ErrorResponse},
        },
        tags=["Repositories"],
    )
    async def create_pr(request: PRCreateRequest) -> PullRequestResponse:
        """Create a pull request from a session."""
        try:
            pr = await git_workflow_service.create_pr_from_session(
                session_id=request.session_id,
                title=request.title,
                target_branch=request.target_branch,
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {request.session_id}",
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        except RuntimeError as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(e),
            )
        return PullRequestResponse.from_pull_request(pr)

    @router.get(
        "/repos/prs",
        response_model=list[PullRequestResponse],
        tags=["Repositories"],
    )
    async def list_prs(
        repo_url: str = Query(..., description="Repository URL"),
        status_filter: str = Query(
            default="open",
            alias="status",
            description="Filter by status (open, closed, merged, all)",
        ),
    ) -> list[PullRequestResponse]:
        """List pull requests for a repository."""
        try:
            prs = await git_workflow_service.list_prs(repo_url, status_filter)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        return [PullRequestResponse.from_pull_request(pr) for pr in prs]

    @router.get(
        "/repos/prs/{pr_number}",
        response_model=PullRequestResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Repositories"],
    )
    async def get_pr(
        pr_number: int,
        repo_url: str = Query(..., description="Repository URL"),
    ) -> PullRequestResponse:
        """Get a pull request by number."""
        try:
            pr = await git_workflow_service.get_pr(repo_url, pr_number)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        if pr is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"PR #{pr_number} not found in {repo_url}",
            )
        return PullRequestResponse.from_pull_request(pr)

    @router.post(
        "/repos/prs/{pr_number}/merge",
        response_model=MergeResultResponse,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Repositories"],
    )
    async def merge_pr(
        pr_number: int,
        request: PRMergeRequest,
        repo_url: str = Query(..., description="Repository URL"),
    ) -> MergeResultResponse:
        """Merge a pull request."""
        try:
            merged = await git_workflow_service.merge_pr(repo_url, pr_number, request.merge_method)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        if not merged:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Failed to merge PR #{pr_number} — check CI status and reviews",
            )
        return MergeResultResponse(merged=True)

    @router.get(
        "/repos/prs/{pr_number}/ci",
        response_model=CIStatusResponse,
        tags=["Repositories"],
    )
    async def get_ci_status(
        pr_number: int,
        repo_url: str = Query(..., description="Repository URL"),
        branch: str = Query(..., description="Branch name"),
    ) -> CIStatusResponse:
        """Get CI status for a branch."""
        try:
            ci_status = await git_workflow_service.get_ci_status(repo_url, branch)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )
        return CIStatusResponse(status=ci_status.value)

    @router.post(
        "/repos/confidence",
        response_model=MergeConfidenceResponse,
        tags=["Repositories"],
    )
    async def calculate_confidence(
        request: ConfidenceRequest,
    ) -> MergeConfidenceResponse:
        """Calculate merge confidence for a set of changes."""
        result = git_workflow_service.calculate_confidence(
            tests_pass=request.tests_pass,
            coverage_delta=request.coverage_delta,
            lines_changed=request.lines_changed,
            files_changed=request.files_changed,
            has_dependency_changes=request.has_dependency_changes,
            change_categories=request.change_categories,
        )
        return MergeConfidenceResponse(
            score=result.score,
            factors=result.factors,
            action=result.action,
            reason=result.reason,
        )

    return router
