"""REST API for the dispatcher — queue and approve raids for execution.

Determines which issues are ready to be worked on (status=Todo, no active
session) and lets the user approve them for dispatch. Tyr then spawns
Volundr sessions for the approved items.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_bearer_token, extract_principal
from tyr.api.tracker import resolve_trackers
from tyr.domain.models import TrackerIssue
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerPort
from tyr.ports.volundr import SpawnRequest, VolundrPort

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


class DispatchItem(BaseModel):
    """A single item to dispatch."""

    saga_id: str
    issue_id: str
    repo: str


class DispatchResult(BaseModel):
    """Result of dispatching a single item."""

    issue_id: str
    session_id: str
    session_name: str
    status: str


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


def _build_prompt(issue: TrackerIssue, repo: str, feature_branch: str) -> str:
    """Build the initial prompt for a session from a tracker issue."""
    parts = [
        f"# Task: {issue.identifier} — {issue.title}",
        "",
        issue.description or "",
        "",
        f"Repository: {repo}",
        f"Base branch: {feature_branch}",
        f"Create a branch for your work: `{issue.identifier.lower()}`",
        "",
        "## Completion Requirements",
        "",
        "1. **Update Linear ticket**: Use the Linear MCP server to set the ticket"
        f" `{issue.identifier}` status to **In Progress** immediately.",
        "2. **Implement the task**: Write code, tests, and ensure coverage >= 85%.",
        "3. **Commit your changes**: Use conventional commits.",
        f"4. **Create a PR against `{feature_branch}`** (NOT `main`):"
        " include a summary of all changes in the PR description.",
        "5. **Wait for CI**: Ensure all CI checks pass (tests, lint, coverage)."
        " If CI fails, fix the issues and push again.",
        "6. **Update Linear ticket**: Use the Linear MCP server to add a comment"
        f" on `{issue.identifier}` with a summary of what was done and a link"
        " to the PR.",
        "",
        "**Do NOT stop until the PR is created and CI is green.**",
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
                    if hasattr(adapter, "get_blocked_identifiers"):
                        blocked_identifiers = await adapter.get_blocked_identifiers(saga.tracker_id)
                    else:
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
    ) -> list[DispatchResult]:
        """Approve and dispatch selected issues — spawns Volundr sessions."""
        auth_token = extract_bearer_token(request)

        # Merge with server defaults
        settings = request.app.state.settings
        effective_model = body.model or settings.dispatch.default_model
        effective_prompt = body.system_prompt or settings.dispatch.default_system_prompt

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

            session_name = issue.identifier.lower()

            try:
                session = await volundr.spawn_session(
                    request=SpawnRequest(
                        name=session_name,
                        repo=item.repo,
                        branch=saga.feature_branch,
                        base_branch=saga.base_branch,
                        model=effective_model,
                        tracker_issue_id=issue.identifier,
                        tracker_issue_url=issue.url,
                        system_prompt=effective_prompt,
                        initial_prompt=_build_prompt(issue, item.repo, saga.feature_branch),
                    ),
                    auth_token=auth_token,
                )
                # Track the dispatched session — lightweight link between
                # session, owner, saga, and tracker issue. The tracker remains
                # the source of truth for issue data.
                pool = request.app.state.pool
                await pool.execute(
                    """
                    INSERT INTO dispatched_sessions
                        (id, session_id, owner_id, saga_id, tracker_issue_id, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (session_id) DO NOTHING
                    """,
                    uuid4(),
                    session.id,
                    principal.user_id,
                    saga.id,
                    issue.id,
                    "running",
                    datetime.now(UTC),
                )

                results.append(
                    DispatchResult(
                        issue_id=item.issue_id,
                        session_id=session.id,
                        session_name=session.name,
                        status="spawned",
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

    return router
