"""Dedicated saga phase endpoints for Tyr."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.api.sagas import resolve_saga_repo
from tyr.ports.saga_repository import SagaRepository


class RaidPhaseItemResponse(BaseModel):
    id: str
    phase_id: str
    tracker_id: str
    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float | None
    status: str
    confidence: float
    session_id: str | None = None
    reviewer_session_id: str | None = None
    review_round: int = 0
    branch: str | None = None
    chronicle_summary: str | None = None
    retry_count: int = 0
    created_at: datetime
    updated_at: datetime


class SagaPhaseItemResponse(BaseModel):
    id: str
    saga_id: str
    tracker_id: str
    number: int
    name: str
    status: str
    confidence: float
    raids: list[RaidPhaseItemResponse]


def create_saga_phases_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/sagas", tags=["Sagas"])

    @router.get("/{saga_id}/phases", response_model=list[SagaPhaseItemResponse])
    async def get_saga_phases(
        saga_id: str,
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
    ) -> list[SagaPhaseItemResponse]:
        """Return persisted saga phases and raids in the shape expected by web-next."""
        try:
            parsed_saga_id = UUID(saga_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Saga not found: {saga_id}",
            ) from exc

        saga = await repo.get_saga(parsed_saga_id, owner_id=principal.user_id)
        if saga is None:
            raise HTTPException(
                status_code=404,
                detail=f"Saga not found: {saga_id}",
            )

        phases = await repo.get_phases_by_saga(parsed_saga_id)
        responses: list[SagaPhaseItemResponse] = []
        for phase in phases:
            raids = await repo.get_raids_by_phase(phase.id)
            responses.append(
                SagaPhaseItemResponse(
                    id=str(phase.id),
                    saga_id=str(phase.saga_id),
                    tracker_id=phase.tracker_id,
                    number=phase.number,
                    name=phase.name,
                    status=phase.status.value.lower(),
                    confidence=phase.confidence,
                    raids=[
                        RaidPhaseItemResponse(
                            id=str(raid.id),
                            phase_id=str(raid.phase_id),
                            tracker_id=raid.tracker_id,
                            name=raid.name,
                            description=raid.description,
                            acceptance_criteria=raid.acceptance_criteria,
                            declared_files=raid.declared_files,
                            estimate_hours=raid.estimate_hours,
                            status=raid.status.value.lower(),
                            confidence=raid.confidence,
                            session_id=raid.session_id,
                            reviewer_session_id=raid.reviewer_session_id,
                            review_round=raid.review_round,
                            branch=raid.branch,
                            chronicle_summary=raid.chronicle_summary,
                            retry_count=raid.retry_count,
                            created_at=raid.created_at,
                            updated_at=raid.updated_at,
                        )
                        for raid in raids
                    ],
                )
            )
        return responses

    return router
