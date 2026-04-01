"""Calibration & outcome override API endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.ports.reviewer_outcome_repository import (
    CalibrationSummary,
    ReviewerOutcomeRepository,
)

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class OutcomeOverrideRequest(BaseModel):
    actual_outcome: Literal["merged", "reverted", "abandoned"]
    notes: str | None = None


class CalibrationResponse(BaseModel):
    window_days: int
    total_decisions: int
    auto_approved: int
    retried: int
    escalated: int
    divergence_rate: float
    avg_confidence_approved: float
    avg_confidence_reverted: float
    pending_resolution: int


class OutcomeOverrideResponse(BaseModel):
    tracker_id: str
    actual_outcome: str
    resolved_count: int


class TyrConfigResponse(BaseModel):
    reviewer_system_prompt: str


class TyrConfigUpdateRequest(BaseModel):
    reviewer_system_prompt: str | None = None


# ---------------------------------------------------------------------------
# Dependency stubs (overridden in lifespan)
# ---------------------------------------------------------------------------


async def resolve_outcome_repo() -> ReviewerOutcomeRepository:
    raise RuntimeError("outcome_repo not wired")  # pragma: no cover


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_calibration_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr", tags=["Calibration"])

    @router.patch(
        "/raids/{tracker_id}/outcome",
        response_model=OutcomeOverrideResponse,
    )
    async def override_outcome(
        tracker_id: str,
        data: OutcomeOverrideRequest,
        principal: Principal = Depends(extract_principal),
        repo: ReviewerOutcomeRepository = Depends(resolve_outcome_repo),
    ) -> OutcomeOverrideResponse:
        """Manually override the actual outcome for a raid."""
        count = await repo.resolve_by_tracker_id(tracker_id, data.actual_outcome, data.notes)
        return OutcomeOverrideResponse(
            tracker_id=tracker_id,
            actual_outcome=data.actual_outcome,
            resolved_count=count,
        )

    @router.get(
        "/reviewer/calibration",
        response_model=CalibrationResponse,
    )
    async def get_calibration(
        request: Request,
        window_days: int = 30,
        principal: Principal = Depends(extract_principal),
        repo: ReviewerOutcomeRepository = Depends(resolve_outcome_repo),
    ) -> CalibrationResponse:
        """Return calibration summary statistics for the authenticated user."""
        summary: CalibrationSummary = await repo.calibration_summary(principal.user_id, window_days)
        return CalibrationResponse(
            window_days=summary.window_days,
            total_decisions=summary.total_decisions,
            auto_approved=summary.auto_approved,
            retried=summary.retried,
            escalated=summary.escalated,
            divergence_rate=summary.divergence_rate,
            avg_confidence_approved=summary.avg_confidence_approved,
            avg_confidence_reverted=summary.avg_confidence_reverted,
            pending_resolution=summary.pending_resolution,
        )

    @router.get("/config", response_model=TyrConfigResponse)
    async def get_tyr_config(
        request: Request,
        principal: Principal = Depends(extract_principal),
    ) -> TyrConfigResponse:
        """Return Tyr configuration (reviewer prompt etc.)."""
        settings = request.app.state.settings
        return TyrConfigResponse(
            reviewer_system_prompt=settings.review.reviewer_system_prompt,
        )

    @router.patch("/config", response_model=TyrConfigResponse)
    async def update_tyr_config(
        request: Request,
        data: TyrConfigUpdateRequest,
        principal: Principal = Depends(extract_principal),
    ) -> TyrConfigResponse:
        """Update Tyr configuration (reviewer prompt etc.)."""
        settings = request.app.state.settings
        if data.reviewer_system_prompt is not None:
            settings.review.reviewer_system_prompt = data.reviewer_system_prompt
        return TyrConfigResponse(
            reviewer_system_prompt=settings.review.reviewer_system_prompt,
        )

    return router
