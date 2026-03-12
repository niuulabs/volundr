"""FastAPI REST adapter for session management."""

import asyncio
import json
import logging
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from volundr.adapters.inbound.auth import require_role
from volundr.domain.models import (
    Chronicle,
    ChronicleStatus,
    GitProviderType,
    GitSource,
    Model,
    ModelProvider,
    ModelTier,
    Principal,
    Session,
    SessionSource,
    SessionStatus,
    TimelineEvent,
    TimelineEventType,
    WorkspaceStatus,
)
from volundr.domain.ports import EventBroadcaster, PricingProvider
from volundr.domain.services import (
    ChronicleNotFoundError,
    ChronicleService,
    ProviderInfo,
    RepoService,
    RepoValidationError,
    SessionAccessDeniedError,
    SessionNotFoundError,
    SessionNotRunningError,
    SessionService,
    SessionStateError,
    StatsService,
    TokenService,
)

logger = logging.getLogger(__name__)


class SessionCreate(BaseModel):
    """Request model for creating a session."""

    name: str = Field(..., min_length=1, max_length=255)
    model: str = Field(default="", max_length=100)
    source: SessionSource = Field(default_factory=GitSource)
    template_name: str | None = Field(default=None, max_length=255)
    profile_name: str | None = Field(default=None, max_length=255)
    preset_id: UUID | None = Field(default=None)
    workspace_id: UUID | None = Field(default=None)
    terminal_restricted: bool = Field(default=False)
    credential_names: list[str] = Field(default_factory=list)
    integration_ids: list[str] = Field(default_factory=list)


class SessionUpdate(BaseModel):
    """Request model for updating a session."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = Field(default=None, min_length=1, max_length=100)
    branch: str | None = Field(default=None, min_length=1, max_length=255)
    tracker_issue_id: str | None = Field(default=None)


class SessionStart(BaseModel):
    """Request model for (re)starting a session.

    # TODO: detect sessions whose infra was torn down and need relaunching.
    """

    profile_name: str | None = Field(default=None, max_length=255)


class SessionResponse(BaseModel):
    """Response model for a session."""

    id: UUID
    name: str
    model: str
    source: SessionSource
    status: SessionStatus
    chat_endpoint: str | None
    code_endpoint: str | None
    created_at: str
    updated_at: str
    last_active: str
    message_count: int
    tokens_used: int
    pod_name: str | None
    error: str | None
    tracker_issue_id: str | None = None
    preset_id: UUID | None = None
    archived_at: str | None = None
    owner_id: str | None = None
    tenant_id: str | None = None

    @classmethod
    def from_session(cls, session: Session) -> "SessionResponse":
        """Create response from domain model."""
        return cls(
            id=session.id,
            name=session.name,
            model=session.model,
            source=session.source,
            status=session.status,
            chat_endpoint=session.chat_endpoint,
            code_endpoint=session.code_endpoint,
            created_at=session.created_at.isoformat(),
            updated_at=session.updated_at.isoformat(),
            last_active=(
                session.last_active.isoformat()
                if session.last_active
                else session.created_at.isoformat()
            ),
            message_count=session.message_count,
            tokens_used=session.tokens_used,
            pod_name=session.pod_name,
            error=session.error,
            tracker_issue_id=session.tracker_issue_id,
            preset_id=session.preset_id,
            archived_at=(session.archived_at.isoformat() if session.archived_at else None),
            owner_id=session.owner_id,
            tenant_id=session.tenant_id,
        )


class SessionEndpoints(BaseModel):
    """Response model for session endpoints after start."""

    chat_endpoint: str
    code_endpoint: str


class ModelInfo(BaseModel):
    """Response model for available models."""

    id: str
    name: str
    description: str
    provider: ModelProvider
    tier: ModelTier
    color: str
    cost_per_million_tokens: float | None = None
    vram_required: str | None = None

    @classmethod
    def from_model(cls, model: Model) -> "ModelInfo":
        """Create response from domain model."""
        return cls(
            id=model.id,
            name=model.name,
            description=model.description,
            provider=model.provider,
            tier=model.tier,
            color=model.color,
            cost_per_million_tokens=model.cost_per_million_tokens,
            vram_required=model.vram_required,
        )


class ProviderResponse(BaseModel):
    """Response model for a configured git provider."""

    name: str
    type: GitProviderType
    orgs: list[str]

    @classmethod
    def from_provider_info(cls, info: ProviderInfo) -> "ProviderResponse":
        """Create response from domain model."""
        return cls(name=info.name, type=info.type, orgs=list(info.orgs))


class RepoResponse(BaseModel):
    """Response model for a repository."""

    provider: GitProviderType
    org: str
    name: str
    url: str
    default_branch: str
    branches: list[str]


class ErrorResponse(BaseModel):
    """Response model for errors."""

    detail: str


class BrokerChronicleReport(BaseModel):
    """Request model for broker-reported chronicle data at session shutdown."""

    summary: str | None = Field(default=None)
    key_changes: list[str] | None = Field(default=None)
    unfinished_work: str | None = Field(default=None)
    duration_seconds: int | None = Field(default=None, ge=0)


class ChronicleCreate(BaseModel):
    """Request model for creating a chronicle from a session."""

    session_id: UUID


class ChronicleUpdate(BaseModel):
    """Request model for updating a chronicle."""

    summary: str | None = Field(default=None)
    key_changes: list[str] | None = Field(default=None)
    unfinished_work: str | None = Field(default=None)
    tags: list[str] | None = Field(default=None)
    status: ChronicleStatus | None = Field(default=None)


class ChronicleResponse(BaseModel):
    """Response model for a chronicle."""

    id: UUID
    session_id: UUID | None
    status: ChronicleStatus
    project: str
    repo: str
    branch: str
    model: str
    config_snapshot: dict
    summary: str | None
    key_changes: list[str]
    unfinished_work: str | None
    token_usage: int
    cost: float | None
    duration_seconds: int | None
    tags: list[str]
    parent_chronicle_id: UUID | None
    created_at: str
    updated_at: str

    @classmethod
    def from_chronicle(cls, chronicle: Chronicle) -> "ChronicleResponse":
        """Create response from domain model."""
        return cls(
            id=chronicle.id,
            session_id=chronicle.session_id,
            status=chronicle.status,
            project=chronicle.project,
            repo=chronicle.repo,
            branch=chronicle.branch,
            model=chronicle.model,
            config_snapshot=chronicle.config_snapshot,
            summary=chronicle.summary,
            key_changes=chronicle.key_changes,
            unfinished_work=chronicle.unfinished_work,
            token_usage=chronicle.token_usage,
            cost=float(chronicle.cost) if chronicle.cost is not None else None,
            duration_seconds=chronicle.duration_seconds,
            tags=chronicle.tags,
            parent_chronicle_id=chronicle.parent_chronicle_id,
            created_at=chronicle.created_at.isoformat(),
            updated_at=chronicle.updated_at.isoformat(),
        )


class TimelineEventResponse(BaseModel):
    """Response model for a single timeline event."""

    t: int
    type: str
    label: str
    tokens: int | None = None
    action: str | None = None
    ins: int | None = None
    del_: int | None = Field(default=None, alias="del")
    hash: str | None = None
    exit: int | None = None

    model_config = {"populate_by_name": True}


class TimelineFileResponse(BaseModel):
    """Response model for a file summary in the timeline."""

    path: str
    status: str
    ins: int
    del_: int = Field(alias="del")

    model_config = {"populate_by_name": True}


class TimelineCommitResponse(BaseModel):
    """Response model for a commit summary in the timeline."""

    hash: str
    msg: str
    time: str


class TimelineResponseModel(BaseModel):
    """Response model for the full timeline."""

    events: list[TimelineEventResponse]
    files: list[TimelineFileResponse]
    commits: list[TimelineCommitResponse]
    token_burn: list[int]


class TimelineEventCreate(BaseModel):
    """Request model for adding a timeline event."""

    t: int = Field(..., ge=0, description="Seconds elapsed since session start")
    type: str = Field(
        ...,
        pattern="^(session|message|file|git|terminal|error)$",
        description="Event type",
    )
    label: str = Field(..., min_length=1, description="Display text")
    tokens: int | None = Field(default=None, ge=0)
    action: str | None = Field(default=None, pattern="^(created|modified|deleted)$")
    ins: int | None = Field(default=None, ge=0)
    del_: int | None = Field(default=None, ge=0, alias="del")
    hash: str | None = Field(default=None, max_length=40)
    exit_code: int | None = Field(default=None, alias="exit")

    model_config = {"populate_by_name": True}


class StatsResponse(BaseModel):
    """Response model for aggregate statistics."""

    active_sessions: int
    total_sessions: int
    tokens_today: int
    local_tokens: int
    cloud_tokens: int
    cost_today: float


class TokenUsageReport(BaseModel):
    """Request model for reporting token usage."""

    tokens: int = Field(..., gt=0, description="Number of tokens used")
    provider: str = Field(..., pattern="^(cloud|local)$", description="Model provider")
    model: str = Field(..., min_length=1, max_length=100, description="Model identifier")
    message_count: int = Field(default=1, ge=1, description="Number of messages")
    cost: float | None = Field(
        default=None, ge=0, description="Pre-calculated cost in USD (from CLI)"
    )


class TokenUsageResponse(BaseModel):
    """Response model for token usage record."""

    id: str
    session_id: str
    recorded_at: str
    tokens: int
    provider: str
    model: str
    cost: float | None


class WorkspaceResponse(BaseModel):
    """Response model for a workspace."""

    id: UUID
    session_id: UUID
    user_id: str
    tenant_id: str
    pvc_name: str
    status: str
    size_gb: int
    created_at: str
    archived_at: str | None
    deleted_at: str | None

    @classmethod
    def from_workspace(cls, ws) -> "WorkspaceResponse":
        return cls(
            id=ws.id,
            session_id=ws.session_id,
            user_id=ws.user_id,
            tenant_id=ws.tenant_id,
            pvc_name=ws.pvc_name,
            status=ws.status.value if hasattr(ws.status, "value") else ws.status,
            size_gb=ws.size_gb,
            created_at=ws.created_at.isoformat() if ws.created_at else "",
            archived_at=ws.archived_at.isoformat() if ws.archived_at else None,
            deleted_at=ws.deleted_at.isoformat() if ws.deleted_at else None,
        )


def create_router(
    session_service: SessionService,
    stats_service: StatsService | None = None,
    token_service: TokenService | None = None,
    pricing_provider: PricingProvider | None = None,
    broadcaster: EventBroadcaster | None = None,
    repo_service: RepoService | None = None,
    chronicle_service: ChronicleService | None = None,
) -> APIRouter:
    """Create FastAPI router with session, stats, token, repo, and SSE endpoints."""
    router = APIRouter(prefix="/api/v1/volundr")

    # Alias for backward compatibility within this function
    service = session_service

    async def _optional_principal(request: Request) -> Principal | None:
        """Extract principal if identity is configured, else return None.

        Allows dev mode (no IDP) to work without auth headers while
        production deployments enforce tenant/ownership scoping.

        When a principal is found, also ensures the user row exists
        via the identity adapter's JIT provisioning.
        """
        identity = getattr(request.app.state, "identity", None)
        if identity is None:
            return None

        from volundr.adapters.inbound.auth import extract_principal

        try:
            principal = await extract_principal(request)
        except HTTPException:
            return None

        try:
            await identity.get_or_provision_user(principal)
        except Exception:
            logger.warning("JIT user provisioning failed for %s", principal.user_id, exc_info=True)

        return principal

    @router.get("/features", tags=["Features"])
    async def get_features(request: Request) -> dict:
        """Return feature flags derived from server configuration.

        Lets the frontend adapt its UI based on what the backend supports
        (e.g. local mounts are only meaningful in k3s / CLI mode).
        """
        settings = request.app.state.settings
        return {
            "local_mounts_enabled": settings.local_mounts.enabled,
        }

    @router.get("/auth/config", tags=["Auth"])
    async def get_auth_config(request: Request) -> dict:
        """Public auth discovery endpoint for CLI and external clients.

        Returns OIDC configuration so CLI clients can auto-discover how
        to authenticate. This endpoint does NOT require authentication.
        """
        settings = request.app.state.settings

        issuer = settings.auth_discovery.issuer
        if not issuer:
            # Fall back to gateway adapter's issuer_url kwarg
            issuer = settings.gateway.kwargs.get("issuer_url", "")

        if not issuer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Auth discovery not configured",
            )

        return {
            "issuer": issuer,
            "client_id": settings.auth_discovery.cli_client_id,
            "scopes": settings.auth_discovery.scopes,
            "device_authorization_supported": True,
        }

    async def _optional_user_id(request: Request) -> str | None:
        """Extract user_id from auth principal if available, else None."""
        principal = await _optional_principal(request)
        if principal is None:
            return None
        return principal.user_id

    @router.get("/sessions", response_model=list[SessionResponse], tags=["Sessions"])
    async def list_sessions(
        request: Request,
        status_filter: SessionStatus | None = Query(
            default=None, alias="status", description="Filter by session status"
        ),
        include_archived: bool = Query(
            default=False, description="Include archived sessions in results"
        ),
    ) -> list[SessionResponse]:
        """List all sessions. Archived sessions are excluded by default."""
        principal = await _optional_principal(request)
        sessions = await service.list_sessions(
            status=status_filter,
            include_archived=include_archived,
            principal=principal,
        )
        return [SessionResponse.from_session(s) for s in sessions]

    @router.get(
        "/sessions/stream",
        responses={503: {"model": ErrorResponse}},
        tags=["Sessions"],
    )
    async def stream_sessions(request: Request) -> StreamingResponse:
        """Stream real-time session updates via Server-Sent Events (SSE).

        This endpoint provides a real-time stream of session events including:
        - session_created: When a new session is created
        - session_updated: When a session is updated (status, activity, etc.)
        - session_deleted: When a session is deleted
        - stats_updated: Periodic stats updates (every 30s)
        - heartbeat: Keep-alive signal (every 30s)

        Events are formatted as SSE:
        ```
        event: session_updated
        data: {"id": "...", "status": "running", ...}

        ```
        """
        if broadcaster is None:
            logger.warning("SSE stream requested but broadcaster is None")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Event streaming not available",
            )

        client_host = request.client.host if request.client else "unknown"
        logger.info("SSE stream: client connected from %s", client_host)

        async def event_generator():
            event_count = 0
            try:
                async for event in broadcaster.subscribe():
                    # Check if client disconnected
                    if await request.is_disconnected():
                        logger.info(
                            "SSE stream: client %s disconnected after %d events",
                            client_host,
                            event_count,
                        )
                        break

                    # Format as SSE
                    event_data = json.dumps(event.data)
                    event_count += 1
                    logger.info(
                        "SSE stream: sending event #%d type=%s to client %s",
                        event_count,
                        event.type.value,
                        client_host,
                    )
                    yield f"event: {event.type.value}\ndata: {event_data}\n\n"
            except asyncio.CancelledError:
                logger.info(
                    "SSE stream: connection cancelled for client %s after %d events",
                    client_host,
                    event_count,
                )

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post(
        "/sessions/archive-stopped",
        response_model=list[str],
        tags=["Sessions"],
    )
    async def archive_stopped_sessions() -> list[str]:
        """Bulk archive all stopped sessions."""
        archived_ids = await service.archive_stopped_sessions()
        return [str(uid) for uid in archived_ids]

    @router.post(
        "/sessions",
        response_model=SessionResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            422: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def create_session(request: Request, data: SessionCreate) -> SessionResponse:
        """Create and start a new session.

        Creates the session record then immediately starts its pods.
        If template_name is set, the template provides defaults for
        repo/branch/model. The profile (explicit or from template) is
        passed to the pod manager to build task_args.
        """
        principal = await _optional_principal(request)
        try:
            session = await service.create_session(
                name=data.name,
                model=data.model,
                source=data.source,
                template_name=data.template_name,
                preset_id=data.preset_id,
                principal=principal,
                workspace_id=data.workspace_id,
            )
        except RepoValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(e),
            )

        try:
            started = await service.start_session(
                session.id,
                profile_name=data.profile_name,
                template_name=data.template_name,
                principal=principal,
                terminal_restricted=data.terminal_restricted,
                credential_names=data.credential_names,
                integration_ids=data.integration_ids,
            )
            return SessionResponse.from_session(started)
        except SessionStateError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.get(
        "/sessions/{session_id}",
        response_model=SessionResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Sessions"],
    )
    async def get_session(request: Request, session_id: UUID) -> SessionResponse:
        """Get a session by ID."""
        session = await service.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

        principal = await _optional_principal(request)
        try:
            await service._check_access(session, principal)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )

        return SessionResponse.from_session(session)

    @router.put(
        "/sessions/{session_id}",
        response_model=SessionResponse,
        responses={404: {"model": ErrorResponse}},
        tags=["Sessions"],
    )
    async def update_session(
        request: Request,
        session_id: UUID,
        data: SessionUpdate,
    ) -> SessionResponse:
        """Update a session."""
        principal = await _optional_principal(request)
        try:
            session = await service.update_session(
                session_id=session_id,
                name=data.name,
                model=data.model,
                branch=data.branch,
                tracker_issue_id=data.tracker_issue_id,
                principal=principal,
            )
            return SessionResponse.from_session(session)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

    @router.delete(
        "/sessions/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={404: {"model": ErrorResponse}},
        tags=["Sessions"],
    )
    async def delete_session(request: Request, session_id: UUID) -> None:
        """Delete a session."""
        principal = await _optional_principal(request)
        try:
            deleted = await service.delete_session(session_id, principal=principal)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

    @router.post(
        "/sessions/{session_id}/start",
        response_model=SessionResponse,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def start_session(
        request: Request,
        session_id: UUID,
        data: SessionStart | None = None,
    ) -> SessionResponse:
        """Restart a session's pods.

        Used to relaunch a stopped or failed session. An optional
        profile_name in the body overrides the default profile.
        """
        profile_name = data.profile_name if data else None
        principal = await _optional_principal(request)
        try:
            session = await service.start_session(
                session_id,
                profile_name=profile_name,
                principal=principal,
            )
            return SessionResponse.from_session(session)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )
        except SessionStateError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.post(
        "/sessions/{session_id}/stop",
        response_model=SessionResponse,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def stop_session(request: Request, session_id: UUID) -> SessionResponse:
        """Stop a session's pods."""
        principal = await _optional_principal(request)
        try:
            session = await service.stop_session(session_id, principal=principal)
            return SessionResponse.from_session(session)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )
        except SessionStateError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.patch(
        "/sessions/{session_id}/archive",
        response_model=SessionResponse,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def archive_session(request: Request, session_id: UUID) -> SessionResponse:
        """Archive a session. Stops pod if running."""
        principal = await _optional_principal(request)
        try:
            session = await service.archive_session(
                session_id,
                principal=principal,
            )
            return SessionResponse.from_session(session)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )
        except SessionStateError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.patch(
        "/sessions/{session_id}/restore",
        response_model=SessionResponse,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def restore_session(request: Request, session_id: UUID) -> SessionResponse:
        """Restore an archived session to stopped state."""
        principal = await _optional_principal(request)
        try:
            session = await service.restore_session(
                session_id,
                principal=principal,
            )
            return SessionResponse.from_session(session)
        except SessionAccessDeniedError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to session {session_id}",
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )
        except SessionStateError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.get("/models", response_model=list[ModelInfo], tags=["Models & Stats"])
    async def list_models() -> list[ModelInfo]:
        """List available models."""
        if pricing_provider is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Pricing provider not available",
            )
        models = pricing_provider.list_models()
        return [ModelInfo.from_model(m) for m in models]

    @router.get("/stats", response_model=StatsResponse, tags=["Models & Stats"])
    async def get_stats() -> StatsResponse:
        """Get aggregate statistics for the dashboard."""
        if stats_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stats service not available",
            )
        stats = await stats_service.get_stats()
        return StatsResponse(
            active_sessions=stats.active_sessions,
            total_sessions=stats.total_sessions,
            tokens_today=stats.tokens_today,
            local_tokens=stats.local_tokens,
            cloud_tokens=stats.cloud_tokens,
            cost_today=float(stats.cost_today),
        )

    @router.post(
        "/sessions/{session_id}/usage",
        response_model=TokenUsageResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def report_token_usage(session_id: UUID, data: TokenUsageReport) -> TokenUsageResponse:
        """Report token usage for a session."""
        if token_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Token service not available",
            )

        provider = ModelProvider(data.provider)

        try:
            record = await token_service.record_usage(
                session_id=session_id,
                tokens=data.tokens,
                provider=provider,
                model=data.model,
                message_count=data.message_count,
                cost=data.cost,
            )
            return TokenUsageResponse(
                id=str(record.id),
                session_id=str(record.session_id),
                recorded_at=record.recorded_at.isoformat(),
                tokens=record.tokens,
                provider=record.provider.value,
                model=record.model,
                cost=float(record.cost) if record.cost is not None else None,
            )
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )
        except SessionNotRunningError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(e),
            )

    @router.get(
        "/sessions/{session_id}/logs",
        responses={
            404: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def get_session_logs(
        session_id: UUID,
        lines: int = Query(default=100, ge=1, le=2000),
        level: str = Query(default="DEBUG"),
    ) -> dict:
        """Proxy log retrieval from a running session pod.

        Fetches logs from the Skuld broker's in-memory log buffer via its
        ``GET /api/logs`` endpoint.
        """
        session = await service.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

        if not session.chat_endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} has no active endpoint",
            )

        # Derive HTTP base URL from the chat endpoint
        # chat_endpoint is like wss://session-name.domain/session
        base_url = session.chat_endpoint.replace("wss://", "https://").replace("ws://", "http://")
        # Strip the /session path to get the base
        if base_url.endswith("/session"):
            base_url = base_url[: -len("/session")]

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{base_url}/api/logs",
                    params={"lines": lines, "level": level},
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            logger.warning("Log proxy failed for session %s: %s", session_id, e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to fetch logs from session pod: {e.response.status_code}",
            )
        except httpx.RequestError as e:
            logger.warning("Log proxy connection failed for session %s: %s", session_id, e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not connect to session pod: {e}",
            )

    @router.get(
        "/sessions/{session_id}/diff",
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def get_session_diff(
        session_id: UUID,
        file: str | None = Query(
            default=None,
            description="File path relative to workspace (optional)",
        ),
        base: str = Query(
            default="last-commit",
            description="Diff base mode: last-commit or default-branch",
        ),
    ) -> dict:
        """Get git diff from a session workspace via Skuld.

        Proxies to the session pod's ``GET /api/diff`` endpoint.

        - **last-commit**: ``git diff HEAD`` (uncommitted changes)
        - **default-branch**: ``git diff main...HEAD`` (full branch diff)
        """
        if base not in ("last-commit", "default-branch"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid base parameter: {base}. Must be 'last-commit' or 'default-branch'"
                ),
            )

        session = await service.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

        if not session.chat_endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} has no active endpoint",
            )

        base_url = session.chat_endpoint.replace("wss://", "https://").replace("ws://", "http://")
        if base_url.endswith("/session"):
            base_url = base_url[: -len("/session")]

        params: dict[str, str] = {"base": base}
        if file is not None:
            params["file"] = file

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{base_url}/api/diff",
                    params=params,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Diff proxy failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(f"Failed to fetch diff from session pod: {e.response.status_code}"),
            )
        except httpx.RequestError as e:
            logger.warning(
                "Diff proxy connection failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not connect to session pod: {e}",
            )

    @router.get(
        "/sessions/{session_id}/files",
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
        },
        tags=["Sessions"],
    )
    async def list_session_files(
        session_id: UUID,
        path: str = Query(
            default="",
            description="Relative directory path within the workspace",
        ),
    ) -> dict:
        """List files in a session workspace via Skuld.

        Proxies to the session pod's ``GET /api/files`` endpoint.
        Respects .gitignore and excludes noise directories.
        Directories are sorted before files, both alphabetical.
        """
        if ".." in path or path.startswith("/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=("Invalid path: must be relative and cannot contain '..'"),
            )

        session = await service.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

        if not session.chat_endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} has no active endpoint",
            )

        base_url = session.chat_endpoint.replace("wss://", "https://").replace("ws://", "http://")
        if base_url.endswith("/session"):
            base_url = base_url[: -len("/session")]

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                params: dict[str, str] = {}
                if path:
                    params["path"] = path
                response = await client.get(
                    f"{base_url}/api/files",
                    params=params,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Files proxy failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(f"Failed to list files from session pod: {e.response.status_code}"),
            )
        except httpx.RequestError as e:
            logger.warning(
                "Files proxy connection failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not connect to session pod: {e}",
            )

    @router.get(
        "/providers",
        response_model=list[ProviderResponse],
        responses={503: {"model": ErrorResponse}},
        tags=["Repositories"],
    )
    async def list_providers() -> list[ProviderResponse]:
        """List all configured git providers."""
        if repo_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Repo service not available",
            )
        providers = repo_service.list_providers()
        return [ProviderResponse.from_provider_info(p) for p in providers]

    @router.get(
        "/repos",
        response_model=dict[str, list[RepoResponse]],
        responses={503: {"model": ErrorResponse}},
        tags=["Repositories"],
    )
    async def list_repos(
        request: Request,
    ) -> dict[str, list[RepoResponse]]:
        """List repositories from all providers visible to the current user.

        Combines shared/org-level providers with the user's own integration
        connections. Credentials are resolved on-the-fly and never cached.
        """
        if repo_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Repo service not available",
            )
        user_id = await _optional_user_id(request)
        repos_by_provider = await repo_service.list_repos(user_id=user_id)
        return {
            provider_name: [
                RepoResponse(
                    provider=repo.provider,
                    org=repo.org,
                    name=repo.name,
                    url=repo.url,
                    default_branch=repo.default_branch,
                    branches=list(repo.branches),
                )
                for repo in repos
            ]
            for provider_name, repos in repos_by_provider.items()
        }

    @router.get(
        "/repos/branches",
        response_model=list[str],
        responses={
            400: {"model": ErrorResponse},
            401: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Repositories"],
    )
    async def list_branches(
        request: Request,
        repo_url: str = Query(..., description="Repository URL"),
    ) -> list[str]:
        """List branches for a repository using the user's credentials."""
        if repo_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Repo service not available",
            )

        from volundr.domain.ports import GitAuthError, GitRepoNotFoundError

        user_id = await _optional_user_id(request)
        try:
            return await repo_service.list_branches(repo_url, user_id=user_id)
        except GitAuthError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e),
            )
        except GitRepoNotFoundError as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e),
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

    # --- Chronicle ingestion from broker ---

    @router.post(
        "/sessions/{session_id}/chronicle",
        response_model=ChronicleResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Chronicles"],
    )
    async def report_chronicle(session_id: UUID, data: BrokerChronicleReport) -> ChronicleResponse:
        """Ingest chronicle data reported by the Skuld broker at shutdown.

        Creates a new DRAFT chronicle or enriches an existing one.
        Mirrors the ``/sessions/{id}/usage`` pattern for token reporting.
        """
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        try:
            chronicle = await chronicle_service.create_or_update_from_broker(
                session_id=session_id,
                summary=data.summary,
                key_changes=data.key_changes,
                unfinished_work=data.unfinished_work,
                duration_seconds=data.duration_seconds,
            )
            return ChronicleResponse.from_chronicle(chronicle)
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

    # --- Chronicle endpoints ---

    @router.get("/chronicles", response_model=list[ChronicleResponse], tags=["Chronicles"])
    async def list_chronicles(
        project: str | None = Query(default=None),
        repo: str | None = Query(default=None),
        model_name: str | None = Query(default=None),
        tags: str | None = Query(default=None, description="Comma-separated tags"),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> list[ChronicleResponse]:
        """List chronicles with optional filters."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        tag_list = [t.strip() for t in tags.split(",")] if tags else None
        chronicles = await chronicle_service.list_chronicles(
            project=project,
            repo=repo,
            model=model_name,
            tags=tag_list,
            limit=limit,
            offset=offset,
        )
        return [ChronicleResponse.from_chronicle(c) for c in chronicles]

    @router.post(
        "/chronicles",
        response_model=ChronicleResponse,
        status_code=status.HTTP_201_CREATED,
        responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def create_chronicle(data: ChronicleCreate) -> ChronicleResponse:
        """Create a chronicle from a session's current state."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        try:
            chronicle = await chronicle_service.create_chronicle(data.session_id)
            return ChronicleResponse.from_chronicle(chronicle)
        except SessionNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {data.session_id}",
            )

    @router.get(
        "/chronicles/{chronicle_id}",
        response_model=ChronicleResponse,
        responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def get_chronicle(chronicle_id: UUID) -> ChronicleResponse:
        """Get a chronicle by ID."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        chronicle = await chronicle_service.get_chronicle(chronicle_id)
        if chronicle is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chronicle not found: {chronicle_id}",
            )
        return ChronicleResponse.from_chronicle(chronicle)

    @router.patch(
        "/chronicles/{chronicle_id}",
        response_model=ChronicleResponse,
        responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def update_chronicle(chronicle_id: UUID, data: ChronicleUpdate) -> ChronicleResponse:
        """Update a chronicle's mutable fields."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        try:
            chronicle = await chronicle_service.update_chronicle(
                chronicle_id,
                summary=data.summary,
                key_changes=data.key_changes,
                unfinished_work=data.unfinished_work,
                tags=data.tags,
                status=data.status,
            )
            return ChronicleResponse.from_chronicle(chronicle)
        except ChronicleNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chronicle not found: {chronicle_id}",
            )

    @router.delete(
        "/chronicles/{chronicle_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def delete_chronicle(chronicle_id: UUID) -> None:
        """Delete a chronicle."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        deleted = await chronicle_service.delete_chronicle(chronicle_id)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chronicle not found: {chronicle_id}",
            )

    @router.post(
        "/chronicles/{chronicle_id}/reforge",
        response_model=SessionResponse,
        responses={404: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def reforge_chronicle(chronicle_id: UUID) -> SessionResponse:
        """Relaunch a session from a chronicle entry."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        try:
            session = await chronicle_service.reforge(chronicle_id)
            return SessionResponse.from_session(session)
        except ChronicleNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Chronicle not found: {chronicle_id}",
            )

    @router.get(
        "/chronicles/{chronicle_id}/chain",
        response_model=list[ChronicleResponse],
        responses={503: {"model": ErrorResponse}},
        tags=["Chronicles"],
    )
    async def get_chronicle_chain(chronicle_id: UUID) -> list[ChronicleResponse]:
        """Get the full reforge chain for a chronicle."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        chain = await chronicle_service.get_chain(chronicle_id)
        return [ChronicleResponse.from_chronicle(c) for c in chain]

    @router.get(
        "/sessions/{session_id}/chronicle",
        response_model=ChronicleResponse,
        responses={
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Chronicles"],
    )
    async def get_session_chronicle(session_id: UUID) -> ChronicleResponse:
        """Get the most recent chronicle for a session."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        chronicle = await chronicle_service.get_chronicle_by_session(session_id)
        if chronicle is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No chronicle found for session: {session_id}",
            )
        return ChronicleResponse.from_chronicle(chronicle)

    # --- Timeline endpoints ---

    @router.get(
        "/chronicles/{session_id}/timeline",
        response_model=TimelineResponseModel,
        responses={
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Timeline"],
    )
    async def get_timeline(session_id: UUID) -> TimelineResponseModel:
        """Get the event timeline for a session's chronicle."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )
        timeline = await chronicle_service.get_timeline(session_id)
        if timeline is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No chronicle data for session: {session_id}",
            )
        return TimelineResponseModel(
            events=[
                TimelineEventResponse(
                    t=ev.t,
                    type=ev.type.value,
                    label=ev.label,
                    tokens=ev.tokens,
                    action=ev.action,
                    ins=ev.ins,
                    **{"del": ev.del_},
                    hash=ev.hash,
                    exit=ev.exit_code,
                )
                for ev in timeline.events
            ],
            files=[
                TimelineFileResponse(
                    path=f.path,
                    status=f.status,
                    ins=f.ins,
                    **{"del": f.del_},
                )
                for f in timeline.files
            ],
            commits=[
                TimelineCommitResponse(hash=c.hash, msg=c.msg, time=c.time)
                for c in timeline.commits
            ],
            token_burn=timeline.token_burn,
        )

    @router.post(
        "/chronicles/{session_id}/timeline",
        response_model=TimelineEventResponse,
        status_code=status.HTTP_201_CREATED,
        responses={
            404: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
        tags=["Timeline"],
    )
    async def add_timeline_event(
        session_id: UUID, data: TimelineEventCreate
    ) -> TimelineEventResponse:
        """Add a timeline event for a session's chronicle."""
        if chronicle_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chronicle service not available",
            )

        chronicle = await chronicle_service.get_chronicle_by_session(session_id)
        if chronicle is None:
            # Auto-create a draft chronicle on first timeline event
            try:
                chronicle = await chronicle_service.create_chronicle(session_id)
            except SessionNotFoundError:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session not found: {session_id}",
                )

        from datetime import datetime

        event = TimelineEvent(
            id=uuid4(),
            chronicle_id=chronicle.id,
            session_id=session_id,
            t=data.t,
            type=TimelineEventType(data.type),
            label=data.label,
            tokens=data.tokens,
            action=data.action,
            ins=data.ins,
            del_=data.del_,
            hash=data.hash,
            exit_code=data.exit_code,
            created_at=datetime.utcnow(),
        )

        try:
            stored = await chronicle_service.add_timeline_event(session_id, event)
        except RuntimeError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Timeline service not available",
            )

        return TimelineEventResponse(
            t=stored.t,
            type=stored.type.value,
            label=stored.label,
            tokens=stored.tokens,
            action=stored.action,
            ins=stored.ins,
            **{"del": stored.del_},
            hash=stored.hash,
            exit=stored.exit_code,
        )

    # --- Diff proxy endpoint (called by web UI) ---

    @router.get(
        "/chronicles/{session_id}/diff",
        responses={
            400: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            502: {"model": ErrorResponse},
        },
        tags=["Chronicles"],
    )
    async def get_chronicle_diff(
        request: Request,
        session_id: UUID,
        file: str = Query(
            ...,
            description="File path relative to workspace",
        ),
        base: str = Query(
            default="last-commit",
            description="Diff base: last-commit or default-branch",
        ),
    ) -> dict:
        """Get git diff for a file in a session workspace via Skuld."""
        if base not in ("last-commit", "default-branch"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid base parameter: {base}. Must be 'last-commit' or 'default-branch'"
                ),
            )

        session = await service.get_session(session_id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}",
            )

        if not session.chat_endpoint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session {session_id} has no active endpoint",
            )

        base_url = session.chat_endpoint.replace("wss://", "https://").replace("ws://", "http://")
        if base_url.endswith("/session"):
            base_url = base_url[: -len("/session")]

        # Forward auth header so the proxy can reach Skuld through envoy
        proxy_headers: dict[str, str] = {}
        auth_header = request.headers.get("authorization")
        if auth_header:
            proxy_headers["Authorization"] = auth_header

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{base_url}/api/diff",
                    params={"file": file, "base": base},
                    headers=proxy_headers,
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Diff proxy failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(f"Failed to fetch diff from session pod: {e.response.status_code}"),
            )
        except httpx.RequestError as e:
            logger.warning(
                "Diff proxy connection failed for session %s: %s",
                session_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Could not connect to session pod: {e}",
            )

    # ── Workspace endpoints ─────────────────────────────────────────

    @router.get(
        "/workspaces",
        response_model=list[WorkspaceResponse],
        tags=["Workspaces"],
    )
    async def list_workspaces(
        request: Request,
        status_filter: str | None = Query(None, alias="status"),
    ):
        """List the current user's workspaces."""
        principal = await _optional_principal(request)
        if principal is None:
            return []
        workspace_service = request.app.state.workspace_service
        ws_status = WorkspaceStatus(status_filter) if status_filter else None
        workspaces = await workspace_service.list_workspaces(principal.user_id, ws_status)
        return [WorkspaceResponse.from_workspace(ws) for ws in workspaces]

    @router.delete(
        "/workspaces/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["Workspaces"],
    )
    async def delete_workspace(
        session_id: UUID,
        request: Request,
    ):
        """Delete a workspace PVC by session ID."""
        principal = await _optional_principal(request)
        workspace_service = request.app.state.workspace_service
        # Verify ownership before deleting
        workspaces = await workspace_service.list_workspaces(
            principal.user_id if principal else "",
        )
        if not any(str(ws.session_id) == str(session_id) for ws in workspaces):
            raise HTTPException(status_code=404, detail="Workspace not found")
        deleted = await workspace_service.delete_workspace_by_session(str(session_id))
        if not deleted:
            raise HTTPException(status_code=404, detail="Workspace not found")

    @router.get(
        "/admin/workspaces",
        response_model=list[WorkspaceResponse],
        tags=["Admin"],
    )
    async def list_all_workspaces(
        request: Request,
        user_id: str | None = Query(None),
        status_filter: str | None = Query(None, alias="status"),
        _: Principal = Depends(require_role("volundr:admin")),
    ):
        """List all workspaces (admin only)."""
        workspace_service = request.app.state.workspace_service
        ws_status = WorkspaceStatus(status_filter) if status_filter else None
        if user_id:
            workspaces = await workspace_service.list_workspaces(user_id, ws_status)
        else:
            workspaces = await workspace_service.list_all_workspaces(ws_status)
        return [WorkspaceResponse.from_workspace(ws) for ws in workspaces]

    return router
