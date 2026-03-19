"""FastAPI REST adapter for the feature module system."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import extract_principal, require_role
from volundr.domain.models import Principal
from volundr.domain.services.feature import FeatureModule, FeatureService, UserFeaturePreference

logger = logging.getLogger(__name__)


# ── Response / request models ──────────────────────────────────────

class FeatureModuleResponse(BaseModel):
    """A single feature module in the catalog."""

    key: str
    label: str
    icon: str
    scope: str
    enabled: bool
    default_enabled: bool
    admin_only: bool
    order: int


class FeatureToggleRequest(BaseModel):
    """Request body for toggling a feature."""

    enabled: bool = Field(description="Whether the feature should be enabled")


class UserFeaturePreferenceResponse(BaseModel):
    """A single user feature preference."""

    feature_key: str
    visible: bool
    sort_order: int


class UserFeaturePreferenceUpdate(BaseModel):
    """A single preference entry in an update request."""

    feature_key: str
    visible: bool = True
    sort_order: int = 0


class UserPreferencesUpdateRequest(BaseModel):
    """Request body for updating user feature preferences."""

    preferences: list[UserFeaturePreferenceUpdate]


# ── Helpers ────────────────────────────────────────────────────────

def _module_to_response(m: FeatureModule) -> FeatureModuleResponse:
    return FeatureModuleResponse(
        key=m.key,
        label=m.label,
        icon=m.icon,
        scope=m.scope,
        enabled=m.enabled,
        default_enabled=m.default_enabled,
        admin_only=m.admin_only,
        order=m.order,
    )


def _pref_to_response(p: UserFeaturePreference) -> UserFeaturePreferenceResponse:
    return UserFeaturePreferenceResponse(
        feature_key=p.feature_key,
        visible=p.visible,
        sort_order=p.sort_order,
    )


# ── Router factory ─────────────────────────────────────────────────

def create_features_router(feature_service: FeatureService) -> APIRouter:
    """Create the feature modules router."""
    router = APIRouter(prefix="/api/v1/volundr", tags=["Features"])

    @router.get("/features", response_model=list[FeatureModuleResponse])
    async def get_features(
        scope: str | None = None,
        principal: Principal = Depends(extract_principal),
    ):
        """Get the feature catalog.

        Admins see all features (including disabled ones).
        Regular users only see enabled, non-admin-only features.
        """
        is_admin = "volundr:admin" in principal.roles
        include_disabled = is_admin

        modules = await feature_service.get_catalog(
            scope=scope,
            include_disabled=include_disabled,
        )

        if not is_admin:
            modules = [m for m in modules if not m.admin_only]

        return [_module_to_response(m) for m in modules]

    @router.put("/features/{key}/toggle", response_model=FeatureModuleResponse)
    async def toggle_feature(
        key: str,
        body: FeatureToggleRequest,
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """Admin: enable or disable a feature globally."""
        try:
            await feature_service.set_feature_enabled(key, body.enabled)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(exc),
            )

        # Return the updated module
        modules = await feature_service.get_catalog(include_disabled=True)
        for m in modules:
            if m.key == key:
                return _module_to_response(m)

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feature '{key}' not found",
        )

    @router.get(
        "/features/preferences",
        response_model=list[UserFeaturePreferenceResponse],
    )
    async def get_user_preferences(
        principal: Principal = Depends(extract_principal),
    ):
        """Get the current user's feature layout preferences."""
        prefs = await feature_service.get_user_preferences(principal.user_id)
        return [_pref_to_response(p) for p in prefs]

    @router.put(
        "/features/preferences",
        response_model=list[UserFeaturePreferenceResponse],
    )
    async def update_user_preferences(
        body: UserPreferencesUpdateRequest,
        principal: Principal = Depends(extract_principal),
    ):
        """Update the current user's feature layout preferences."""
        prefs = [
            UserFeaturePreference(
                feature_key=p.feature_key,
                visible=p.visible,
                sort_order=p.sort_order,
            )
            for p in body.preferences
        ]
        updated = await feature_service.update_user_preferences(
            principal.user_id, prefs
        )
        return [_pref_to_response(p) for p in updated]

    return router
