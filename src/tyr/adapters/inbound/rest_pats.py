"""FastAPI REST adapter for personal access token management."""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.domain.services.pat import PATService

logger = logging.getLogger(__name__)


class CreatePATRequest(BaseModel):
    """Request model for creating a personal access token."""

    name: str = Field(
        min_length=1,
        max_length=100,
        description="Human-readable label for the token",
    )


class PATResponse(BaseModel):
    """Response model for a personal access token (no raw token)."""

    id: str
    name: str
    created_at: datetime
    last_used_at: datetime | None


class CreatePATResponse(BaseModel):
    """Response model returned once on creation (includes raw token)."""

    id: str
    name: str
    token: str
    created_at: datetime


def create_pats_router() -> APIRouter:
    """Create the personal access tokens router."""
    router = APIRouter(
        prefix="/api/v1/users/tokens",
        tags=["Personal Access Tokens"],
    )

    @router.post(
        "",
        response_model=CreatePATResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_token(
        body: CreatePATRequest,
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> CreatePATResponse:
        """Create a new personal access token. The raw token is shown once."""
        service: PATService = request.app.state.pat_service
        pat, raw_token = await service.create(principal.user_id, body.name)
        return CreatePATResponse(
            id=str(pat.id),
            name=pat.name,
            token=raw_token,
            created_at=pat.created_at,
        )

    @router.get(
        "",
        response_model=list[PATResponse],
    )
    async def list_tokens(
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> list[PATResponse]:
        """List all personal access tokens for the authenticated user."""
        service: PATService = request.app.state.pat_service
        pats = await service.list(principal.user_id)
        return [
            PATResponse(
                id=str(pat.id),
                name=pat.name,
                created_at=pat.created_at,
                last_used_at=pat.last_used_at,
            )
            for pat in pats
        ]

    @router.delete(
        "/{pat_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def revoke_token(
        pat_id: str,
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> None:
        """Revoke a personal access token by ID."""
        service: PATService = request.app.state.pat_service
        try:
            parsed_id = UUID(pat_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"PAT not found: {pat_id}",
            )
        deleted = await service.revoke(parsed_id, principal.user_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"PAT not found: {pat_id}",
            )

    return router
