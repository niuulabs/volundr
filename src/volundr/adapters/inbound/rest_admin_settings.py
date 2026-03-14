"""FastAPI REST adapter for admin settings."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import require_role
from volundr.domain.models import Principal

logger = logging.getLogger(__name__)


class AdminStorageSettings(BaseModel):
    """Response/request model for storage settings."""

    home_enabled: bool = Field(
        description="Whether home PVC provisioning is enabled for users",
    )


class AdminSettingsResponse(BaseModel):
    """Full admin settings response."""

    storage: AdminStorageSettings = Field(
        description="Storage-related settings",
    )


class AdminSettingsUpdate(BaseModel):
    """Request model for updating admin settings."""

    storage: AdminStorageSettings | None = Field(
        default=None,
        description="Storage settings to update (null to skip)",
    )


def create_admin_settings_router() -> APIRouter:
    """Create the admin settings router."""
    router = APIRouter(prefix="/api/v1/volundr", tags=["Admin Settings"])

    @router.get("/admin/settings", response_model=AdminSettingsResponse)
    async def get_admin_settings(
        request: Request,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Get admin settings (admin only)."""
        settings = request.app.state.admin_settings
        return AdminSettingsResponse(
            storage=AdminStorageSettings(
                home_enabled=settings.get("storage", {}).get("home_enabled", True),
            ),
        )

    @router.put("/admin/settings", response_model=AdminSettingsResponse)
    async def update_admin_settings(
        body: AdminSettingsUpdate,
        request: Request,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Update admin settings (admin only)."""
        settings = request.app.state.admin_settings
        if body.storage is not None:
            settings.setdefault("storage", {})["home_enabled"] = body.storage.home_enabled
            logger.info(
                "Admin updated storage.home_enabled to %s",
                body.storage.home_enabled,
            )
        return AdminSettingsResponse(
            storage=AdminStorageSettings(
                home_enabled=settings.get("storage", {}).get("home_enabled", True),
            ),
        )

    return router
