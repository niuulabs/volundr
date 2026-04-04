"""Domain service for dispatch logic — find ready issues and spawn sessions.

Extracted from the API layer so it can be called programmatically by
auto-continue and future consumers without an HTTP request context.
"""

from __future__ import annotations

import logging
import re
import string
from dataclasses import dataclass

from tyr.domain.models import RaidStatus, Saga, TrackerIssue
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.tracker import TrackerFactory, TrackerPort
from tyr.ports.volundr import SpawnRequest, VolundrFactory, VolundrPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------

_READY_STATUSES = {"todo", "backlog", "triage"}


@dataclass(frozen=True)
class QueueItem:
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


@dataclass(frozen=True)
class DispatchResult:
    """Result of dispatching a single item."""

    issue_id: str
    session_id: str
    session_name: str
    status: str
    cluster_name: str = ""


@dataclass(frozen=True)
class DispatchItem:
    """A single item to dispatch."""

    saga_id: str
    issue_id: str
    repo: str
    connection_id: str | None = None


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def is_ready(
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


def slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")[:40]


def build_prompt(
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


def resolve_target_adapter(
    connection_id: str | None,
    adapter_by_name: dict[str, VolundrPort],
    fallback: VolundrPort,
) -> VolundrPort:
    """Resolve the target Volundr adapter for a dispatch item."""
    if not connection_id:
        return fallback
    adapter = adapter_by_name.get(connection_id)
    if adapter is not None:
        return adapter
    return fallback


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


@dataclass
class DispatchConfig:
    """Dispatch-related config values needed by the service."""

    default_system_prompt: str = ""
    default_model: str = "claude-sonnet-4-6"
    dispatch_prompt_template: str = ""


class DispatchService:
    """Domain service for dispatch operations.

    Encapsulates the business logic for finding ready issues and spawning
    Volundr sessions, independent of any HTTP request context.
    """

    def __init__(
        self,
        tracker_factory: TrackerFactory,
        volundr_factory: VolundrFactory,
        saga_repo: SagaRepository,
        dispatcher_repo: DispatcherRepository,
        config: DispatchConfig,
    ) -> None:
        self._tracker_factory = tracker_factory
        self._volundr_factory = volundr_factory
        self._saga_repo = saga_repo
        self._dispatcher_repo = dispatcher_repo
        self._config = config

    async def find_ready_issues(
        self,
        owner_id: str,
        *,
        auth_token: str | None = None,
        saga_tracker_id: str | None = None,
    ) -> list[QueueItem]:
        """Find all dispatchable issues, optionally scoped to one saga."""
        adapters = await self._tracker_factory.for_owner(owner_id)
        volundr = await self._volundr_factory.primary_for_owner(owner_id)
        if volundr is None:
            logger.warning("No Volundr adapter for owner %s, returning empty queue", owner_id)
            return []

        sagas = await self._saga_repo.list_sagas(owner_id=owner_id)
        if saga_tracker_id:
            sagas = [s for s in sagas if s.tracker_id == saga_tracker_id]
        if not sagas:
            return []

        # Get active sessions to exclude already-running issues
        sessions = await volundr.list_sessions(auth_token=auth_token)
        active_statuses = {"running", "starting", "creating"}
        active_issue_ids = {
            s.tracker_issue_id
            for s in sessions
            if s.tracker_issue_id and s.status in active_statuses
        }

        queue: list[QueueItem] = []
        for saga in sagas:
            for adapter in adapters:
                try:
                    milestones, issues = await self._fetch_saga_data(adapter, saga)
                    milestone_names = {m.id: m.name for m in milestones}
                    blocked_identifiers = await self._get_blocked_safe(adapter, saga)

                    for issue in issues:
                        if not is_ready(issue, active_issue_ids, blocked_identifiers):
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

        queue.sort(key=lambda q: (q.priority, q.identifier))
        return queue

    async def dispatch_issues(
        self,
        owner_id: str,
        items: list[DispatchItem],
        *,
        auth_token: str | None = None,
        model: str = "",
        system_prompt: str = "",
        connection_id: str | None = None,
    ) -> list[DispatchResult]:
        """Spawn Volundr sessions for the given items."""
        await self._dispatcher_repo.get_or_create(owner_id)

        effective_model = model or self._config.default_model
        effective_prompt = system_prompt or self._config.default_system_prompt

        adapters = await self._tracker_factory.for_owner(owner_id)
        volundr = await self._volundr_factory.primary_for_owner(owner_id)
        if volundr is None:
            logger.error("No Volundr adapter for owner %s, cannot dispatch", owner_id)
            return [
                DispatchResult(
                    issue_id=item.issue_id,
                    session_id="",
                    session_name="",
                    status="failed",
                )
                for item in items
            ]

        # Query Volundr for the user's integration IDs
        integration_ids = await self._fetch_integration_ids(volundr, auth_token, owner_id)

        # Pre-resolve all Volundr adapters for connection_id targeting
        all_volundr = await self._volundr_factory.for_owner(owner_id)
        adapter_by_name: dict[str, VolundrPort] = {}
        for a in all_volundr:
            if hasattr(a, "_name"):
                adapter_by_name[getattr(a, "_name")] = a

        # Build lookups
        sagas = await self._saga_repo.list_sagas(owner_id=owner_id)
        saga_map = {str(s.id): s for s in sagas}
        issue_cache = await self._build_issue_cache(adapters, sagas)

        results: list[DispatchResult] = []
        for item in items:
            saga = saga_map.get(item.saga_id)
            if saga is None:
                logger.warning("Saga not found: %s", item.saga_id)
                continue

            issue = issue_cache.get(item.issue_id)
            if issue is None:
                logger.warning("Issue not found: %s", item.issue_id)
                continue

            target_connection = item.connection_id or connection_id
            target_volundr = resolve_target_adapter(target_connection, adapter_by_name, volundr)

            result = await self._spawn_single(
                target_volundr=target_volundr,
                item=item,
                saga=saga,
                issue=issue,
                adapters=adapters,
                effective_model=effective_model,
                effective_prompt=effective_prompt,
                integration_ids=integration_ids,
                auth_token=auth_token,
                owner_id=owner_id,
            )
            results.append(result)

        return results

    # -------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------

    @staticmethod
    async def _fetch_saga_data(adapter: TrackerPort, saga: Saga) -> tuple[list, list]:
        """Fetch milestones and issues for a saga from the tracker."""
        if hasattr(adapter, "get_project_full"):
            _, milestones, issues = await adapter.get_project_full(saga.tracker_id)
        else:
            milestones = await adapter.list_milestones(saga.tracker_id)
            issues = await adapter.list_issues(saga.tracker_id)
        return milestones, issues

    @staticmethod
    async def _get_blocked_safe(adapter: TrackerPort, saga: Saga) -> set[str]:
        """Get blocked identifiers, returning empty set on failure."""
        try:
            return await adapter.get_blocked_identifiers(saga.tracker_id)
        except Exception:
            logger.warning(
                "Failed to fetch blocked identifiers for saga %s, skipping dependency filter",
                saga.id,
            )
            return set()

    @staticmethod
    async def _fetch_integration_ids(
        volundr: VolundrPort, auth_token: str | None, owner_id: str
    ) -> list[str]:
        """Fetch integration IDs from Volundr, returning empty on failure."""
        try:
            ids = await volundr.list_integration_ids(auth_token=auth_token)
            logger.info("Fetched %d Volundr integration IDs: %s", len(ids), ids)
            return ids
        except Exception:
            logger.warning(
                "Failed to fetch Volundr integrations for user %s",
                owner_id,
                exc_info=True,
            )
            return []

    @staticmethod
    async def _build_issue_cache(
        adapters: list[TrackerPort], sagas: list[Saga]
    ) -> dict[str, TrackerIssue]:
        """Build a lookup of issue details for prompt generation."""
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
        return issue_cache

    async def _spawn_single(
        self,
        *,
        target_volundr: VolundrPort,
        item: DispatchItem,
        saga: Saga,
        issue: TrackerIssue,
        adapters: list[TrackerPort],
        effective_model: str,
        effective_prompt: str,
        integration_ids: list[str],
        auth_token: str | None,
        owner_id: str,
    ) -> DispatchResult:
        """Spawn a single session and update raid progress."""
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
                    initial_prompt=build_prompt(
                        issue,
                        item.repo,
                        saga.feature_branch,
                        template=self._config.dispatch_prompt_template,
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
                    owner_id=owner_id,
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

            logger.info("Dispatched %s → session %s", issue.identifier, session.id)
            return DispatchResult(
                issue_id=item.issue_id,
                session_id=session.id,
                session_name=session.name,
                status="spawned",
                cluster_name=session.cluster_name,
            )
        except Exception:
            logger.error("Failed to spawn session for %s", issue.identifier, exc_info=True)
            return DispatchResult(
                issue_id=item.issue_id,
                session_id="",
                session_name="",
                status="failed",
            )
