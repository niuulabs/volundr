"""REST API for the dispatcher — queue and approve raids for execution.

Thin wrapper that delegates business logic to DispatchService.
Endpoints handle auth extraction, request validation, and response formatting.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import IntegrationType, Principal
from tyr.adapters.inbound.auth import extract_bearer_token, extract_principal
from tyr.domain.services.dispatch_service import (
    DispatchItem as ServiceDispatchItem,
)
from tyr.domain.services.dispatch_service import (
    DispatchResult as ServiceDispatchResult,
)
from tyr.domain.services.dispatch_service import (
    DispatchService,
)
from tyr.domain.services.dispatch_service import (
    QueueItem as ServiceQueueItem,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import VolundrFactory, VolundrPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic response / request models (API layer only)
# ---------------------------------------------------------------------------


class QueueItemResponse(BaseModel):
    """An issue ready for dispatch."""

    saga_id: str
    saga_name: str
    saga_slug: str
    repos: list[str]
    feature_branch: str
    phase_name: str
    issue_id: str
    identifier: str
    title: str
    description: str
    status: str
    priority: int = 0
    priority_label: str = ""
    estimate: float | None = None
    url: str = ""


class ModelOption(BaseModel):
    id: str
    name: str


class PersonaConfig(BaseModel):
    """A flock persona with optional LLM override."""

    name: str
    llm: dict = {}


class DispatchConfigResponse(BaseModel):
    """Dispatch defaults from server config."""

    default_system_prompt: str = ""
    default_model: str = "claude-sonnet-4-6"
    models: list[ModelOption] = []
    flock_enabled: bool = False
    flock_default_personas: list[PersonaConfig] = []
    flock_llm_config: dict = {}
    flock_sleipnir_publish_urls: list[str] = []


class DispatchRequest(BaseModel):
    """Request to dispatch selected issues."""

    items: list[DispatchItemRequest]
    model: str = Field(default="")
    system_prompt: str = Field(default="")
    connection_id: str | None = Field(
        default=None,
        description="Target a specific Volundr cluster by connection ID",
    )


class DispatchItemRequest(BaseModel):
    """A single item to dispatch."""

    saga_id: str
    issue_id: str
    repo: str
    connection_id: str | None = Field(
        default=None,
        description="Target a specific Volundr cluster for this item (overrides request-level)",
    )


class DispatchResultResponse(BaseModel):
    """Result of dispatching a single item."""

    issue_id: str
    session_id: str
    session_name: str
    status: str
    cluster_name: str = ""


class ClusterInfo(BaseModel):
    """A user's available Volundr cluster."""

    connection_id: str
    name: str
    url: str
    enabled: bool


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _queue_item_to_response(item: ServiceQueueItem) -> QueueItemResponse:
    return QueueItemResponse(
        saga_id=item.saga_id,
        saga_name=item.saga_name,
        saga_slug=item.saga_slug,
        repos=item.repos,
        feature_branch=item.feature_branch,
        phase_name=item.phase_name,
        issue_id=item.issue_id,
        identifier=item.identifier,
        title=item.title,
        description=item.description,
        status=item.status,
        priority=item.priority,
        priority_label=item.priority_label,
        estimate=item.estimate,
        url=item.url,
    )


def _result_to_response(result: ServiceDispatchResult) -> DispatchResultResponse:
    return DispatchResultResponse(
        issue_id=result.issue_id,
        session_id=result.session_id,
        session_name=result.session_name,
        status=result.status,
        cluster_name=result.cluster_name,
    )


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


async def resolve_saga_repo() -> SagaRepository:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Saga repository not configured",
    )


async def resolve_volundr() -> VolundrPort:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Volundr adapter not configured",
    )


async def resolve_volundr_factory() -> VolundrFactory:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Volundr factory not configured",
    )


async def resolve_dispatcher_repo() -> DispatcherRepository:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Dispatcher repository not configured",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def resolve_dispatch_service() -> DispatchService:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Dispatch service not configured",
    )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_dispatch_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/dispatch", tags=["Dispatcher"])

    @router.get("/config", response_model=DispatchConfigResponse)
    async def get_config(
        request: Request,
        principal: Principal = Depends(extract_principal),
    ) -> DispatchConfigResponse:
        """Get dispatch defaults from server configuration."""
        settings = request.app.state.settings
        flock = settings.dispatch.flock
        return DispatchConfigResponse(
            default_system_prompt=settings.dispatch.default_system_prompt,
            default_model=settings.dispatch.default_model,
            models=[ModelOption(id=m.id, name=m.name) for m in settings.ai_models],
            flock_enabled=flock.enabled,
            flock_default_personas=[
                PersonaConfig(name=p.name, llm=dict(p.llm)) for p in flock.default_personas
            ],
            flock_llm_config=dict(flock.llm_config),
            flock_sleipnir_publish_urls=list(flock.sleipnir_publish_urls),
        )

    @router.get("/queue", response_model=list[QueueItemResponse])
    async def get_queue(
        request: Request,
        principal: Principal = Depends(extract_principal),
        service: DispatchService = Depends(resolve_dispatch_service),
    ) -> list[QueueItemResponse]:
        """Get the list of issues ready for dispatch across all sagas."""
        auth_token = extract_bearer_token(request)
        items = await service.find_ready_issues(principal.user_id, auth_token=auth_token)
        return [_queue_item_to_response(item) for item in items]

    @router.post("/approve", response_model=list[DispatchResultResponse])
    async def approve_dispatch(
        request: Request,
        body: DispatchRequest,
        principal: Principal = Depends(extract_principal),
        service: DispatchService = Depends(resolve_dispatch_service),
        dispatcher_repo: DispatcherRepository = Depends(resolve_dispatcher_repo),
    ) -> list[DispatchResultResponse]:
        """Approve and dispatch selected issues — spawns Volundr sessions."""
        # Ensure dispatcher state exists so the activity subscriber picks up this owner
        await dispatcher_repo.get_or_create(principal.user_id)

        auth_token = extract_bearer_token(request)
        settings = request.app.state.settings

        service_items = [
            ServiceDispatchItem(
                saga_id=item.saga_id,
                issue_id=item.issue_id,
                repo=item.repo,
                connection_id=item.connection_id,
            )
            for item in body.items
        ]

        results = await service.dispatch_issues(
            owner_id=principal.user_id,
            items=service_items,
            auth_token=auth_token,
            model=body.model or settings.dispatch.default_model,
            system_prompt=body.system_prompt or settings.dispatch.default_system_prompt,
            connection_id=body.connection_id,
        )
        return [_result_to_response(r) for r in results]

    @router.get("/clusters", response_model=list[ClusterInfo])
    async def list_clusters(
        request: Request,
        principal: Principal = Depends(extract_principal),
    ) -> list[ClusterInfo]:
        """List the user's available Volundr clusters from their CODE_FORGE connections."""
        integration_repo = getattr(request.app.state, "integration_repo", None)
        if integration_repo is None:
            return []

        connections = await integration_repo.list_connections(
            principal.user_id,
            integration_type=IntegrationType.CODE_FORGE,
        )
        clusters: list[ClusterInfo] = []
        for conn in connections:
            name = conn.config.get("name", "") or conn.slug or conn.id
            url = conn.config.get("url", "")
            clusters.append(
                ClusterInfo(
                    connection_id=conn.id,
                    name=name,
                    url=url,
                    enabled=conn.enabled,
                )
            )
        return clusters

    return router
