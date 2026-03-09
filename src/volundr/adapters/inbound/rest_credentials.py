"""FastAPI REST adapter for credential management."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import extract_principal, require_role
from volundr.domain.models import Principal, SecretType
from volundr.domain.services.credential import CredentialService, CredentialValidationError

logger = logging.getLogger(__name__)


class CredentialCreate(BaseModel):
    """Request model for storing a credential."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        pattern=r"^[a-z0-9_-]+$",
    )
    secret_type: str = Field(default="generic")
    data: dict[str, str]
    metadata: dict[str, str] | None = None


class CredentialResponse(BaseModel):
    """Response model for a credential (metadata only, NEVER values)."""

    id: str
    name: str
    secret_type: str
    keys: list[str]
    metadata: dict
    created_at: str
    updated_at: str


class CredentialListResponse(BaseModel):
    """Response model for listing credentials."""

    credentials: list[CredentialResponse]


class SecretTypeInfoResponse(BaseModel):
    """Response model for a secret type definition."""

    type: str
    label: str
    description: str
    fields: list[dict]
    default_mount_type: str


def create_credentials_router(
    credential_service: CredentialService,
) -> APIRouter:
    """Create the credentials router."""
    router = APIRouter(
        prefix="/api/v1/volundr/credentials",
        tags=["Credentials"],
    )

    def _cred_to_response(cred) -> CredentialResponse:
        return CredentialResponse(
            id=cred.id,
            name=cred.name,
            secret_type=cred.secret_type.value,
            keys=list(cred.keys),
            metadata=cred.metadata,
            created_at=cred.created_at.isoformat(),
            updated_at=cred.updated_at.isoformat(),
        )

    # ------------------------------------------------------------------
    # Type info
    # ------------------------------------------------------------------

    @router.get(
        "/types",
        response_model=list[SecretTypeInfoResponse],
    )
    async def list_credential_types():
        """List available credential types with field info."""
        return credential_service.get_types()

    # ------------------------------------------------------------------
    # User credential endpoints
    # ------------------------------------------------------------------

    @router.get(
        "",
        response_model=CredentialListResponse,
    )
    async def list_credentials(
        secret_type: str | None = Query(None),
        principal: Principal = Depends(extract_principal),
    ):
        """List the current user's credentials (metadata only)."""
        st = SecretType(secret_type) if secret_type else None
        creds = await credential_service.list("user", principal.user_id, st)
        return CredentialListResponse(
            credentials=[_cred_to_response(c) for c in creds],
        )

    @router.get(
        "/{name}",
        response_model=CredentialResponse,
    )
    async def get_credential(
        name: str,
        principal: Principal = Depends(extract_principal),
    ):
        """Get a credential's metadata by name."""
        cred = await credential_service.get("user", principal.user_id, name)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Credential not found",
            )
        return _cred_to_response(cred)

    @router.post(
        "",
        response_model=CredentialResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_credential(
        body: CredentialCreate,
        principal: Principal = Depends(extract_principal),
    ):
        """Create a credential for the current user."""
        try:
            st = SecretType(body.secret_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid secret_type: {body.secret_type}",
            )

        try:
            cred = await credential_service.create(
                owner_type="user",
                owner_id=principal.user_id,
                name=body.name,
                secret_type=st,
                data=body.data,
                metadata=body.metadata,
            )
        except CredentialValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"errors": e.errors},
            )

        return _cred_to_response(cred)

    @router.delete(
        "/{name}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_credential(
        name: str,
        principal: Principal = Depends(extract_principal),
    ):
        """Delete a credential for the current user."""
        cred = await credential_service.get("user", principal.user_id, name)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Credential not found",
            )
        await credential_service.delete("user", principal.user_id, name)

    # ------------------------------------------------------------------
    # Tenant credential endpoints (admin only)
    # ------------------------------------------------------------------

    @router.get(
        "/tenant/list",
        response_model=CredentialListResponse,
    )
    async def list_tenant_credentials(
        secret_type: str | None = Query(None),
        principal: Principal = Depends(
            require_role("volundr:admin"),
        ),
    ):
        """List tenant shared credentials (admin only)."""
        st = SecretType(secret_type) if secret_type else None
        creds = await credential_service.list("tenant", principal.tenant_id, st)
        return CredentialListResponse(
            credentials=[_cred_to_response(c) for c in creds],
        )

    @router.post(
        "/tenant",
        response_model=CredentialResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_tenant_credential(
        body: CredentialCreate,
        principal: Principal = Depends(
            require_role("volundr:admin"),
        ),
    ):
        """Create a tenant shared credential (admin only)."""
        try:
            st = SecretType(body.secret_type)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid secret_type: {body.secret_type}",
            )

        try:
            cred = await credential_service.create(
                owner_type="tenant",
                owner_id=principal.tenant_id,
                name=body.name,
                secret_type=st,
                data=body.data,
                metadata=body.metadata,
            )
        except CredentialValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"errors": e.errors},
            )

        return _cred_to_response(cred)

    @router.delete(
        "/tenant/{name}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_tenant_credential(
        name: str,
        principal: Principal = Depends(
            require_role("volundr:admin"),
        ),
    ):
        """Delete a tenant shared credential (admin only)."""
        cred = await credential_service.get("tenant", principal.tenant_id, name)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Credential not found",
            )
        await credential_service.delete("tenant", principal.tenant_id, name)

    return router
