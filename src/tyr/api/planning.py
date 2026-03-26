"""REST API for interactive planning sessions.

Provides endpoints for spawning, messaging, and capturing saga structures
from conversational decomposition sessions.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.domain.services.planning_session import (
    InvalidPlanningStateError,
    PlanningSessionNotFoundError,
    PlanningSessionService,
    SessionLimitReachedError,
)
from tyr.domain.validation import ValidationError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SpawnPlanningRequest(BaseModel):
    spec: str = Field(min_length=1)
    repo: str = Field(min_length=1)


class SendPlanningMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=32768)


class ProposeStructureRequest(BaseModel):
    raw_json: str = Field(min_length=1)


class RaidSpecResponse(BaseModel):
    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float
    confidence: float


class PhaseSpecResponse(BaseModel):
    name: str
    raids: list[RaidSpecResponse]


class StructureResponse(BaseModel):
    name: str
    phases: list[PhaseSpecResponse]


class PlanningSessionResponse(BaseModel):
    id: str
    owner_id: str
    session_id: str
    repo: str
    status: str
    structure: StructureResponse | None = None
    created_at: str
    updated_at: str


class PlanningMessageResponse(BaseModel):
    id: str
    content: str
    sender: str
    created_at: str


# ---------------------------------------------------------------------------
# Dependency stubs — overridden by main.py lifespan
# ---------------------------------------------------------------------------


async def resolve_planning_service() -> PlanningSessionService:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Planning service not configured",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _session_response(session) -> PlanningSessionResponse:  # noqa: ANN001
    structure = None
    if session.structure is not None:
        structure = StructureResponse(
            name=session.structure.name,
            phases=[
                PhaseSpecResponse(
                    name=p.name,
                    raids=[
                        RaidSpecResponse(
                            name=r.name,
                            description=r.description,
                            acceptance_criteria=r.acceptance_criteria,
                            declared_files=r.declared_files,
                            estimate_hours=r.estimate_hours,
                            confidence=r.confidence,
                        )
                        for r in p.raids
                    ],
                )
                for p in session.structure.phases
            ],
        )
    return PlanningSessionResponse(
        id=str(session.id),
        owner_id=session.owner_id,
        session_id=session.session_id,
        repo=session.repo,
        status=session.status.value,
        structure=structure,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_planning_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/planning", tags=["Planning"])

    @router.post("/sessions", response_model=PlanningSessionResponse, status_code=201)
    async def spawn_planning_session(
        body: SpawnPlanningRequest,
        request: Request,
        principal: Principal = Depends(extract_principal),
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> PlanningSessionResponse:
        """Spawn an interactive planning session."""
        raw_header = request.headers.get("Authorization", "")
        auth_token = raw_header.removeprefix("Bearer ").strip() or None
        try:
            session = await svc.spawn(
                owner_id=principal.user_id,
                spec=body.spec,
                repo=body.repo,
                auth_token=auth_token,
            )
        except SessionLimitReachedError as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
            )
        return _session_response(session)

    @router.get("/sessions", response_model=list[PlanningSessionResponse])
    async def list_planning_sessions(
        principal: Principal = Depends(extract_principal),
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> list[PlanningSessionResponse]:
        """List planning sessions for the current user."""
        sessions = await svc.list_sessions(principal.user_id)
        return [_session_response(s) for s in sessions]

    @router.get("/sessions/{session_id}", response_model=PlanningSessionResponse)
    async def get_planning_session(
        session_id: UUID,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> PlanningSessionResponse:
        """Get a planning session by ID."""
        session = await svc.get(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )
        return _session_response(session)

    @router.post(
        "/sessions/{session_id}/messages",
        response_model=PlanningMessageResponse,
    )
    async def send_planning_message(
        session_id: UUID,
        body: SendPlanningMessageRequest,
        request: Request,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> PlanningMessageResponse:
        """Send a message to a planning session."""
        raw_header = request.headers.get("Authorization", "")
        auth_token = raw_header.removeprefix("Bearer ").strip() or None
        try:
            msg = await svc.send_message(
                session_id,
                body.content,
                auth_token=auth_token,
            )
        except PlanningSessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )
        except InvalidPlanningStateError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            )
        return PlanningMessageResponse(
            id=str(msg.id),
            content=msg.content,
            sender=msg.sender,
            created_at=msg.created_at.isoformat(),
        )

    @router.get(
        "/sessions/{session_id}/messages",
        response_model=list[PlanningMessageResponse],
    )
    async def list_planning_messages(
        session_id: UUID,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> list[PlanningMessageResponse]:
        """List all messages in a planning session."""
        try:
            messages = await svc.get_messages(session_id)
        except PlanningSessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )
        return [
            PlanningMessageResponse(
                id=str(m.id),
                content=m.content,
                sender=m.sender,
                created_at=m.created_at.isoformat(),
            )
            for m in messages
        ]

    @router.post(
        "/sessions/{session_id}/structure",
        response_model=PlanningSessionResponse,
    )
    async def propose_structure(
        session_id: UUID,
        body: ProposeStructureRequest,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> PlanningSessionResponse:
        """Submit a proposed SagaStructure from the planning conversation."""
        try:
            session = await svc.propose_structure(session_id, body.raw_json)
        except PlanningSessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )
        except InvalidPlanningStateError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            )
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Invalid saga structure: {exc}",
            )
        return _session_response(session)

    @router.post(
        "/sessions/{session_id}/complete",
        response_model=PlanningSessionResponse,
    )
    async def complete_planning_session(
        session_id: UUID,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> PlanningSessionResponse:
        """Mark a planning session as completed (accept the proposed structure)."""
        try:
            session = await svc.complete(session_id)
        except PlanningSessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )
        except InvalidPlanningStateError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            )
        return _session_response(session)

    @router.delete("/sessions/{session_id}", status_code=204)
    async def delete_planning_session(
        session_id: UUID,
        svc: PlanningSessionService = Depends(resolve_planning_service),
    ) -> None:
        """Delete a planning session."""
        deleted = await svc.delete(session_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Planning session not found: {session_id}",
            )

    return router
