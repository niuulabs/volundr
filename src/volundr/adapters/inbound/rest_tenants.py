"""FastAPI REST adapter for tenant and user management."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import extract_principal, require_role
from volundr.domain.models import Principal, TenantRole, TenantTier
from volundr.domain.services.tenant import (
    TenantAlreadyExistsError,
    TenantNotFoundError,
    TenantService,
)

logger = logging.getLogger(__name__)


class TenantCreate(BaseModel):
    """Request model for creating a tenant."""

    name: str = Field(..., min_length=1, max_length=255)
    tenant_id: str | None = Field(default=None, max_length=100)
    parent_id: str | None = Field(default=None, max_length=100)
    tier: str = Field(default="developer")
    max_sessions: int = Field(default=5, ge=1)
    max_storage_gb: int = Field(default=50, ge=1)


class TenantResponse(BaseModel):
    """Response model for a tenant."""

    id: str
    path: str
    name: str
    parent_id: str | None
    tier: str
    max_sessions: int
    max_storage_gb: int
    created_at: str | None

    @classmethod
    def from_tenant(cls, t) -> TenantResponse:
        """Create a TenantResponse from a Tenant domain model."""
        return cls(
            id=t.id,
            path=t.path,
            name=t.name,
            parent_id=t.parent_id,
            tier=t.tier.value,
            max_sessions=t.max_sessions,
            max_storage_gb=t.max_storage_gb,
            created_at=t.created_at.isoformat() if t.created_at else None,
        )


class TenantUpdate(BaseModel):
    """Request model for updating tenant settings."""

    max_sessions: int | None = None
    max_storage_gb: int | None = None
    tier: str | None = None


class MemberCreate(BaseModel):
    """Request model for adding a tenant member."""

    user_id: str
    role: str = Field(default="volundr:developer")


class MemberResponse(BaseModel):
    """Response model for a tenant member."""

    user_id: str
    tenant_id: str
    role: str
    granted_at: str | None


class UserResponse(BaseModel):
    """Response model for a user."""

    id: str
    email: str
    display_name: str
    status: str
    home_pvc: str | None = None
    created_at: str | None


class MeResponse(BaseModel):
    """Response model for the current user."""

    user_id: str
    email: str
    tenant_id: str
    roles: list[str]
    display_name: str
    status: str


def create_tenants_router(tenant_service: TenantService) -> APIRouter:
    """Create the tenants router."""
    router = APIRouter(prefix="/api/v1/volundr", tags=["Tenants"])

    @router.get("/me", response_model=MeResponse, tags=["Identity"])
    async def get_me(principal: Principal = Depends(extract_principal)):
        """Get the current authenticated user's identity."""
        return MeResponse(
            user_id=principal.user_id,
            email=principal.email,
            tenant_id=principal.tenant_id,
            roles=principal.roles,
            display_name=principal.email.split("@")[0],
            status="active",
        )

    @router.get("/users", response_model=list[UserResponse], tags=["Users"])
    async def list_users(
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """List all users (admin only)."""
        users = await tenant_service.list_users()
        return [
            UserResponse(
                id=u.id,
                email=u.email,
                display_name=u.display_name,
                status=u.status.value,
                home_pvc=u.home_pvc,
                created_at=u.created_at.isoformat() if u.created_at else None,
            )
            for u in users
        ]

    @router.get("/tenants", response_model=list[TenantResponse])
    async def list_tenants(
        parent_id: str | None = None,
        _: Principal = Depends(extract_principal),
    ):
        """List tenants."""
        tenants = await tenant_service.list_tenants(parent_id)
        return [
            TenantResponse(
                id=t.id,
                path=t.path,
                name=t.name,
                parent_id=t.parent_id,
                tier=t.tier.value,
                max_sessions=t.max_sessions,
                max_storage_gb=t.max_storage_gb,
                created_at=t.created_at.isoformat() if t.created_at else None,
            )
            for t in tenants
        ]

    @router.post(
        "/tenants",
        response_model=TenantResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_tenant(
        body: TenantCreate,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Create a new tenant (admin only)."""
        try:
            tenant = await tenant_service.create_tenant(
                name=body.name,
                parent_id=body.parent_id,
                tenant_id=body.tenant_id,
                tier=TenantTier(body.tier),
                max_sessions=body.max_sessions,
                max_storage_gb=body.max_storage_gb,
            )
        except TenantAlreadyExistsError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
        except TenantNotFoundError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

        return TenantResponse(
            id=tenant.id,
            path=tenant.path,
            name=tenant.name,
            parent_id=tenant.parent_id,
            tier=tenant.tier.value,
            max_sessions=tenant.max_sessions,
            max_storage_gb=tenant.max_storage_gb,
            created_at=tenant.created_at.isoformat() if tenant.created_at else None,
        )

    @router.get("/tenants/{tenant_id}", response_model=TenantResponse)
    async def get_tenant(
        tenant_id: str,
        _: Principal = Depends(extract_principal),
    ):
        """Get a tenant by ID."""
        try:
            tenant = await tenant_service.get_tenant(tenant_id)
        except TenantNotFoundError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

        return TenantResponse(
            id=tenant.id,
            path=tenant.path,
            name=tenant.name,
            parent_id=tenant.parent_id,
            tier=tenant.tier.value,
            max_sessions=tenant.max_sessions,
            max_storage_gb=tenant.max_storage_gb,
            created_at=tenant.created_at.isoformat() if tenant.created_at else None,
        )

    @router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_tenant(
        tenant_id: str,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Delete a tenant (admin only)."""
        deleted = await tenant_service.delete_tenant(tenant_id)
        if not deleted:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    @router.get("/tenants/{tenant_id}/members", response_model=list[MemberResponse])
    async def list_members(
        tenant_id: str,
        _: Principal = Depends(extract_principal),
    ):
        """List members of a tenant."""
        members = await tenant_service.get_members(tenant_id)
        return [
            MemberResponse(
                user_id=m.user_id,
                tenant_id=m.tenant_id,
                role=m.role.value,
                granted_at=m.granted_at.isoformat() if m.granted_at else None,
            )
            for m in members
        ]

    @router.post(
        "/tenants/{tenant_id}/members",
        response_model=MemberResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def add_member(
        tenant_id: str,
        body: MemberCreate,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Add a member to a tenant (admin only)."""
        try:
            membership = await tenant_service.add_member(
                tenant_id=tenant_id,
                user_id=body.user_id,
                role=TenantRole(body.role),
            )
        except TenantNotFoundError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

        return MemberResponse(
            user_id=membership.user_id,
            tenant_id=membership.tenant_id,
            role=membership.role.value,
            granted_at=membership.granted_at.isoformat() if membership.granted_at else None,
        )

    @router.delete(
        "/tenants/{tenant_id}/members/{user_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def remove_member(
        tenant_id: str,
        user_id: str,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Remove a member from a tenant (admin only)."""
        removed = await tenant_service.remove_member(tenant_id, user_id)
        if not removed:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Membership not found",
            )

    @router.put(
        "/tenants/{tenant_id}",
        response_model=TenantResponse,
    )
    async def update_tenant(
        tenant_id: str,
        body: TenantUpdate,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Update tenant settings (admin only)."""
        try:
            tenant = await tenant_service.update_tenant_settings(
                tenant_id,
                max_sessions=body.max_sessions,
                max_storage_gb=body.max_storage_gb,
                tier=body.tier,
            )
        except TenantNotFoundError as e:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        return TenantResponse.from_tenant(tenant)

    @router.post(
        "/users/{user_id}/reprovision",
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def reprovision_user(
        user_id: str,
        request: Request,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Re-provision storage for a user (admin only)."""
        storage = getattr(request.app.state, "storage", None)
        result = await tenant_service.reprovision_user(user_id, storage=storage)
        return {
            "success": result.success,
            "user_id": result.user_id,
            "home_pvc": result.home_pvc,
            "errors": result.errors,
        }

    @router.post(
        "/tenants/{tenant_id}/reprovision",
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def reprovision_tenant(
        tenant_id: str,
        request: Request,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Re-provision storage for all users in a tenant (admin only)."""
        storage = getattr(request.app.state, "storage", None)
        results = await tenant_service.reprovision_tenant(tenant_id, storage=storage)
        return [
            {
                "success": r.success,
                "user_id": r.user_id,
                "home_pvc": r.home_pvc,
                "errors": r.errors,
            }
            for r in results
        ]

    return router
