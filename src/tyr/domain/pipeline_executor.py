"""Pipeline executor — parallel stages, fan-in, conditions, and dynamic creation.

Extends saga execution with:

- **Parallel stage dispatch**: multiple personas spawned simultaneously per phase
- **Fan-in evaluation**: ``all_must_pass``, ``any_pass``, ``majority``, ``merge``
- **Condition checking**: stage conditions referencing prior stage outcomes
- **Outcome tracking**: ``ravn.session.ended`` outcomes stored on Raid records
- **Dynamic creation**: create pipelines from inline YAML at runtime

Usage::

    executor = PipelineExecutor(
        saga_repo=repo,
        volundr_factory=factory,
        event_bus=bus,
        owner_id="user-123",
    )

    # Create from inline YAML
    saga = await executor.create_from_yaml(yaml_str, context={"repo": "acme/widget"})

    # Receive an outcome from a completed Ravn session
    await executor.receive_outcome(
        raid_id=some_uuid,
        outcome={"verdict": "pass", "findings_count": 0},
        event_type="ravn.session.ended",
    )
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from tyr.domain.condition_evaluator import ConditionError, evaluate_condition
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.domain.templates import SagaTemplate, TemplatePhase, load_template_from_string
from tyr.domain.utils import _session_name, _slugify
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import SpawnRequest, VolundrFactory

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fan-in strategies
# ---------------------------------------------------------------------------

FAN_IN_STRATEGIES = frozenset({"all_must_pass", "any_pass", "majority", "merge"})


def evaluate_fan_in(strategy: str, outcomes: list[dict[str, Any]]) -> bool:
    """Return True if the fan-in condition is satisfied.

    :param strategy: One of ``all_must_pass``, ``any_pass``, ``majority``,
        ``merge``.
    :param outcomes: List of structured_outcome dicts from completed raids.
        Each dict may contain a ``verdict`` key.
    :raises ValueError: When *strategy* is not recognised.
    """
    if strategy not in FAN_IN_STRATEGIES:
        raise ValueError(f"Unknown fan-in strategy: {strategy!r}")

    if strategy == "merge":
        return True

    verdicts = [o.get("verdict", "pass") for o in outcomes]

    if strategy == "all_must_pass":
        return all(v != "fail" for v in verdicts)

    if strategy == "any_pass":
        return any(v == "pass" for v in verdicts)

    if strategy == "majority":
        passing = sum(1 for v in verdicts if v == "pass")
        return passing > len(verdicts) / 2

    return True  # unreachable


def merge_outcomes(outcomes: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge multiple raid outcomes into a single stage summary.

    The merged dict contains:
    - ``verdict``: "pass" if all verdicts pass, else "fail"
    - ``participants``: list of individual outcomes
    - ``findings_count``: sum of ``findings_count`` across all outcomes
    - ``critical_findings``: sum of ``critical_findings`` across all outcomes
    """
    merged: dict[str, Any] = {"participants": outcomes}
    verdicts = [o.get("verdict", "pass") for o in outcomes]
    merged["verdict"] = "pass" if all(v != "fail" for v in verdicts) else "fail"

    findings = sum(int(o.get("findings_count", 0)) for o in outcomes)
    critical = sum(int(o.get("critical_findings", 0)) for o in outcomes)
    if findings:
        merged["findings_count"] = findings
    if critical:
        merged["critical_findings"] = critical

    # Carry forward any summary field from the first outcome that has one
    for o in outcomes:
        if "summary" in o:
            merged["summary"] = o["summary"]
            break

    return merged


# ---------------------------------------------------------------------------
# PipelineExecutor
# ---------------------------------------------------------------------------


class PipelineExecutor:
    """Orchestrates pipeline execution: creates sagas and processes outcomes.

    This is the core engine for parallel stage dispatch and fan-in evaluation.
    It wraps the existing Saga/Phase/Raid persistence model and the
    ``EventTriggerAdapter`` pattern, adding outcome tracking and dynamic
    pipeline creation.
    """

    def __init__(
        self,
        *,
        saga_repo: SagaRepository,
        volundr_factory: VolundrFactory,
        event_bus: EventBusPort,
        owner_id: str,
        default_model: str = "claude-sonnet-4-6",
        initial_confidence: float = 0.5,
    ) -> None:
        self._saga_repo = saga_repo
        self._volundr_factory = volundr_factory
        self._event_bus = event_bus
        self._owner_id = owner_id
        self._default_model = default_model
        self._initial_confidence = initial_confidence

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def get_phases(self, saga_id: UUID) -> list[Phase]:
        """Return all phases for *saga_id*, ordered by phase number."""
        return await self._saga_repo.get_phases_by_saga(saga_id)

    async def create_from_yaml(
        self,
        yaml_str: str,
        *,
        context: dict[str, Any] | None = None,
        auto_start: bool = True,
    ) -> Saga:
        """Parse *yaml_str* and create a saga with all phases and raids.

        :param yaml_str: YAML pipeline definition string.
        :param context: Key-value context substituted as ``{event.*}`` placeholders.
        :param auto_start: When True, dispatch Phase 1 raids immediately.
        :returns: The created :class:`Saga`.
        :raises ValueError: When the YAML fails validation.
        """
        template = load_template_from_string(yaml_str, payload=context or {})
        return await self._create_saga(template, auto_start=auto_start)

    async def receive_outcome(
        self,
        *,
        raid_id: UUID,
        outcome: dict[str, Any],
        event_type: str = "ravn.session.ended",
    ) -> None:
        """Process a completed raid outcome.

        1. Store the outcome on the Raid record.
        2. Mark the Raid as MERGED (or FAILED when verdict == fail and
           strategy is all_must_pass).
        3. Check if all Raids in the Phase are now complete.
        4. If yes: evaluate fan-in and advance to the next phase.

        :param raid_id: ID of the Raid that completed.
        :param outcome: Structured outcome dict (e.g. ``{"verdict": "pass"}``).
        :param event_type: The Sleipnir event type that produced this outcome.
        """
        raid = await self._saga_repo.get_raid(raid_id)
        if raid is None:
            logger.warning("PipelineExecutor.receive_outcome: raid %s not found", raid_id)
            return

        new_status = RaidStatus.MERGED
        if outcome.get("verdict") == "fail":
            new_status = RaidStatus.FAILED

        await self._saga_repo.update_raid_outcome(
            raid_id=raid_id,
            outcome=outcome,
            event_type=event_type,
            status=new_status,
        )

        await self._event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid_id),
                    "new_status": new_status.value,
                    "phase_id": str(raid.phase_id),
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )

        await self._check_phase_completion(raid.phase_id)

    # ------------------------------------------------------------------
    # Saga creation
    # ------------------------------------------------------------------

    async def _create_saga(self, template: SagaTemplate, *, auto_start: bool) -> Saga:
        """Persist saga, phases, and raids from *template*."""
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

        for phase_num, tpl_phase in enumerate(template.phases, start=1):
            phase_status = PhaseStatus.ACTIVE if phase_num == 1 else PhaseStatus.PENDING
            phase_id = uuid.uuid4()
            phase = Phase(
                id=phase_id,
                saga_id=saga_id,
                tracker_id=str(phase_id),
                number=phase_num,
                name=tpl_phase.name,
                status=phase_status,
                confidence=self._initial_confidence,
            )
            await self._saga_repo.save_phase(phase)

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
                    status=RaidStatus.PENDING,
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

        await self._event_bus.emit(
            TyrEvent(
                event="saga.created",
                data={
                    "saga_id": str(saga_id),
                    "saga_name": saga.name,
                    "slug": slug,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )

        if auto_start and template.phases:
            await self._dispatch_phase(saga, phase_num=1, tpl_phase=template.phases[0])

        return saga

    # ------------------------------------------------------------------
    # Phase dispatch
    # ------------------------------------------------------------------

    async def _dispatch_phase(
        self,
        saga: Saga,
        *,
        phase_num: int,
        tpl_phase: TemplatePhase,
    ) -> None:
        """Dispatch all raids for *phase_num* in *saga*."""
        if tpl_phase.gate == "human":
            await self._gate_phase(saga, phase_num=phase_num, tpl_phase=tpl_phase)
            return

        phases = await self._saga_repo.get_phases_by_saga(saga.id)
        phase = next((p for p in phases if p.number == phase_num), None)
        if phase is None:
            logger.error("PipelineExecutor: phase %d not found for saga %s", phase_num, saga.id)
            return

        # Mark phase ACTIVE
        active_phase = Phase(
            id=phase.id,
            saga_id=phase.saga_id,
            tracker_id=phase.tracker_id,
            number=phase.number,
            name=phase.name,
            status=PhaseStatus.ACTIVE,
            confidence=phase.confidence,
        )
        await self._saga_repo.save_phase(active_phase)

        volundr = await self._volundr_factory.primary_for_owner(self._owner_id)
        if volundr is None:
            logger.error(
                "PipelineExecutor: no Volundr adapter for owner %s, cannot dispatch phase %d",
                self._owner_id,
                phase_num,
            )
            return

        raids = await self._saga_repo.get_raids_by_phase(phase.id)
        for raid, tpl_raid in zip(raids, tpl_phase.raids):
            session_name = _session_name(raid.name)
            repo = saga.repos[0] if saga.repos else ""
            try:
                session = await volundr.spawn_session(
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
                        profile=tpl_raid.persona or None,
                        integration_ids=[],
                    ),
                )
                updated = replace(
                    raid,
                    status=RaidStatus.RUNNING,
                    session_id=session.id,
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
                    "PipelineExecutor: dispatched raid %s → session %s (persona=%s)",
                    raid.name,
                    session.id,
                    tpl_raid.persona or "(none)",
                )
            except Exception:
                logger.exception("PipelineExecutor: failed to spawn session for raid %s", raid.name)

    async def _gate_phase(
        self,
        saga: Saga,
        *,
        phase_num: int,
        tpl_phase: TemplatePhase,
    ) -> None:
        """Gate a human-approval phase."""
        phases = await self._saga_repo.get_phases_by_saga(saga.id)
        phase = next((p for p in phases if p.number == phase_num), None)
        if phase is None:
            return

        gated = Phase(
            id=phase.id,
            saga_id=phase.saga_id,
            tracker_id=phase.tracker_id,
            number=phase.number,
            name=phase.name,
            status=PhaseStatus.GATED,
            confidence=phase.confidence,
        )
        await self._saga_repo.save_phase(gated)
        await self._event_bus.emit(
            TyrEvent(
                event="phase.needs_approval",
                data={
                    "phase_id": str(phase.id),
                    "phase_name": phase.name,
                    "phase_number": phase.number,
                    "saga_id": str(saga.id),
                    "saga_name": saga.name,
                    "notify": tpl_phase.notify,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )
        logger.info(
            "PipelineExecutor: phase '%s' (saga=%s) gated for human approval",
            phase.name,
            saga.slug,
        )

    # ------------------------------------------------------------------
    # Phase completion / fan-in
    # ------------------------------------------------------------------

    async def _check_phase_completion(self, phase_id: UUID) -> None:
        """Check whether all raids in *phase_id* are done; advance if so."""
        raids = await self._saga_repo.get_raids_by_phase(phase_id)
        if not raids:
            return

        terminal = {RaidStatus.MERGED, RaidStatus.FAILED}
        done = [r for r in raids if r.status in terminal]
        if len(done) < len(raids):
            return  # Still running

        await self._finalize_phase(phase_id, raids=done)

    async def _finalize_phase(self, phase_id: UUID, *, raids: list[Raid]) -> None:
        """Finalize a completed phase: evaluate fan-in and advance."""
        # Find the phase and saga
        saga_id = await self._get_saga_id_for_phase(phase_id)
        if saga_id is None:
            return

        all_phases = await self._saga_repo.get_phases_by_saga(saga_id)
        if not all_phases:
            return

        saga = await self._saga_repo.get_saga(all_phases[0].saga_id)
        if saga is None:
            return

        current_phase = next((p for p in all_phases if p.id == phase_id), None)
        if current_phase is None:
            return

        # Evaluate fan-in using "merge" strategy (base class has no template context)
        outcomes = [r.structured_outcome or {} for r in raids]
        fan_in_passed = evaluate_fan_in("merge", outcomes)

        # Mark current phase COMPLETE
        completed_phase = Phase(
            id=current_phase.id,
            saga_id=current_phase.saga_id,
            tracker_id=current_phase.tracker_id,
            number=current_phase.number,
            name=current_phase.name,
            status=PhaseStatus.COMPLETE,
            confidence=current_phase.confidence,
        )
        await self._saga_repo.save_phase(completed_phase)

        merged = merge_outcomes(outcomes)
        await self._event_bus.emit(
            TyrEvent(
                event="phase.completed",
                data={
                    "phase_id": str(phase_id),
                    "phase_name": current_phase.name,
                    "phase_number": current_phase.number,
                    "saga_id": str(saga.id),
                    "fan_in_passed": fan_in_passed,
                    "merged_outcome": merged,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )

        if not fan_in_passed:
            await self._fail_saga(saga, reason=f"Fan-in failed for phase '{current_phase.name}'")
            return

        # Find the next pending phase
        next_phase = next(
            (p for p in all_phases if p.status == PhaseStatus.PENDING),
            None,
        )
        if next_phase is None:
            await self._complete_saga(saga)
            return

        logger.info(
            "PipelineExecutor: advancing saga %s to phase '%s'",
            saga.slug,
            next_phase.name,
        )
        # Dispatch next phase (no template available at this point — use gate=None)
        # We dispatch a minimal "advance" without template knowledge.
        # The phase was created with PENDING; mark it ACTIVE.
        await self._advance_phase(saga, next_phase=next_phase)

    async def _advance_phase(self, saga: Saga, *, next_phase: Phase) -> None:
        """Activate and dispatch the next phase's raids."""
        active = Phase(
            id=next_phase.id,
            saga_id=next_phase.saga_id,
            tracker_id=next_phase.tracker_id,
            number=next_phase.number,
            name=next_phase.name,
            status=PhaseStatus.ACTIVE,
            confidence=next_phase.confidence,
        )
        await self._saga_repo.save_phase(active)

        # Dispatch raids for this phase
        volundr = await self._volundr_factory.primary_for_owner(self._owner_id)
        if volundr is None:
            logger.error(
                "PipelineExecutor: no Volundr adapter for owner %s, cannot dispatch phase '%s'",
                self._owner_id,
                next_phase.name,
            )
            return

        raids = await self._saga_repo.get_raids_by_phase(next_phase.id)
        repo = saga.repos[0] if saga.repos else ""
        for raid in raids:
            session_name = _session_name(raid.name)
            try:
                session = await volundr.spawn_session(
                    request=SpawnRequest(
                        name=session_name,
                        repo=repo,
                        branch=saga.feature_branch,
                        base_branch=saga.base_branch,
                        model=self._default_model,
                        tracker_issue_id=raid.tracker_id,
                        tracker_issue_url="",
                        system_prompt="",
                        initial_prompt=raid.description,
                        profile=None,
                        integration_ids=[],
                    ),
                )
                updated = replace(
                    raid,
                    status=RaidStatus.RUNNING,
                    session_id=session.id,
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
            except Exception:
                logger.exception("PipelineExecutor: failed to spawn session for raid %s", raid.name)

    async def _get_saga_id_for_phase(self, phase_id: UUID) -> UUID | None:
        """Resolve the saga_id for a phase using the repository."""
        phase = await self._saga_repo.get_phase(phase_id)
        if phase is None:
            return None
        return phase.saga_id

    async def _complete_saga(self, saga: Saga) -> None:
        await self._saga_repo.update_saga_status(saga.id, SagaStatus.COMPLETE)
        await self._event_bus.emit(
            TyrEvent(
                event="saga.completed",
                data={"saga_id": str(saga.id), "saga_name": saga.name, "owner_id": self._owner_id},
                owner_id=self._owner_id,
            )
        )
        logger.info("PipelineExecutor: saga %s completed", saga.slug)

    async def _fail_saga(self, saga: Saga, *, reason: str) -> None:
        await self._saga_repo.update_saga_status(saga.id, SagaStatus.FAILED)
        await self._event_bus.emit(
            TyrEvent(
                event="saga.failed",
                data={
                    "saga_id": str(saga.id),
                    "saga_name": saga.name,
                    "reason": reason,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )
        logger.warning("PipelineExecutor: saga %s failed: %s", saga.slug, reason)


# ---------------------------------------------------------------------------
# Phase-aware executor (uses template context for fan-in and conditions)
# ---------------------------------------------------------------------------


class TemplateAwarePipelineExecutor(PipelineExecutor):
    """Pipeline executor that retains template context for fan-in and conditions.

    Stores the template phases in memory after creation so that ``receive_outcome``
    can evaluate the correct fan-in strategy and condition expressions.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Maps saga_id → list of (Phase, TemplatePhase) pairs, ordered by phase number
        self._saga_templates: dict[str, list[tuple[Phase, TemplatePhase]]] = {}

    async def create_from_yaml(
        self,
        yaml_str: str,
        *,
        context: dict[str, Any] | None = None,
        auto_start: bool = True,
    ) -> Saga:
        template = load_template_from_string(yaml_str, payload=context or {})
        saga = await self._create_saga(template, auto_start=auto_start)

        # After creation, index phases by number from DB
        phases = await self._saga_repo.get_phases_by_saga(saga.id)
        pairs = list(zip(sorted(phases, key=lambda p: p.number), template.phases))
        self._saga_templates[str(saga.id)] = pairs
        return saga

    async def _finalize_phase(self, phase_id: UUID, *, raids: list[Raid]) -> None:
        """Fan-in-aware finalization using stored template context."""
        # Find which saga this phase belongs to
        saga_id = await self._find_saga_id(phase_id)
        if saga_id is None:
            await super()._finalize_phase(phase_id, raids=raids)
            return

        all_phases = await self._saga_repo.get_phases_by_saga(saga_id)
        saga = await self._saga_repo.get_saga(saga_id)
        if not all_phases or saga is None:
            return

        current_phase = next((p for p in all_phases if p.id == phase_id), None)
        if current_phase is None:
            return

        # Look up template context for this phase
        template_pairs = self._saga_templates.get(str(saga_id), [])
        tpl_phase = next(
            (tpl for ph, tpl in template_pairs if ph.id == phase_id),
            None,
        )

        outcomes = [r.structured_outcome or {} for r in raids]

        # Evaluate fan-in
        strategy = tpl_phase.fan_in if tpl_phase else "merge"
        try:
            fan_in_passed = evaluate_fan_in(strategy, outcomes)
        except ValueError as exc:
            logger.error("PipelineExecutor: invalid fan-in strategy: %s", exc)
            fan_in_passed = True

        merged = merge_outcomes(outcomes)

        # Mark phase COMPLETE
        completed_phase = Phase(
            id=current_phase.id,
            saga_id=current_phase.saga_id,
            tracker_id=current_phase.tracker_id,
            number=current_phase.number,
            name=current_phase.name,
            status=PhaseStatus.COMPLETE,
            confidence=current_phase.confidence,
        )
        await self._saga_repo.save_phase(completed_phase)

        await self._event_bus.emit(
            TyrEvent(
                event="phase.completed",
                data={
                    "phase_id": str(phase_id),
                    "phase_name": current_phase.name,
                    "phase_number": current_phase.number,
                    "saga_id": str(saga_id),
                    "fan_in_passed": fan_in_passed,
                    "merged_outcome": merged,
                    "owner_id": self._owner_id,
                },
                owner_id=self._owner_id,
            )
        )

        if not fan_in_passed:
            await self._fail_saga(
                saga, reason=f"Fan-in '{strategy}' failed for phase '{current_phase.name}'"
            )
            return

        # Find next PENDING phase
        next_phase = next(
            (p for p in all_phases if p.status == PhaseStatus.PENDING),
            None,
        )
        if next_phase is None:
            await self._complete_saga(saga)
            return

        # Check condition on next phase
        next_tpl = next(
            (tpl for ph, tpl in template_pairs if ph.id == next_phase.id),
            None,
        )
        if next_tpl and next_tpl.condition:
            condition_ctx = await self._build_condition_context(saga_id, all_phases, template_pairs)
            condition_ctx.setdefault("stages", {})[current_phase.name] = merged
            try:
                passes = evaluate_condition(next_tpl.condition, condition_ctx)
            except ConditionError as exc:
                logger.error(
                    "PipelineExecutor: condition eval failed for phase '%s': %s",
                    next_phase.name,
                    exc,
                )
                passes = False

            if not passes:
                await self._fail_saga(
                    saga,
                    reason=(
                        f"Condition for phase '{next_phase.name}' not met: {next_tpl.condition!r}"
                    ),
                )
                return

        if next_tpl and next_tpl.gate == "human":
            await self._gate_phase(saga, phase_num=next_phase.number, tpl_phase=next_tpl)
            return

        logger.info(
            "PipelineExecutor: advancing saga %s to phase '%s'",
            saga.slug,
            next_phase.name,
        )
        await self._advance_phase(saga, next_phase=next_phase)

    async def _advance_phase(self, saga: Saga, *, next_phase: Phase) -> None:
        """Template-aware advance: uses stored template prompt and persona."""
        active = Phase(
            id=next_phase.id,
            saga_id=next_phase.saga_id,
            tracker_id=next_phase.tracker_id,
            number=next_phase.number,
            name=next_phase.name,
            status=PhaseStatus.ACTIVE,
            confidence=next_phase.confidence,
        )
        await self._saga_repo.save_phase(active)

        volundr = await self._volundr_factory.primary_for_owner(self._owner_id)
        if volundr is None:
            logger.error(
                "PipelineExecutor: no Volundr adapter for owner %s, cannot dispatch phase '%s'",
                self._owner_id,
                next_phase.name,
            )
            return

        template_pairs = self._saga_templates.get(str(saga.id), [])
        tpl_phase = next(
            (tpl for ph, tpl in template_pairs if ph.id == next_phase.id),
            None,
        )

        raids = await self._saga_repo.get_raids_by_phase(next_phase.id)
        repo = saga.repos[0] if saga.repos else ""
        for i, raid in enumerate(raids):
            tpl_raid = tpl_phase.raids[i] if tpl_phase and i < len(tpl_phase.raids) else None
            session_name = _session_name(raid.name)
            initial_prompt = tpl_raid.prompt if tpl_raid else raid.description
            persona = tpl_raid.persona or None if tpl_raid else None
            try:
                session = await volundr.spawn_session(
                    request=SpawnRequest(
                        name=session_name,
                        repo=repo,
                        branch=saga.feature_branch,
                        base_branch=saga.base_branch,
                        model=self._default_model,
                        tracker_issue_id=raid.tracker_id,
                        tracker_issue_url="",
                        system_prompt="",
                        initial_prompt=initial_prompt,
                        profile=persona,
                        integration_ids=[],
                    ),
                )
                updated = replace(
                    raid,
                    status=RaidStatus.RUNNING,
                    session_id=session.id,
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
                    "PipelineExecutor: dispatched raid %s → session %s (persona=%s)",
                    raid.name,
                    session.id,
                    persona or "(none)",
                )
            except Exception:
                logger.exception("PipelineExecutor: failed to spawn session for raid %s", raid.name)

    async def _build_condition_context(
        self,
        saga_id: UUID,
        all_phases: list[Phase],
        template_pairs: list[tuple[Phase, TemplatePhase]],
    ) -> dict[str, Any]:
        """Build the ``stages`` context dict for condition evaluation."""
        ctx: dict[str, Any] = {"stages": {}}
        for phase in all_phases:
            if phase.status != PhaseStatus.COMPLETE:
                continue
            raids = await self._saga_repo.get_raids_by_phase(phase.id)
            outcomes = [r.structured_outcome or {} for r in raids]
            ctx["stages"][phase.name] = merge_outcomes(outcomes)
        return ctx

    async def _find_saga_id(self, phase_id: UUID) -> UUID | None:
        """Find saga_id for a phase by searching tracked sagas."""
        for saga_id_str, pairs in self._saga_templates.items():
            for phase, _ in pairs:
                if phase.id == phase_id:
                    return phase.saga_id
        return None
