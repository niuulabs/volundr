"""REST API for raid review actions.

Provides endpoints for reviewing, approving, rejecting, and retrying raids
that are in the REVIEW state.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from tyr.config import ReviewConfig
from tyr.domain.exceptions import InvalidStateTransitionError
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    RaidStatus,
    validate_transition,
)
from tyr.ports.git import GitPort
from tyr.ports.raid_repository import RaidRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import VolundrPort

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Response / request models
# ---------------------------------------------------------------------------


class ConfidenceEventResponse(BaseModel):
    id: str
    event_type: str
    delta: float
    score_after: float
    created_at: str


class ReviewResponse(BaseModel):
    raid_id: str
    name: str
    status: str
    chronicle_summary: str | None = None
    pr_url: str | None = None
    ci_passed: bool | None = None
    confidence: float
    confidence_events: list[ConfidenceEventResponse] = Field(default_factory=list)


class RaidResponse(BaseModel):
    id: str
    name: str
    status: str
    confidence: float
    retry_count: int
    branch: str | None = None
    chronicle_summary: str | None = None
    reason: str | None = None


class RejectRequest(BaseModel):
    reason: str | None = None


# ---------------------------------------------------------------------------
# Dependency stubs -- overridden by main.py lifespan
# ---------------------------------------------------------------------------


async def resolve_raid_repo() -> RaidRepository:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Raid repository not configured",
    )


async def resolve_volundr() -> VolundrPort:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Volundr port not configured",
    )


async def resolve_git() -> GitPort:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Git port not configured",
    )


async def resolve_tracker() -> TrackerPort:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Tracker port not configured",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_review_config(request: Request) -> ReviewConfig:
    """Extract ReviewConfig from app settings, with fallback defaults."""
    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        return ReviewConfig()
    return settings.review


def _raid_response(raid, reason: str | None = None) -> RaidResponse:
    return RaidResponse(
        id=str(raid.id),
        name=raid.name,
        status=raid.status.value,
        confidence=raid.confidence,
        retry_count=raid.retry_count,
        branch=raid.branch,
        chronicle_summary=raid.chronicle_summary,
        reason=reason,
    )


def _make_confidence_event(
    raid_id: UUID,
    event_type: ConfidenceEventType,
    delta: float,
    current_score: float,
) -> ConfidenceEvent:
    new_score = max(0.0, min(1.0, current_score + delta))
    return ConfidenceEvent(
        id=uuid4(),
        raid_id=raid_id,
        event_type=event_type,
        delta=delta,
        score_after=new_score,
        created_at=datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_raids_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/raids", tags=["Raids"])

    @router.get("/{raid_id}/review", response_model=ReviewResponse)
    async def get_review(
        raid_id: UUID,
        raid_repo: RaidRepository = Depends(resolve_raid_repo),
        volundr: VolundrPort = Depends(resolve_volundr),
    ) -> ReviewResponse:
        """Get review state for a raid: chronicle summary, CI status, confidence."""
        raid = await raid_repo.get_raid(raid_id)
        if raid is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Raid not found: {raid_id}",
            )

        # Fetch PR/CI status from Volundr if a session exists
        pr_url: str | None = None
        ci_passed: bool | None = None
        if raid.session_id:
            try:
                pr_status = await volundr.get_pr_status(raid.session_id)
                pr_url = pr_status.pr_id
                ci_passed = pr_status.ci_passed
            except Exception:
                logger.warning(
                    "Failed to fetch PR status for session %s",
                    raid.session_id,
                    exc_info=True,
                )

        events = await raid_repo.get_confidence_events(raid_id)

        return ReviewResponse(
            raid_id=str(raid.id),
            name=raid.name,
            status=raid.status.value,
            chronicle_summary=raid.chronicle_summary,
            pr_url=pr_url,
            ci_passed=ci_passed,
            confidence=raid.confidence,
            confidence_events=[
                ConfidenceEventResponse(
                    id=str(e.id),
                    event_type=e.event_type.value,
                    delta=e.delta,
                    score_after=e.score_after,
                    created_at=e.created_at.isoformat(),
                )
                for e in events
            ],
        )

    @router.post("/{raid_id}/approve", response_model=RaidResponse)
    async def approve_raid(
        raid_id: UUID,
        request: Request,
        raid_repo: RaidRepository = Depends(resolve_raid_repo),
        volundr: VolundrPort = Depends(resolve_volundr),
        git: GitPort = Depends(resolve_git),
        tracker: TrackerPort = Depends(resolve_tracker),
    ) -> RaidResponse:
        """Approve a raid: merge branch, update state, check phase gate."""
        review_cfg = _get_review_config(request)

        raid = await raid_repo.get_raid(raid_id)
        if raid is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Raid not found: {raid_id}",
            )

        try:
            validate_transition(raid.status, RaidStatus.MERGED)
        except InvalidStateTransitionError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot approve raid in {raid.status.value} state",
            )

        saga = await raid_repo.get_saga_for_raid(raid_id)
        if saga is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent saga not found for raid",
            )

        # 1. Check CI status (warn but don't block)
        if raid.session_id:
            try:
                pr_status = await volundr.get_pr_status(raid.session_id)
                if pr_status.ci_passed is False:
                    logger.warning("Approving raid %s with failing CI", raid_id)
            except Exception:
                logger.warning(
                    "Could not verify CI status for raid %s",
                    raid_id,
                    exc_info=True,
                )

        # 2. Merge raid branch into feature branch
        if raid.branch and saga.repos:
            repo = saga.repos[0]
            try:
                await git.merge_branch(repo, raid.branch, saga.feature_branch)
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Branch merge failed: {exc}",
                )

            # 3. Clean up raid branch
            try:
                await git.delete_branch(repo, raid.branch)
            except Exception:
                logger.warning("Failed to delete branch %s", raid.branch, exc_info=True)

        # 4. Apply HUMAN_APPROVED confidence event
        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.HUMAN_APPROVED,
            review_cfg.confidence_delta_approved,
            raid.confidence,
        )
        await raid_repo.add_confidence_event(event)

        # 5. Update raid status to MERGED
        updated = await raid_repo.update_raid_status(raid_id, RaidStatus.MERGED)

        # 6. Update tracker
        try:
            await tracker.update_raid_state(raid.tracker_id, RaidStatus.MERGED)
            await tracker.close_raid(raid.tracker_id)
        except Exception:
            logger.warning("Failed to update tracker for raid %s", raid_id, exc_info=True)

        # 7. Check phase gate
        phase = await raid_repo.get_phase_for_raid(raid_id)
        if phase and await raid_repo.all_raids_merged(phase.id):
            logger.info("Phase gate unlocked -- all raids merged in phase %s", phase.id)

        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Raid disappeared during approve",
            )

        return _raid_response(updated)

    @router.post("/{raid_id}/reject", response_model=RaidResponse)
    async def reject_raid(
        raid_id: UUID,
        request: Request,
        body: RejectRequest | None = None,
        raid_repo: RaidRepository = Depends(resolve_raid_repo),
        tracker: TrackerPort = Depends(resolve_tracker),
    ) -> RaidResponse:
        """Reject a raid: set FAILED, record reason, apply confidence penalty."""
        review_cfg = _get_review_config(request)

        raid = await raid_repo.get_raid(raid_id)
        if raid is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Raid not found: {raid_id}",
            )

        try:
            validate_transition(raid.status, RaidStatus.FAILED)
        except InvalidStateTransitionError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot reject raid in {raid.status.value} state",
            )

        reason = body.reason if body else None

        # Apply HUMAN_REJECT confidence event
        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.HUMAN_REJECT,
            review_cfg.confidence_delta_rejected,
            raid.confidence,
        )
        await raid_repo.add_confidence_event(event)

        # Update status
        updated = await raid_repo.update_raid_status(
            raid_id,
            RaidStatus.FAILED,
            reason=reason,
        )

        # Update tracker
        try:
            await tracker.update_raid_state(raid.tracker_id, RaidStatus.FAILED)
        except Exception:
            logger.warning("Failed to update tracker for raid %s", raid_id, exc_info=True)

        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Raid disappeared during reject",
            )

        return _raid_response(updated, reason=reason)

    @router.post("/{raid_id}/retry", response_model=RaidResponse)
    async def retry_raid(
        raid_id: UUID,
        request: Request,
        raid_repo: RaidRepository = Depends(resolve_raid_repo),
        tracker: TrackerPort = Depends(resolve_tracker),
    ) -> RaidResponse:
        """Retry a raid: reset to PENDING, increment retry_count."""
        review_cfg = _get_review_config(request)

        raid = await raid_repo.get_raid(raid_id)
        if raid is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Raid not found: {raid_id}",
            )

        try:
            validate_transition(raid.status, RaidStatus.PENDING)
        except InvalidStateTransitionError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot retry raid in {raid.status.value} state",
            )

        # Apply RETRY confidence event
        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.RETRY,
            review_cfg.confidence_delta_retry,
            raid.confidence,
        )
        await raid_repo.add_confidence_event(event)

        # Reset to PENDING with incremented retry_count
        updated = await raid_repo.update_raid_status(
            raid_id,
            RaidStatus.PENDING,
            increment_retry=True,
        )

        # Update tracker
        try:
            await tracker.update_raid_state(raid.tracker_id, RaidStatus.PENDING)
        except Exception:
            logger.warning("Failed to update tracker for raid %s", raid_id, exc_info=True)

        if updated is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Raid disappeared during retry",
            )

        return _raid_response(updated)

    return router
