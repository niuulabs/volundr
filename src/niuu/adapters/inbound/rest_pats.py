"""Shared FastAPI REST adapter for personal access token management.

Both Tyr and Volundr mount this router, each passing their own
``extract_principal`` auth dependency.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from niuu.domain.services.pat import PATService

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class CreatePATRequest(BaseModel):
    """Request model for creating a personal access token."""

    name: str = Field(
        min_length=1,
        max_length=100,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 _-]*$",
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


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_pats_router(
    extract_principal: Callable[..., Awaitable[Principal]],
    prefix: str = "/api/v1/users/tokens",
) -> APIRouter:
    """Create the personal access tokens router.

    Parameters
    ----------
    extract_principal:
        FastAPI-compatible dependency that returns a ``Principal``.
    prefix:
        URL prefix for the router (default ``/api/v1/users/tokens``).
    """
    router = APIRouter(
        prefix=prefix,
        tags=["Personal Access Tokens"],
    )

    @router.post(
        "",
        response_model=CreatePATResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_token(
        request: Request,
        body: CreatePATRequest,
        principal: Principal = Depends(extract_principal),
    ) -> CreatePATResponse:
        """Create a new personal access token. The raw token is shown once."""
        service: PATService = request.app.state.pat_service
        # Extract the user's current access token for IDP token exchange
        auth_header = request.headers.get("authorization", "")
        subject_token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
        pat, raw_token = await service.create(
            principal.user_id, body.name, subject_token=subject_token
        )
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
        request: Request,
        principal: Principal = Depends(extract_principal),
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
        request: Request,
        pat_id: str,
        principal: Principal = Depends(extract_principal),
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
