"""REST API for the dispatcher — queue and approve raids for execution.

Determines which issues are ready to be worked on (status=Todo, no active
session) and lets the user approve them for dispatch. Tyr then spawns
Volundr sessions for the approved items.
"""

from __future__ import annotations

import logging
import re
import string

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import IntegrationType, Principal
from tyr.adapters.inbound.auth import extract_bearer_token, extract_principal
from tyr.api.tracker import resolve_trackers
from tyr.domain.models import RaidStatus, TrackerIssue
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import SpawnRequest, VolundrFactory, VolundrPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class QueueItem(BaseModel):
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


class DispatchConfig(BaseModel):
    """Dispatch defaults from server config."""

    default_system_prompt: str = ""
    default_model: str = "claude-sonnet-4-6"
    models: list[ModelOption] = []


class DispatchRequest(BaseModel):
    """Request to dispatch selected issues."""

    items: list[DispatchItem]
    model: str = Field(default="")
    system_prompt: str = Field(default="")
    connection_id: str | None = Field(
        default=None,
        description="Target a specific Volundr cluster by connection ID",
    )


class DispatchItem(BaseModel):
    """A single item to dispatch."""

    saga_id: str
    issue_id: str
    repo: str
    connection_id: str | None = Field(
        default=None,
        description="Target a specific Volundr cluster for this item (overrides request-level)",
    )


class DispatchResult(BaseModel):
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


_READY_STATUSES = {"todo", "backlog", "triage"}


def _is_ready(
    issue: TrackerIssue,
    active_issue_ids: set[str],
    blocked_identifiers: set[str],
) -> bool:
    """Check if an issue is ready for dispatch."""
    if issue.status.lower() not in _READY_STATUSES:
        return False
    if issue.identifier in active_issue_ids:
        return False
    if issue.identifier in blocked_identifiers:
        return False
    return True


def _slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")[:40]


def _build_prompt(
    issue: TrackerIssue,
    repo: str,
    feature_branch: str,
    template: str = "",
) -> str:
    """Build the initial prompt for a session from a tracker issue.

    Uses the configurable template if provided, otherwise falls back to
    a minimal default.
    """
    raid_branch = issue.identifier.lower()

    if template:
        available = {
            "identifier": issue.identifier,
            "title": issue.title,
            "description": issue.description or "",
            "repo": repo,
            "feature_branch": feature_branch,
            "raid_branch": raid_branch,
        }
        used_fields = {
            fname for _, fname, _, _ in string.Formatter().parse(template) if fname is not None
        }
        return template.format(**{k: v for k, v in available.items() if k in used_fields})

    # Minimal fallback when no template is configured.
    parts = [
        f"# Task: {issue.identifier} — {issue.title}",
        "",
        issue.description or "",
        "",
        f"Repository: {repo}",
        f"Feature branch: {feature_branch}",
        f"Create a working branch: `{raid_branch}`",
        "",
        "Implement the task, write tests, create a PR against"
        f" `{feature_branch}`, and ensure CI passes.",
    ]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def create_dispatch_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/tyr/dispatch", tags=["Dispatcher"])

    @router.get("/config", response_model=DispatchConfig)
    async def get_config(
        request: Request,
        principal: Principal = Depends(extract_principal),
    ) -> DispatchConfig:
        """Get dispatch defaults from server configuration."""
        settings = request.app.state.settings
        return DispatchConfig(
            default_system_prompt=settings.dispatch.default_system_prompt,
            default_model=settings.dispatch.default_model,
            models=[ModelOption(id=m.id, name=m.name) for m in settings.ai_models],
        )

    @router.get("/queue", response_model=list[QueueItem])
    async def get_queue(
        request: Request,
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
        adapters: list[TrackerPort] = Depends(resolve_trackers),
        volundr: VolundrPort = Depends(resolve_volundr),
    ) -> list[QueueItem]:
        """Get the list of issues ready for dispatch across all sagas."""
        # Extract user's auth token for per-request forwarding to Volundr
        auth_token = extract_bearer_token(request)

        sagas = await repo.list_sagas(owner_id=principal.user_id)
        if not sagas:
            return []

        # Get all active Volundr sessions to know what's already running
        sessions = await volundr.list_sessions(auth_token=auth_token)
        active_statuses = {"running", "starting", "creating"}
        active_issue_ids = {
            s.tracker_issue_id
            for s in sessions
            if s.tracker_issue_id and s.status in active_statuses
        }

        queue: list[QueueItem] = []
        for saga in sagas:
            # Fetch full project data
            for adapter in adapters:
                try:
                    if hasattr(adapter, "get_project_full"):
                        _, milestones, issues = await adapter.get_project_full(saga.tracker_id)
                    else:
                        milestones = await adapter.list_milestones(saga.tracker_id)
                        issues = await adapter.list_issues(saga.tracker_id)

                    # Build milestone lookup and dependency filter
                    milestone_names = {m.id: m.name for m in milestones}
                    try:
                        blocked_identifiers = await adapter.get_blocked_identifiers(
                            saga.tracker_id,
                        )
                    except Exception:
                        logger.warning(
                            "Failed to fetch blocked identifiers for saga %s,"
                            " skipping dependency filter",
                            saga.id,
                        )
                        blocked_identifiers = set()

                    for issue in issues:
                        if not _is_ready(issue, active_issue_ids, blocked_identifiers):
                            continue
                        queue.append(
                            QueueItem(
                                saga_id=str(saga.id),
                                saga_name=saga.name,
                                saga_slug=saga.slug,
                                repos=saga.repos,
                                feature_branch=saga.feature_branch,
                                phase_name=milestone_names.get(
                                    issue.milestone_id or "", "Unassigned"
                                ),
                                issue_id=issue.id,
                                identifier=issue.identifier,
                                title=issue.title,
                                description=issue.description,
                                status=issue.status,
                                priority=issue.priority,
                                priority_label=issue.priority_label,
                                estimate=issue.estimate,
                                url=issue.url,
                            )
                        )
                    break
                except Exception:
                    logger.error("Failed to fetch issues for saga %s", saga.id, exc_info=True)

        # Sort: highest priority first (1=urgent, 4=low)
        queue.sort(key=lambda q: (q.priority, q.identifier))
        return queue

    @router.post("/approve", response_model=list[DispatchResult])
    async def approve_dispatch(
        request: Request,
        body: DispatchRequest,
        principal: Principal = Depends(extract_principal),
        repo: SagaRepository = Depends(resolve_saga_repo),
        adapters: list[TrackerPort] = Depends(resolve_trackers),
        volundr: VolundrPort = Depends(resolve_volundr),
        volundr_factory: VolundrFactory = Depends(resolve_volundr_factory),
        dispatcher_repo: DispatcherRepository = Depends(resolve_dispatcher_repo),
    ) -> list[DispatchResult]:
        """Approve and dispatch selected issues — spawns Volundr sessions."""
        # Ensure dispatcher state exists so the activity subscriber picks up this owner
        await dispatcher_repo.get_or_create(principal.user_id)

        auth_token = extract_bearer_token(request)

        # Merge with server defaults
        settings = request.app.state.settings
        effective_model = body.model or settings.dispatch.default_model
        effective_prompt = body.system_prompt or settings.dispatch.default_system_prompt

        # Query Volundr for the user's integration IDs (includes PAT)
        integration_ids: list[str] = []
        try:
            integration_ids = await volundr.list_integration_ids(auth_token=auth_token)
            logger.info(
                "Fetched %d Volundr integration IDs: %s",
                len(integration_ids),
                integration_ids,
            )
        except Exception:
            logger.warning(
                "Failed to fetch Volundr integrations for user %s",
                principal.user_id,
                exc_info=True,
            )

        # Pre-resolve all Volundr adapters for this owner (used for connection_id targeting)
        all_adapters = await volundr_factory.for_owner(principal.user_id)
        adapter_by_name: dict[str, VolundrPort] = {}
        for a in all_adapters:
            if hasattr(a, "_name"):
                adapter_by_name[getattr(a, "_name")] = a

        results: list[DispatchResult] = []

        # Build a lookup of saga data
        sagas = await repo.list_sagas(owner_id=principal.user_id)
        saga_map = {str(s.id): s for s in sagas}

        # Fetch issue details for prompts (bounded to prevent memory exhaustion)
        max_cached_issues = 10_000
        issue_cache: dict[str, TrackerIssue] = {}
        for saga in sagas:
            for adapter in adapters:
                try:
                    issues = await adapter.list_issues(saga.tracker_id)
                    for issue in issues:
                        if len(issue_cache) >= max_cached_issues:
                            logger.warning(
                                "Issue cache limit reached (%d), skipping remaining issues",
                                max_cached_issues,
                            )
                            break
                        issue_cache[issue.id] = issue
                    break
                except Exception:
                    logger.warning("Failed to fetch issues for saga %s", saga.id, exc_info=True)
                    continue

        for item in body.items:
            saga = saga_map.get(item.saga_id)
            if saga is None:
                logger.warning("Saga not found: %s", item.saga_id)
                continue

            issue = issue_cache.get(item.issue_id)
            if issue is None:
                logger.warning("Issue not found: %s", item.issue_id)
                continue

            # Resolve target adapter: per-item > per-request > default
            target_connection = item.connection_id or body.connection_id
            target_volundr = _resolve_target_adapter(target_connection, adapter_by_name, volundr)

            session_name = issue.identifier.lower()

            try:
                session = await target_volundr.spawn_session(
                    request=SpawnRequest(
                        name=session_name,
                        repo=item.repo,
                        branch=saga.feature_branch,
                        base_branch=saga.base_branch,
                        model=effective_model,
                        tracker_issue_id=issue.identifier,
                        tracker_issue_url=issue.url,
                        system_prompt=effective_prompt,
                        initial_prompt=_build_prompt(
                            issue,
                            item.repo,
                            saga.feature_branch,
                            template=settings.dispatch.dispatch_prompt_template,
                        ),
                        integration_ids=integration_ids,
                    ),
                    auth_token=auth_token,
                )
                # Record raid progress and set tracker issue to In Progress
                logger.info(
                    "Dispatch: updating %d tracker adapters for issue %s",
                    len(adapters),
                    issue.id,
                )
                for adapter in adapters:
                    adapter_name = type(adapter).__name__
                    await adapter.update_raid_progress(
                        issue.id,
                        status=RaidStatus.RUNNING,
                        session_id=session.id,
                        owner_id=principal.user_id,
                        phase_tracker_id=issue.milestone_id,
                        saga_tracker_id=saga.tracker_id,
                    )
                    logger.info(
                        "Dispatch: %s.update_raid_progress OK for %s",
                        adapter_name,
                        issue.id,
                    )
                    try:
                        await adapter.update_raid_state(issue.id, RaidStatus.RUNNING)
                        logger.info(
                            "Dispatch: %s.update_raid_state OK for %s → In Progress",
                            adapter_name,
                            issue.id,
                        )
                    except Exception:
                        logger.error(
                            "FAILED: %s.update_raid_state for %s",
                            adapter_name,
                            issue.id,
                            exc_info=True,
                        )

                results.append(
                    DispatchResult(
                        issue_id=item.issue_id,
                        session_id=session.id,
                        session_name=session.name,
                        status="spawned",
                        cluster_name=session.cluster_name,
                    )
                )
                logger.info("Dispatched %s → session %s", issue.identifier, session.id)
            except Exception:
                logger.error("Failed to spawn session for %s", issue.identifier, exc_info=True)
                results.append(
                    DispatchResult(
                        issue_id=item.issue_id,
                        session_id="",
                        session_name="",
                        status="failed",
                    )
                )

        return results

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


def _resolve_target_adapter(
    connection_id: str | None,
    adapter_by_name: dict[str, VolundrPort],
    fallback: VolundrPort,
) -> VolundrPort:
    """Resolve the target Volundr adapter for a dispatch item.

    Looks up by connection_id (which matches the adapter name derived from
    the connection's config name / slug / id). Falls back to the default.
    """
    if not connection_id:
        return fallback
    adapter = adapter_by_name.get(connection_id)
    if adapter is not None:
        return adapter
    return fallback
