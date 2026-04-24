"""Compatibility settings endpoints for Tyr's web-next HTTP adapter."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field


class RetryPolicyResponse(BaseModel):
    max_retries: int
    retry_delay_seconds: int
    escalate_on_exhaustion: bool


class FlockSettingsResponse(BaseModel):
    flock_name: str
    default_base_branch: str
    default_tracker_type: str
    default_repos: list[str]
    max_active_sagas: int
    auto_create_milestones: bool
    updated_at: datetime


class DispatchDefaultsResponse(BaseModel):
    confidence_threshold: float
    max_concurrent_raids: int
    auto_continue: bool
    batch_size: int
    retry_policy: RetryPolicyResponse
    quiet_hours: str | None = None
    escalate_after: str | None = None
    updated_at: datetime


class NotificationSettingsResponse(BaseModel):
    channel: str
    on_raid_pending_approval: bool
    on_raid_merged: bool
    on_raid_failed: bool
    on_saga_complete: bool
    on_dispatcher_error: bool
    webhook_url: str | None = None
    updated_at: datetime


class FlockSettingsPatch(BaseModel):
    flock_name: str | None = None
    default_base_branch: str | None = None
    default_tracker_type: str | None = None
    default_repos: list[str] | None = None
    max_active_sagas: int | None = Field(default=None, ge=1)
    auto_create_milestones: bool | None = None


class RetryPolicyPatch(BaseModel):
    max_retries: int | None = Field(default=None, ge=0)
    retry_delay_seconds: int | None = Field(default=None, ge=0)
    escalate_on_exhaustion: bool | None = None


class DispatchDefaultsPatch(BaseModel):
    confidence_threshold: float | None = Field(default=None, ge=0.0, le=100.0)
    max_concurrent_raids: int | None = Field(default=None, ge=1, le=20)
    auto_continue: bool | None = None
    batch_size: int | None = Field(default=None, ge=1)
    retry_policy: RetryPolicyPatch | None = None
    quiet_hours: str | None = None
    escalate_after: str | None = None


class NotificationSettingsPatch(BaseModel):
    channel: str | None = None
    on_raid_pending_approval: bool | None = None
    on_raid_merged: bool | None = None
    on_raid_failed: bool | None = None
    on_saga_complete: bool | None = None
    on_dispatcher_error: bool | None = None
    webhook_url: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _settings_store(request: Request) -> dict[str, dict[str, Any]]:
    existing = getattr(request.app.state, "tyr_http_settings", None)
    if existing is not None:
        return existing

    settings = request.app.state.settings
    store = {
        "flock": {
            "flock_name": "default",
            "default_base_branch": "main",
            "default_tracker_type": "linear",
            "default_repos": [],
            "max_active_sagas": 10,
            "auto_create_milestones": True,
            "updated_at": _now(),
        },
        "dispatch": {
            "confidence_threshold": float(settings.notification.confidence_threshold),
            "max_concurrent_raids": 3,
            "auto_continue": False,
            "batch_size": int(settings.watcher.batch_size),
            "retry_policy": {
                "max_retries": 3,
                "retry_delay_seconds": 30,
                "escalate_on_exhaustion": True,
            },
            "quiet_hours": "22:00-07:00 UTC",
            "escalate_after": "30m",
            "updated_at": _now(),
        },
        "notifications": {
            "channel": "activity_log",
            "on_raid_pending_approval": bool(settings.notification.enabled),
            "on_raid_merged": bool(settings.notification.enabled),
            "on_raid_failed": bool(settings.notification.enabled),
            "on_saga_complete": bool(settings.notification.enabled),
            "on_dispatcher_error": bool(settings.notification.enabled),
            "webhook_url": None,
            "updated_at": _now(),
        },
    }
    request.app.state.tyr_http_settings = store
    return store


def create_settings_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/settings", tags=["Tyr Settings"])

    @router.get("/flock", response_model=FlockSettingsResponse)
    async def get_flock_settings(request: Request) -> FlockSettingsResponse:
        return FlockSettingsResponse.model_validate(_settings_store(request)["flock"])

    @router.patch("/flock", response_model=FlockSettingsResponse)
    async def patch_flock_settings(
        request: Request,
        body: FlockSettingsPatch,
    ) -> FlockSettingsResponse:
        flock = _settings_store(request)["flock"]
        flock.update(body.model_dump(exclude_none=True))
        flock["updated_at"] = _now()
        return FlockSettingsResponse.model_validate(flock)

    @router.get("/dispatch", response_model=DispatchDefaultsResponse)
    async def get_dispatch_defaults(request: Request) -> DispatchDefaultsResponse:
        return DispatchDefaultsResponse.model_validate(_settings_store(request)["dispatch"])

    @router.patch("/dispatch", response_model=DispatchDefaultsResponse)
    async def patch_dispatch_defaults(
        request: Request,
        body: DispatchDefaultsPatch,
    ) -> DispatchDefaultsResponse:
        dispatch = _settings_store(request)["dispatch"]
        patch = body.model_dump(exclude_none=True)
        retry_policy = patch.pop("retry_policy", None)
        dispatch.update(patch)
        if retry_policy:
            dispatch["retry_policy"].update(retry_policy)
        dispatch["updated_at"] = _now()
        return DispatchDefaultsResponse.model_validate(dispatch)

    @router.get("/notifications", response_model=NotificationSettingsResponse)
    async def get_notification_settings(request: Request) -> NotificationSettingsResponse:
        notifications = _settings_store(request)["notifications"]
        return NotificationSettingsResponse.model_validate(notifications)

    @router.patch("/notifications", response_model=NotificationSettingsResponse)
    async def patch_notification_settings(
        request: Request,
        body: NotificationSettingsPatch,
    ) -> NotificationSettingsResponse:
        notifications = _settings_store(request)["notifications"]
        notifications.update(body.model_dump(exclude_none=True))
        notifications["updated_at"] = _now()
        return NotificationSettingsResponse.model_validate(notifications)

    return router
