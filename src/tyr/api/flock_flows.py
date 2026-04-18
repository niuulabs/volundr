"""REST API for flock flow CRUD — GET/POST/PUT/DELETE /api/v1/tyr/flock_flows.

Delegates all storage to the configured ``FlockFlowProvider`` (accessed via
``request.app.state.flock_flow_provider``).

Validation: POST and PUT verify that every persona name in ``personas[]``
resolves against the persona source stored in
``request.app.state.flock_flow_persona_source``.  When the source is absent
(dev mode, no Ravn), validation is skipped gracefully.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride, PersonaLLMOverride
from tyr.ports.flock_flow import FlockFlowProvider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic request / response models (API layer only)
# ---------------------------------------------------------------------------


class PersonaLLMOverrideSchema(BaseModel):
    primary_alias: str = ""
    thinking_enabled: bool = False
    max_tokens: int = 0


class FlockPersonaOverrideSchema(BaseModel):
    name: str
    llm: PersonaLLMOverrideSchema | None = None
    system_prompt_extra: str = ""
    iteration_budget: int = 0
    max_concurrent_tasks: int = 0


class FlockFlowRequest(BaseModel):
    name: str
    description: str = ""
    personas: list[FlockPersonaOverrideSchema] = Field(default_factory=list)
    mesh_transport: str = "nng"
    mimir_hosted_url: str = ""
    sleipnir_publish_urls: list[str] = Field(default_factory=list)
    max_concurrent_tasks: int = 3


class FlockFlowResponse(BaseModel):
    name: str
    description: str = ""
    personas: list[dict] = Field(default_factory=list)
    mesh_transport: str = "nng"
    mimir_hosted_url: str = ""
    sleipnir_publish_urls: list[str] = Field(default_factory=list)
    max_concurrent_tasks: int = 3


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------


def _request_to_domain(req: FlockFlowRequest) -> FlockFlowConfig:
    personas = []
    for p in req.personas:
        llm: PersonaLLMOverride | None = None
        if p.llm is not None:
            llm = PersonaLLMOverride(
                primary_alias=p.llm.primary_alias,
                thinking_enabled=p.llm.thinking_enabled,
                max_tokens=p.llm.max_tokens,
            )
        personas.append(
            FlockPersonaOverride(
                name=p.name,
                llm=llm,
                system_prompt_extra=p.system_prompt_extra,
                iteration_budget=p.iteration_budget,
                max_concurrent_tasks=p.max_concurrent_tasks,
            )
        )
    return FlockFlowConfig(
        name=req.name,
        description=req.description,
        personas=personas,
        mesh_transport=req.mesh_transport,
        mimir_hosted_url=req.mimir_hosted_url,
        sleipnir_publish_urls=list(req.sleipnir_publish_urls),
        max_concurrent_tasks=req.max_concurrent_tasks,
    )


def _domain_to_response(flow: FlockFlowConfig) -> FlockFlowResponse:
    return FlockFlowResponse(
        name=flow.name,
        description=flow.description,
        personas=[p.to_dict() for p in flow.personas],
        mesh_transport=flow.mesh_transport,
        mimir_hosted_url=flow.mimir_hosted_url,
        sleipnir_publish_urls=list(flow.sleipnir_publish_urls),
        max_concurrent_tasks=flow.max_concurrent_tasks,
    )


# ---------------------------------------------------------------------------
# Persona name validation
# ---------------------------------------------------------------------------


def _find_missing_persona_names(names: list[str], persona_source: object) -> list[str]:
    """Return persona names not resolvable by *persona_source*.

    Works with any object that implements ``list_names() -> list[str]`` (e.g.
    ``FilesystemPersonaAdapter``).  Returns empty list when the source has no
    ``list_names`` method so callers can skip validation gracefully.
    """
    if not hasattr(persona_source, "list_names"):
        return []
    try:
        known: set[str] = set(persona_source.list_names())
    except Exception:
        logger.warning("flock_flows: persona source list_names() failed, skipping validation")
        return []
    return [n for n in names if n not in known]


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_flock_flows_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/flock_flows", tags=["FlockFlows"])

    def _provider(request: Request) -> FlockFlowProvider:
        provider = getattr(request.app.state, "flock_flow_provider", None)
        if provider is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Flock flow provider not configured",
            )
        return provider

    def _validate_personas(request: Request, persona_names: list[str]) -> None:
        """Raise 422 when any persona name is unresolvable."""
        source = getattr(request.app.state, "flock_flow_persona_source", None)
        if source is None:
            return
        missing = _find_missing_persona_names(persona_names, source)
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown persona name(s): {', '.join(sorted(missing))}",
            )

    @router.get("", response_model=list[FlockFlowResponse])
    async def list_flows(request: Request) -> list[FlockFlowResponse]:
        """List all available flock flows."""
        provider = _provider(request)
        return [_domain_to_response(f) for f in provider.list()]

    @router.get("/{name}", response_model=FlockFlowResponse)
    async def get_flow(name: str, request: Request) -> FlockFlowResponse:
        """Get a flock flow by name."""
        provider = _provider(request)
        flow = provider.get(name)
        if flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Flow '{name}' not found",
            )
        return _domain_to_response(flow)

    @router.post("", response_model=FlockFlowResponse, status_code=status.HTTP_201_CREATED)
    async def create_flow(body: FlockFlowRequest, request: Request) -> FlockFlowResponse:
        """Create a new flock flow.

        Returns 422 when any persona name in ``personas[]`` cannot be resolved
        against the configured persona source.
        """
        provider = _provider(request)
        _validate_personas(request, [p.name for p in body.personas])
        flow = _request_to_domain(body)
        provider.save(flow)
        logger.info("flock_flows: created flow '%s'", flow.name)
        return _domain_to_response(flow)

    @router.put("/{name}", response_model=FlockFlowResponse)
    async def update_flow(name: str, body: FlockFlowRequest, request: Request) -> FlockFlowResponse:
        """Replace an existing flock flow.

        Returns 422 when ``name`` in the URL does not match ``body.name``, or
        when any persona name cannot be resolved.
        """
        if name != body.name:
            raise HTTPException(
                status_code=422,
                detail=f"URL name '{name}' must match body name '{body.name}'",
            )
        provider = _provider(request)
        _validate_personas(request, [p.name for p in body.personas])
        flow = _request_to_domain(body)
        provider.save(flow)
        logger.info("flock_flows: updated flow '%s'", flow.name)
        return _domain_to_response(flow)

    @router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_flow(name: str, request: Request) -> None:
        """Delete a flock flow by name."""
        provider = _provider(request)
        deleted = provider.delete(name)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Flow '{name}' not found",
            )
        logger.info("flock_flows: deleted flow '%s'", name)

    return router
