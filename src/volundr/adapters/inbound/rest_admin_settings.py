"""FastAPI REST adapter for admin settings."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_serializer

from niuu.http_compat import LegacyRouteNotice, warn_on_legacy_route
from volundr.adapters.inbound.auth import require_role
from volundr.domain.models import Principal

logger = logging.getLogger(__name__)


def _sanitize_log(value: object) -> str:
    """Sanitize a value for safe log output (prevent log injection)."""
    return str(value).replace("\n", "\\n").replace("\r", "\\r")


class AdminStorageSettings(BaseModel):
    """Response/request model for storage settings."""

    model_config = ConfigDict(populate_by_name=True)

    home_enabled: bool = Field(
        description="Whether home PVC provisioning is enabled for users",
        validation_alias=AliasChoices("home_enabled", "homeEnabled"),
    )
    file_manager_enabled: bool = Field(
        default=True,
        description="Whether the file manager tab is visible in sessions",
        validation_alias=AliasChoices("file_manager_enabled", "fileManagerEnabled"),
    )

    @model_serializer(mode="wrap")
    def serialize_with_aliases(self, handler):
        payload = handler(self)
        payload["homeEnabled"] = payload.get("home_enabled")
        payload["fileManagerEnabled"] = payload.get("file_manager_enabled")
        return payload


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
        storage = settings.get("storage", {})
        return AdminSettingsResponse(
            storage=AdminStorageSettings(
                home_enabled=storage.get("home_enabled", True),
                file_manager_enabled=storage.get("file_manager_enabled", True),
            ),
        )

    @router.patch("/admin/settings", response_model=AdminSettingsResponse)
    @router.put("/admin/settings", response_model=AdminSettingsResponse)
    async def update_admin_settings(
        body: AdminSettingsUpdate,
        request: Request,
        response: Response,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Update admin settings (admin only)."""
        settings = request.app.state.admin_settings
        if body.storage is not None:
            storage = settings.setdefault("storage", {})
            storage["home_enabled"] = body.storage.home_enabled
            storage["file_manager_enabled"] = body.storage.file_manager_enabled
            logger.info(
                "Admin updated storage settings: home_enabled=%s, file_manager_enabled=%s",
                _sanitize_log(body.storage.home_enabled),
                _sanitize_log(body.storage.file_manager_enabled),
            )
        if request.method.upper() == "PUT":
            warn_on_legacy_route(
                request,
                response,
                LegacyRouteNotice(
                    legacy_path="/api/v1/volundr/admin/settings",
                    canonical_path="/api/v1/volundr/admin/settings",
                ),
                route_logger=logger,
            )
        storage = settings.get("storage", {})
        return AdminSettingsResponse(
            storage=AdminStorageSettings(
                home_enabled=storage.get("home_enabled", True),
                file_manager_enabled=storage.get("file_manager_enabled", True),
            ),
        )

    return router
