"""REST API for dispatcher state — get and update per-user dispatcher config."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.ports.dispatcher_repository import DispatcherRepository

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class DispatcherStateResponse(BaseModel):
    id: str
    running: bool
    threshold: float
    max_concurrent_raids: int
    updated_at: datetime


class PatchDispatcherRequest(BaseModel):
    running: bool | None = None
    threshold: float | None = Field(None, ge=0.0, le=1.0)
    max_concurrent_raids: int | None = Field(None, ge=1, le=20)


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


async def resolve_dispatcher_repo() -> DispatcherRepository:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Dispatcher repository not configured",
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_dispatcher_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/dispatcher", tags=["Dispatcher"])

    @router.get("", response_model=DispatcherStateResponse)
    async def get_dispatcher_state(
        principal: Principal = Depends(extract_principal),
        repo: DispatcherRepository = Depends(resolve_dispatcher_repo),
    ) -> DispatcherStateResponse:
        """Return the dispatcher state for the authenticated user, creating a default if needed."""
        state = await repo.get_or_create(principal.user_id)
        return DispatcherStateResponse(
            id=str(state.id),
            running=state.running,
            threshold=state.threshold,
            max_concurrent_raids=state.max_concurrent_raids,
            updated_at=state.updated_at,
        )

    @router.patch("", response_model=DispatcherStateResponse)
    async def patch_dispatcher_state(
        body: PatchDispatcherRequest,
        principal: Principal = Depends(extract_principal),
        repo: DispatcherRepository = Depends(resolve_dispatcher_repo),
    ) -> DispatcherStateResponse:
        """Partially update the dispatcher state for the authenticated user."""
        updates = body.model_dump(exclude_none=True)
        state = await repo.update(principal.user_id, **updates)
        return DispatcherStateResponse(
            id=str(state.id),
            running=state.running,
            threshold=state.threshold,
            max_concurrent_raids=state.max_concurrent_raids,
            updated_at=state.updated_at,
        )

    return router
