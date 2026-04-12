"""EventTriggerAdapter — create sagas from Sleipnir events.

Subscribes to the Sleipnir event bus and fires saga creation when configured
event patterns match.  Supports:

- Pattern matching via fnmatch (``github.pr.*``, ``ravn.session.ended``, etc.)
- Payload filter matching (key=value pairs that all must match)
- Saga templates loaded from YAML files
- ``auto_start: true``  — spawn Volundr sessions immediately
- ``auto_start: false`` — create PENDING raids, emit ``tyr.raid.needs_approval``
- Deduplication via correlation_id to avoid creating duplicate sagas
"""

from __future__ import annotations

import asyncio
import fnmatch
import logging
import re
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from sleipnir.domain.events import SleipnirEvent
from sleipnir.ports.events import SleipnirSubscriber, Subscription
from tyr.api.tracker import _slugify
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import SpawnRequest, VolundrFactory

logger = logging.getLogger(__name__)

# Path to bundled templates shipped with the package.
_BUNDLED_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

# Regex matching {event.field_name} placeholders in template strings.
_EVENT_PLACEHOLDER_RE = re.compile(r"\{event\.([^}]+)\}")


# ---------------------------------------------------------------------------
# Template data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TemplateRaid:
    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float
    prompt: str


@dataclass(frozen=True)
class TemplatePhase:
    name: str
    raids: list[TemplateRaid]


@dataclass(frozen=True)
class SagaTemplate:
    name: str
    feature_branch: str
    base_branch: str
    repos: list[str]
    phases: list[TemplatePhase]


# ---------------------------------------------------------------------------
# Template loading
# ---------------------------------------------------------------------------


def _interpolate(text: str, payload: dict) -> str:
    """Replace ``{event.field}`` placeholders with values from *payload*.

    Unknown fields are left as-is so templates remain renderable even when
    some payload keys are absent.
    """

    def _replace(m: re.Match) -> str:
        key = m.group(1)
        value = payload.get(key)
        if value is None:
            return m.group(0)
        return str(value)

    return _EVENT_PLACEHOLDER_RE.sub(_replace, text)


def _interpolate_value(value: Any, payload: dict) -> Any:
    """Recursively interpolate ``{event.*}`` placeholders in parsed YAML data.

    Operates on already-parsed Python objects (dicts, lists, strings) so that
    payload values containing YAML metacharacters cannot alter the document
    structure.
    """
    if isinstance(value, str):
        return _interpolate(value, payload)
    if isinstance(value, dict):
        return {k: _interpolate_value(v, payload) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate_value(item, payload) for item in value]
    return value


def load_template(name: str, templates_dir: Path, payload: dict) -> SagaTemplate:
    """Load and interpolate a YAML saga template.

    :param name: Template name without extension (e.g. ``"review"``).
    :param templates_dir: Directory to search first; falls back to bundled dir.
    :param payload: Sleipnir event payload used for ``{event.*}`` substitution.
    :raises FileNotFoundError: When the template cannot be found.
    """
    candidates = [
        templates_dir / f"{name}.yaml",
        _BUNDLED_TEMPLATES_DIR / f"{name}.yaml",
    ]
    path = next((p for p in candidates if p.exists()), None)
    if path is None:
        raise FileNotFoundError(
            f"Saga template {name!r} not found in {templates_dir} or bundled templates"
        )

    raw = path.read_text(encoding="utf-8")
    # Parse YAML first, then interpolate — prevents payload values with YAML
    # metacharacters from altering the document structure.
    data = _interpolate_value(yaml.safe_load(raw), payload)

    phases = [
        TemplatePhase(
            name=p["name"],
            raids=[
                TemplateRaid(
                    name=r["name"],
                    description=r.get("description", ""),
                    acceptance_criteria=r.get("acceptance_criteria", []),
                    declared_files=r.get("declared_files", []),
                    estimate_hours=float(r.get("estimate_hours", 2.0)),
                    prompt=r.get("prompt", ""),
                )
                for r in p.get("raids", [])
            ],
        )
        for p in data.get("phases", [])
    ]

    return SagaTemplate(
        name=data["name"],
        feature_branch=data.get("feature_branch", "main"),
        base_branch=data.get("base_branch", "main"),
        repos=data.get("repos", []),
        phases=phases,
    )


# ---------------------------------------------------------------------------
# Filter matching
# ---------------------------------------------------------------------------


def matches_filter(payload: dict, filter_: dict[str, str]) -> bool:
    """Return True when every key in *filter_* is present and equal in *payload*."""
    for key, expected in filter_.items():
        actual = payload.get(key)
        if actual is None:
            return False
        if str(actual) != expected:
            return False
    return True


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


@dataclass
class _TriggerRule:
    """Internal representation of a single trigger rule."""

    event_pattern: str
    saga_template: str
    auto_start: bool
    filter: dict[str, str]


class EventTriggerAdapter:
    """Subscribes to Sleipnir events and creates sagas from YAML templates.

    Lifecycle::

        adapter = EventTriggerAdapter(...)
        await adapter.start()   # subscribe; begin reacting to events
        # ... application runs ...
        await adapter.stop()    # unsubscribe; clean up

    Deduplication is based on the event's ``correlation_id`` (falling back to
    ``event_id``).  The same correlation-id+rule combination will not create a
    second saga within the lifetime of the adapter.

    The dedup cache is a bounded ``deque`` of fixed maximum size
    (``dedup_cache_size``).  The oldest entries are evicted when the cache is
    full.
    """

    def __init__(
        self,
        *,
        subscriber: SleipnirSubscriber,
        saga_repo: SagaRepository,
        volundr_factory: VolundrFactory,
        event_bus: EventBusPort,
        rules: list[_TriggerRule],
        templates_dir: Path,
        owner_id: str,
        default_model: str = "claude-sonnet-4-6",
        dedup_cache_size: int = 10_000,
        initial_confidence: float = 0.5,
    ) -> None:
        self._subscriber = subscriber
        self._saga_repo = saga_repo
        self._volundr_factory = volundr_factory
        self._event_bus = event_bus
        self._rules = rules
        self._templates_dir = templates_dir
        self._owner_id = owner_id
        self._default_model = default_model
        self._dedup_cache_size = dedup_cache_size
        self._initial_confidence = initial_confidence

        self._subscription: Subscription | None = None
        self._seen: deque[str] = deque(maxlen=dedup_cache_size)
        self._seen_set: set[str] = set()
        self._pending_tasks: set[asyncio.Task[None]] = set()

    @property
    def is_running(self) -> bool:
        return self._subscription is not None

    async def start(self) -> None:
        """Subscribe to all configured event patterns on Sleipnir."""
        if self._subscription is not None:
            return

        patterns = list({r.event_pattern for r in self._rules})
        if not patterns:
            logger.info("EventTriggerAdapter: no rules configured, skipping subscription")
            return

        self._subscription = await self._subscriber.subscribe(patterns, self._handle_event)
        logger.info(
            "EventTriggerAdapter started: %d rule(s), patterns=%s",
            len(self._rules),
            patterns,
        )

    async def stop(self) -> None:
        """Unsubscribe and release resources."""
        if self._subscription is not None:
            await self._subscription.unsubscribe()
            self._subscription = None

        for task in list(self._pending_tasks):
            task.cancel()
        if self._pending_tasks:
            await asyncio.gather(*self._pending_tasks, return_exceptions=True)
        self._pending_tasks.clear()

        logger.info("EventTriggerAdapter stopped")

    # ------------------------------------------------------------------
    # Internal event handling
    # ------------------------------------------------------------------

    async def _handle_event(self, event: SleipnirEvent) -> None:
        """Dispatch *event* to any matching rules."""
        for rule in self._rules:
            if not fnmatch.fnmatch(event.event_type, rule.event_pattern):
                continue
            if not matches_filter(event.payload, rule.filter):
                continue

            dedup_key = self._dedup_key(event, rule.saga_template)
            if dedup_key in self._seen_set:
                logger.debug(
                    "EventTriggerAdapter: duplicate correlation_id %s for template %s, skipping",
                    dedup_key,
                    rule.saga_template,
                )
                continue

            self._add_dedup(dedup_key)
            task = asyncio.create_task(
                self._trigger_saga(event, rule),
                name=f"event-trigger:{rule.saga_template}:{event.event_id}",
            )
            self._pending_tasks.add(task)
            task.add_done_callback(self._pending_tasks.discard)

    def _dedup_key(self, event: SleipnirEvent, template: str) -> str:
        correlation = event.correlation_id or event.event_id
        return f"{template}:{correlation}"

    def _add_dedup(self, key: str) -> None:
        if len(self._seen) >= self._dedup_cache_size and self._seen:
            evicted = self._seen[0]
            self._seen_set.discard(evicted)
        self._seen.append(key)
        self._seen_set.add(key)

    async def _trigger_saga(self, event: SleipnirEvent, rule: _TriggerRule) -> None:
        """Create saga from template and optionally auto-dispatch it."""
        try:
            template = load_template(rule.saga_template, self._templates_dir, event.payload)
        except FileNotFoundError:
            logger.error(
                "EventTriggerAdapter: template %r not found, ignoring event %s",
                rule.saga_template,
                event.event_type,
            )
            return
        except Exception:
            logger.exception("EventTriggerAdapter: failed to load template %r", rule.saga_template)
            return

        now = datetime.now(UTC)
        saga_id = uuid.uuid4()
        slug = _slugify(template.name)[:60]

        saga = Saga(
            id=saga_id,
            tracker_id=str(saga_id),
            tracker_type="native",
            slug=slug,
            name=template.name,
            repos=template.repos,
            feature_branch=template.feature_branch,
            base_branch=template.base_branch,
            status=SagaStatus.ACTIVE,
            confidence=self._initial_confidence,
            created_at=now,
            owner_id=self._owner_id,
        )
        await self._saga_repo.save_saga(saga)

        raid_status = RaidStatus.QUEUED if rule.auto_start else RaidStatus.PENDING
        phases: list[tuple[Phase, list[Raid]]] = []

        for phase_num, tpl_phase in enumerate(template.phases, start=1):
            phase_id = uuid.uuid4()
            phase = Phase(
                id=phase_id,
                saga_id=saga_id,
                tracker_id=str(phase_id),
                number=phase_num,
                name=tpl_phase.name,
                status=PhaseStatus.ACTIVE,
                confidence=self._initial_confidence,
            )
            await self._saga_repo.save_phase(phase)

            raids: list[Raid] = []
            for tpl_raid in tpl_phase.raids:
                raid_id = uuid.uuid4()
                raid = Raid(
                    id=raid_id,
                    phase_id=phase_id,
                    tracker_id=str(raid_id),
                    name=tpl_raid.name,
                    description=tpl_raid.description,
                    acceptance_criteria=tpl_raid.acceptance_criteria,
                    declared_files=tpl_raid.declared_files,
                    estimate_hours=tpl_raid.estimate_hours,
                    status=raid_status,
                    confidence=self._initial_confidence,
                    session_id=None,
                    branch=None,
                    chronicle_summary=None,
                    pr_url=None,
                    pr_id=None,
                    retry_count=0,
                    created_at=now,
                    updated_at=now,
                )
                await self._saga_repo.save_raid(raid)
                raids.append(raid)

            phases.append((phase, raids))

        await self._event_bus.emit(
            TyrEvent(
                event="saga.created",
                data={
                    "saga_id": str(saga_id),
                    "saga_name": saga.name,
                    "slug": slug,
                    "trigger_event": event.event_type,
                    "template": rule.saga_template,
                    "auto_start": rule.auto_start,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )

        logger.info(
            "EventTriggerAdapter: created saga %s (template=%s, auto_start=%s)",
            slug,
            rule.saga_template,
            rule.auto_start,
        )

        if rule.auto_start:
            await self._dispatch_all(saga, phases, template)
        else:
            await self._emit_needs_approval(saga, phases)

    async def _dispatch_all(
        self,
        saga: Saga,
        phases: list[tuple[Phase, list[Raid]]],
        template: SagaTemplate,
    ) -> None:
        """Spawn Volundr sessions for all raids in the saga."""
        volundr = await self._volundr_factory.primary_for_owner(self._owner_id)
        if volundr is None:
            logger.error(
                "EventTriggerAdapter: no Volundr adapter for owner %s, cannot dispatch saga %s",
                self._owner_id,
                saga.slug,
            )
            return

        for phase_idx, (phase, raids) in enumerate(phases):
            tpl_phase = template.phases[phase_idx]
            for raid, tpl_raid in zip(raids, tpl_phase.raids):
                await self._spawn_raid(volundr, saga, phase, raid, tpl_raid)

    async def _spawn_raid(
        self,
        volundr: object,
        saga: Saga,
        phase: Phase,
        raid: Raid,
        tpl_raid: TemplateRaid,
    ) -> None:
        """Spawn a single session for *raid*."""
        repo = saga.repos[0] if saga.repos else ""
        session_name = re.sub(r"[^a-z0-9]+", "-", raid.name.lower()).strip("-")[:48]

        try:
            session = await volundr.spawn_session(  # type: ignore[union-attr]
                request=SpawnRequest(
                    name=session_name,
                    repo=repo,
                    branch=saga.feature_branch,
                    base_branch=saga.base_branch,
                    model=self._default_model,
                    tracker_issue_id=raid.tracker_id,
                    tracker_issue_url="",
                    system_prompt="",
                    initial_prompt=tpl_raid.prompt,
                    integration_ids=[],
                ),
            )

            updated = Raid(
                id=raid.id,
                phase_id=raid.phase_id,
                tracker_id=raid.tracker_id,
                name=raid.name,
                description=raid.description,
                acceptance_criteria=raid.acceptance_criteria,
                declared_files=raid.declared_files,
                estimate_hours=raid.estimate_hours,
                status=RaidStatus.RUNNING,
                confidence=raid.confidence,
                session_id=session.id,
                branch=raid.branch,
                chronicle_summary=raid.chronicle_summary,
                pr_url=raid.pr_url,
                pr_id=raid.pr_id,
                retry_count=raid.retry_count,
                created_at=raid.created_at,
                updated_at=datetime.now(UTC),
            )
            await self._saga_repo.save_raid(updated)

            await self._event_bus.emit(
                TyrEvent(
                    event="raid.state_changed",
                    data={
                        "raid_id": str(raid.id),
                        "new_status": RaidStatus.RUNNING.value,
                        "session_id": session.id,
                        "saga_id": str(saga.id),
                        "owner_id": self._owner_id,
                    },
                    owner_id=self._owner_id,
                )
            )
            logger.info(
                "EventTriggerAdapter: dispatched raid %s → session %s",
                raid.name,
                session.id,
            )
        except Exception:
            logger.exception("EventTriggerAdapter: failed to spawn session for raid %s", raid.name)

    async def _emit_needs_approval(
        self,
        saga: Saga,
        phases: list[tuple[Phase, list[Raid]]],
    ) -> None:
        """Emit tyr.raid.needs_approval events for all PENDING raids."""
        for _phase, raids in phases:
            for raid in raids:
                await self._event_bus.emit(
                    TyrEvent(
                        event="raid.needs_approval",
                        data={
                            "raid_id": str(raid.id),
                            "raid_name": raid.name,
                            "saga_id": str(saga.id),
                            "saga_name": saga.name,
                            "owner_id": self._owner_id,
                        },
                        owner_id=self._owner_id,
                    )
                )
                logger.info(
                    "EventTriggerAdapter: raid %s awaiting approval (saga=%s)",
                    raid.name,
                    saga.slug,
                )


# ---------------------------------------------------------------------------
# Factory helper
# ---------------------------------------------------------------------------


def build_event_trigger_adapter(
    *,
    subscriber: SleipnirSubscriber,
    saga_repo: SagaRepository,
    volundr_factory: VolundrFactory,
    event_bus: EventBusPort,
    config: object,  # tyr.config.EventTriggerConfig
    initial_confidence: float,
) -> EventTriggerAdapter:
    """Construct an EventTriggerAdapter from application config.

    Accepts an :class:`~tyr.config.EventTriggerConfig` instance and returns a
    fully wired adapter ready to be ``start()``-ed.
    """
    cfg = config  # type: ignore[assignment]

    rules = [
        _TriggerRule(
            event_pattern=r.event,
            saga_template=r.saga_template,
            auto_start=r.auto_start,
            filter=r.filter,
        )
        for r in cfg.rules
    ]

    templates_dir = Path(cfg.templates_dir) if cfg.templates_dir else _BUNDLED_TEMPLATES_DIR

    return EventTriggerAdapter(
        subscriber=subscriber,
        saga_repo=saga_repo,
        volundr_factory=volundr_factory,
        event_bus=event_bus,
        rules=rules,
        templates_dir=templates_dir,
        owner_id=cfg.owner_id,
        default_model=cfg.default_model,
        dedup_cache_size=cfg.dedup_cache_size,
        initial_confidence=initial_confidence,
    )
