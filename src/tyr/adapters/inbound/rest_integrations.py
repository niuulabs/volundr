"""FastAPI REST adapter for Tyr integration connection management."""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import (
    IntegrationConnection,
    IntegrationType,
    Principal,
    SecretType,
)
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from tyr.adapters.inbound.auth import extract_principal

logger = logging.getLogger(__name__)


# --- Request / Response models ---


class IntegrationCreateRequest(BaseModel):
    """Request model for creating an integration connection."""

    integration_type: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Integration category (code_forge, source_control, messaging)",
    )
    adapter: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Fully-qualified adapter class path",
    )
    credential_name: str = Field(
        ...,
        min_length=1,
        max_length=253,
        description="Name under which the credential is stored",
    )
    credential_value: str = Field(
        ...,
        min_length=1,
        description="Secret value (PAT, token) — stored in credential store, never persisted raw",
    )
    config: dict[str, str] = Field(
        default_factory=dict,
        description="Adapter-specific configuration",
    )


class IntegrationToggleRequest(BaseModel):
    """Request model for toggling the enabled flag."""

    enabled: bool = Field(..., description="New enabled status")


class IntegrationResponse(BaseModel):
    """Response model for an integration connection."""

    id: str
    integration_type: str
    adapter: str
    credential_name: str
    config: dict[str, str]
    enabled: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_connection(cls, conn: IntegrationConnection) -> IntegrationResponse:
        """Create response from domain model."""
        return cls(
            id=conn.id,
            integration_type=conn.integration_type,
            adapter=conn.adapter,
            credential_name=conn.credential_name,
            config=conn.config,
            enabled=conn.enabled,
            created_at=conn.created_at.isoformat(),
            updated_at=conn.updated_at.isoformat(),
        )


class TelegramSetupResponse(BaseModel):
    """Response model for Telegram deeplink setup."""

    deeplink: str = Field(description="Telegram deeplink URL for bot setup")
    token: str = Field(description="Signed setup token")


# --- Router factory ---

TELEGRAM_SETUP_TTL = 300  # 5 minutes


def create_integrations_router(
    telegram_bot_username: str = "TyrBot",
    telegram_hmac_key: str = "",
) -> APIRouter:
    """Create FastAPI router for Tyr integration management endpoints."""
    router = APIRouter(
        prefix="/api/v1/tyr/integrations",
        tags=["Tyr Integrations"],
    )

    def _get_repo(request: Request) -> IntegrationRepository:
        return request.app.state.integration_repo

    def _get_credential_store(request: Request) -> CredentialStorePort:
        return request.app.state.credential_store

    @router.get(
        "",
        response_model=list[IntegrationResponse],
    )
    async def list_integrations(
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> list[IntegrationResponse]:
        """List the current user's integration connections."""
        repo = _get_repo(request)
        connections = await repo.list_connections(principal.user_id)
        return [IntegrationResponse.from_connection(c) for c in connections]

    @router.post(
        "",
        response_model=IntegrationResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_integration(
        data: IntegrationCreateRequest,
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> IntegrationResponse:
        """Create a new integration connection and store its credential."""
        credential_store = _get_credential_store(request)
        repo = _get_repo(request)

        # Store credential value in the credential store
        await credential_store.store(
            owner_type="user",
            owner_id=principal.user_id,
            name=data.credential_name,
            secret_type=SecretType.API_KEY,
            data={"token": data.credential_value},
        )

        now = datetime.now(UTC)
        connection = IntegrationConnection(
            id=str(uuid4()),
            user_id=principal.user_id,
            integration_type=IntegrationType(data.integration_type),
            adapter=data.adapter,
            credential_name=data.credential_name,
            config=data.config,
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        saved = await repo.save_connection(connection)
        logger.info(
            "Created Tyr integration: type=%s adapter=%s user=%s",
            data.integration_type,
            data.adapter,
            principal.user_id,
        )
        return IntegrationResponse.from_connection(saved)

    @router.delete(
        "/{connection_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_integration(
        connection_id: str = Path(description="Integration connection UUID"),
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> None:
        """Delete an integration connection."""
        repo = _get_repo(request)
        existing = await repo.get_connection(connection_id)
        if existing is None or existing.user_id != principal.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Integration not found: {connection_id}",
            )
        await repo.delete_connection(connection_id)

    @router.patch(
        "/{connection_id}",
        response_model=IntegrationResponse,
    )
    async def toggle_integration(
        data: IntegrationToggleRequest,
        connection_id: str = Path(description="Integration connection UUID"),
        principal: Principal = Depends(extract_principal),
        request: Request = None,
    ) -> IntegrationResponse:
        """Toggle the enabled flag on an integration connection."""
        repo = _get_repo(request)
        existing = await repo.get_connection(connection_id)
        if existing is None or existing.user_id != principal.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Integration not found: {connection_id}",
            )

        now = datetime.now(UTC)
        updated = IntegrationConnection(
            id=existing.id,
            user_id=existing.user_id,
            integration_type=existing.integration_type,
            adapter=existing.adapter,
            credential_name=existing.credential_name,
            config=existing.config,
            enabled=data.enabled,
            created_at=existing.created_at,
            updated_at=now,
        )
        saved = await repo.save_connection(updated)
        return IntegrationResponse.from_connection(saved)

    return router


def create_telegram_setup_router(
    telegram_bot_username: str = "TyrBot",
    telegram_hmac_key: str = "",
) -> APIRouter:
    """Create router for the Telegram deeplink setup endpoint."""
    router = APIRouter(
        prefix="/api/v1/tyr/telegram",
        tags=["Tyr Telegram"],
    )

    @router.get(
        "/setup",
        response_model=TelegramSetupResponse,
    )
    async def telegram_setup(
        principal: Principal = Depends(extract_principal),
    ) -> TelegramSetupResponse:
        """Generate a signed Telegram deeplink for bot setup."""
        ts = str(int(time.time()))
        payload = f"{principal.user_id}:{ts}"
        key = telegram_hmac_key.encode() if telegram_hmac_key else b"tyr-telegram-dev"
        sig = hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()[:16]
        token = f"{payload}:{sig}"
        deeplink = f"https://t.me/{telegram_bot_username}?start={token}"
        return TelegramSetupResponse(deeplink=deeplink, token=token)

    return router
