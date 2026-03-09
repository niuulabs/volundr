"""FastAPI REST adapter for integration management."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import extract_principal
from volundr.domain.models import (
    IntegrationConnection,
    IntegrationDefinition,
    IntegrationType,
    Principal,
)
from volundr.domain.ports import IntegrationRepository
from volundr.domain.services.integration_registry import IntegrationRegistry
from volundr.domain.services.tracker_factory import TrackerFactory

logger = logging.getLogger(__name__)


# --- Request/Response models ---


class IntegrationCreateRequest(BaseModel):
    """Request model for creating an integration connection."""

    integration_type: str = Field(..., min_length=1, max_length=50)
    adapter: str = Field(..., min_length=1, max_length=500)
    credential_name: str = Field(..., min_length=1, max_length=253)
    config: dict[str, str] = Field(default_factory=dict)
    enabled: bool = Field(default=True)
    slug: str = Field(default="", max_length=100)


class IntegrationUpdateRequest(BaseModel):
    """Request model for updating an integration connection."""

    credential_name: str | None = Field(default=None, max_length=253)
    config: dict[str, str] | None = None
    enabled: bool | None = None


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
    slug: str = ""

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
            slug=conn.slug,
        )


class MCPServerSpecResponse(BaseModel):
    """Response model for an MCP server spec."""

    name: str
    command: str
    args: list[str]
    env_from_credentials: dict[str, str]


class CatalogEntryResponse(BaseModel):
    """Response model for a single catalog entry."""

    slug: str
    name: str
    description: str
    integration_type: str
    adapter: str
    icon: str
    credential_schema: dict
    config_schema: dict
    mcp_server: MCPServerSpecResponse | None = None

    @classmethod
    def from_definition(
        cls,
        defn: IntegrationDefinition,
    ) -> CatalogEntryResponse:
        """Create response from domain model."""
        mcp = None
        if defn.mcp_server is not None:
            mcp = MCPServerSpecResponse(
                name=defn.mcp_server.name,
                command=defn.mcp_server.command,
                args=list(defn.mcp_server.args),
                env_from_credentials=dict(defn.mcp_server.env_from_credentials),
            )
        return cls(
            slug=defn.slug,
            name=defn.name,
            description=defn.description,
            integration_type=defn.integration_type,
            adapter=defn.adapter,
            icon=defn.icon,
            credential_schema=defn.credential_schema,
            config_schema=defn.config_schema,
            mcp_server=mcp,
        )


class IntegrationTestResult(BaseModel):
    """Response model for testing an integration connection."""

    success: bool
    provider: str
    workspace: str | None = None
    user: str | None = None
    error: str | None = None


# --- Router factory ---


def create_integrations_router(
    integration_repo: IntegrationRepository,
    tracker_factory: TrackerFactory,
    registry: IntegrationRegistry | None = None,
) -> APIRouter:
    """Create FastAPI router for integration management endpoints."""
    router = APIRouter(
        prefix="/api/v1/volundr/integrations",
        tags=["Integrations"],
    )

    @router.get(
        "/catalog",
        response_model=list[CatalogEntryResponse],
    )
    async def list_catalog() -> list[CatalogEntryResponse]:
        """List all available integration definitions from the catalog."""
        if registry is None:
            return []
        definitions = registry.list_definitions()
        return [CatalogEntryResponse.from_definition(d) for d in definitions]

    @router.get(
        "",
        response_model=list[IntegrationResponse],
    )
    async def list_integrations(
        principal: Principal = Depends(extract_principal),
    ) -> list[IntegrationResponse]:
        """List the current user's integration connections."""
        connections = await integration_repo.list_connections(principal.user_id)
        return [IntegrationResponse.from_connection(c) for c in connections]

    @router.post(
        "",
        response_model=IntegrationResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def create_integration(
        data: IntegrationCreateRequest,
        principal: Principal = Depends(extract_principal),
    ) -> IntegrationResponse:
        """Create a new integration connection."""
        now = datetime.now(UTC)
        connection = IntegrationConnection(
            id=str(uuid4()),
            user_id=principal.user_id,
            integration_type=IntegrationType(data.integration_type),
            adapter=data.adapter,
            credential_name=data.credential_name,
            config=data.config,
            enabled=data.enabled,
            created_at=now,
            updated_at=now,
            slug=data.slug,
        )
        saved = await integration_repo.save_connection(connection)
        logger.info(
            "Created integration: type=%s adapter=%s user=%s",
            data.integration_type,
            data.adapter,
            principal.user_id,
        )
        return IntegrationResponse.from_connection(saved)

    @router.put(
        "/{connection_id}",
        response_model=IntegrationResponse,
    )
    async def update_integration(
        connection_id: str,
        data: IntegrationUpdateRequest,
        principal: Principal = Depends(extract_principal),
    ) -> IntegrationResponse:
        """Update an integration connection."""
        existing = await integration_repo.get_connection(connection_id)
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
            credential_name=(
                data.credential_name
                if data.credential_name is not None
                else existing.credential_name
            ),
            config=data.config if data.config is not None else existing.config,
            enabled=data.enabled if data.enabled is not None else existing.enabled,
            created_at=existing.created_at,
            updated_at=now,
        )
        saved = await integration_repo.save_connection(updated)
        return IntegrationResponse.from_connection(saved)

    @router.delete(
        "/{connection_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_integration(
        connection_id: str,
        principal: Principal = Depends(extract_principal),
    ) -> None:
        """Delete an integration connection."""
        existing = await integration_repo.get_connection(connection_id)
        if existing is None or existing.user_id != principal.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Integration not found: {connection_id}",
            )
        await integration_repo.delete_connection(connection_id)

    @router.post(
        "/{connection_id}/test",
        response_model=IntegrationTestResult,
    )
    async def test_integration(
        connection_id: str,
        principal: Principal = Depends(extract_principal),
    ) -> IntegrationTestResult:
        """Test an integration connection by instantiating the adapter."""
        existing = await integration_repo.get_connection(connection_id)
        if existing is None or existing.user_id != principal.user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Integration not found: {connection_id}",
            )

        try:
            adapter = await tracker_factory.create(existing)
            conn_status = await adapter.check_connection()
            return IntegrationTestResult(
                success=conn_status.connected,
                provider=conn_status.provider,
                workspace=conn_status.workspace,
                user=conn_status.user,
            )
        except Exception as exc:
            logger.exception("Integration test failed for %s", connection_id)
            return IntegrationTestResult(
                success=False,
                provider=existing.adapter.rsplit(".", 1)[-1],
                error=str(exc),
            )

    return router
