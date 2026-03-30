"""Contract engine — planner-driven sprint contract negotiation for raids.

Mirrors the ReviewEngine pattern exactly: listens on the event bus for a status
change (CONTRACTING), tracks an in-memory session→raid mapping (rebuilt from DB
on startup), and receives completion callbacks from ActivitySubscriber.

When a raid enters CONTRACTING, the engine spawns a planner session that
negotiates acceptance criteria and declared files with the working session.
On agreement the contract is persisted to the raid and posted as a Linear
comment for audit trail. On failure the raid is escalated.
"""

from __future__ import annotations

import asyncio
import json
import logging

from tyr.config import ContractConfig
from tyr.domain.models import (
    RaidStatus,
    validate_transition,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.tracker import TrackerFactory, TrackerPort
from tyr.ports.volundr import SpawnRequest, VolundrFactory, VolundrSession

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Prompt helpers
# ---------------------------------------------------------------------------


def _build_acceptance_criteria_section(criteria: list[str]) -> str:
    if not criteria:
        return ""
    lines = ["**Existing Acceptance Criteria**:"]
    for criterion in criteria:
        lines.append(f"- {criterion}")
    return "\n".join(lines) + "\n\n"


def _build_declared_files_section(files: list[str]) -> str:
    if not files:
        return ""
    lines = [f"**Declared Files** ({len(files)}):"]
    for f in files:
        lines.append(f"- `{f}`")
    return "\n".join(lines) + "\n\n"


def build_contract_initial_prompt(
    raid_tracker_id: str,
    raid_name: str,
    raid_description: str,
    acceptance_criteria: list[str],
    declared_files: list[str],
    working_session_id: str,
    max_rounds: int,
    template: str = "",
) -> str:
    """Build the initial prompt sent to the contract planner session."""
    sections = {
        "tracker_id": raid_tracker_id,
        "raid_name": raid_name,
        "raid_description": raid_description,
        "acceptance_criteria_section": _build_acceptance_criteria_section(acceptance_criteria),
        "declared_files_section": _build_declared_files_section(declared_files),
        "working_session_id": working_session_id,
        "max_rounds": str(max_rounds),
    }

    if template:
        return template.format(**sections)

    return (
        f"## Sprint Contract Negotiation\n\n"
        f"**Ticket**: {raid_tracker_id}\n"
        f"**Raid**: {raid_name}\n"
        f"**Description**: {raid_description}\n\n"
        f"{sections['acceptance_criteria_section']}"
        f"{sections['declared_files_section']}"
        f"Working session: `{working_session_id}`\n"
        f"Max rounds: {max_rounds}\n\n"
        "Negotiate and output CONTRACT_AGREED with acceptance criteria and declared files as JSON."
    )


# ---------------------------------------------------------------------------
# Contract response parser
# ---------------------------------------------------------------------------


def parse_contract_response(text: str) -> dict | None:
    """Parse the contract planner's output.

    Looks for CONTRACT_AGREED or CONTRACT_FAILED markers followed by a JSON block.
    Returns the parsed dict with a ``status`` key ("agreed" or "failed"),
    or None if the output cannot be parsed (intermediate idle).
    """
    if "CONTRACT_AGREED" not in text and "CONTRACT_FAILED" not in text:
        return None

    # Extract JSON from markdown code fences
    cleaned = text.strip()
    json_str = ""
    for prefix in ("```json", "```"):
        if prefix in cleaned:
            start = cleaned.index(prefix) + len(prefix)
            end = cleaned.index("```", start) if "```" in cleaned[start:] else len(cleaned)
            json_str = cleaned[start:end].strip()
            break

    if not json_str:
        # Try parsing whatever comes after the marker
        for marker in ("CONTRACT_AGREED", "CONTRACT_FAILED"):
            if marker in cleaned:
                after = cleaned.split(marker, 1)[1].strip()
                json_str = after
                break

    try:
        data = json.loads(json_str)
    except (json.JSONDecodeError, ValueError):
        return None

    if not isinstance(data, dict):
        return None

    if "CONTRACT_FAILED" in text:
        return {"status": "failed", "reason": data.get("reason", "Unknown failure")}

    criteria = data.get("acceptance_criteria", [])
    files = data.get("declared_files", [])

    if not isinstance(criteria, list) or not isinstance(files, list):
        return None

    return {
        "status": "agreed",
        "acceptance_criteria": [str(c) for c in criteria],
        "declared_files": [str(f) for f in files],
    }


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class ContractEngine:
    """Planner-driven sprint contract negotiation engine.

    Mirrors ReviewEngine: listens for raids entering CONTRACTING, spawns a
    planner session, and handles completion via ActivitySubscriber callbacks.
    """

    def __init__(
        self,
        tracker_factory: TrackerFactory,
        volundr_factory: VolundrFactory,
        contract_config: ContractConfig,
        event_bus: EventBusPort | None = None,
        dispatcher_repo: DispatcherRepository | None = None,
    ) -> None:
        self._tracker_factory = tracker_factory
        self._volundr_factory = volundr_factory
        self._cfg = contract_config
        self._event_bus = event_bus
        self._dispatcher_repo = dispatcher_repo
        self._task: asyncio.Task[None] | None = None
        # Maps planner_session_id → (raid_tracker_id, owner_id)
        self._contract_sessions: dict[str, tuple[str, str]] = {}
        # Maps planner_session_id → current round number
        self._contract_rounds: dict[str, int] = {}

    @property
    def running(self) -> bool:
        return self._task is not None

    def get_contract_raid(self, session_id: str) -> tuple[str, str] | None:
        """Look up the raid tracker_id and owner_id for a contract planner session.

        Returns (tracker_id, owner_id) if the session is a tracked contract planner,
        None otherwise.
        """
        return self._contract_sessions.get(session_id)

    async def handle_contract_completion(self, session_id: str, planner_output: str) -> None:
        """Handle a contract planner session idle event (called by ActivitySubscriber).

        The planner may go idle multiple times during negotiation. Only act
        when the output contains CONTRACT_AGREED or CONTRACT_FAILED — otherwise
        it's an intermediate idle and we increment the round counter.
        """
        mapping = self._contract_sessions.get(session_id)
        if mapping is None:
            logger.warning("Contract session %s not tracked — ignoring completion", session_id)
            return

        tracker_id, owner_id = mapping

        result = parse_contract_response(planner_output)

        # Intermediate idle — no CONTRACT_AGREED/FAILED marker
        if result is None:
            current_round = self._contract_rounds.get(session_id, 0) + 1
            self._contract_rounds[session_id] = current_round

            if current_round >= self._cfg.contract_max_rounds:
                logger.info(
                    "Contract session %s reached max rounds (%d) — escalating",
                    session_id,
                    self._cfg.contract_max_rounds,
                )
                await self._handle_contract_failed(
                    tracker_id,
                    owner_id,
                    session_id,
                    reason=f"Max negotiation rounds ({self._cfg.contract_max_rounds}) exceeded",
                )
                return

            logger.info(
                "Contract session %s idle without agreement — round %d/%d, skipping",
                session_id,
                current_round,
                self._cfg.contract_max_rounds,
            )
            return

        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            raise RuntimeError(f"No tracker for owner {owner_id[:8]}")
        tracker = trackers[0]

        raid = await tracker.get_raid(tracker_id)
        if raid.status != RaidStatus.CONTRACTING:
            logger.info(
                "Raid %s no longer in CONTRACTING (status=%s) — skipping contract result",
                tracker_id,
                raid.status,
            )
            self._cleanup_session(session_id)
            return

        if result["status"] == "failed":
            await self._handle_contract_failed(
                tracker_id,
                owner_id,
                session_id,
                reason=result.get("reason", "Contract negotiation failed"),
            )
            return

        # Contract agreed
        await self._handle_contract_agreed(
            tracker,
            tracker_id,
            owner_id,
            session_id,
            acceptance_criteria=result["acceptance_criteria"],
            declared_files=result["declared_files"],
        )

    async def _handle_contract_agreed(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        session_id: str,
        *,
        acceptance_criteria: list[str],
        declared_files: list[str],
    ) -> None:
        """Handle a successful contract agreement."""
        # Persist contract to the raid
        await tracker.update_raid_progress(
            tracker_id,
            acceptance_criteria=acceptance_criteria,
            declared_files=declared_files,
        )

        # Post agreed contract as a Linear comment for audit trail
        contract_json = json.dumps(
            {
                "acceptance_criteria": acceptance_criteria,
                "declared_files": declared_files,
            },
            indent=2,
        )
        try:
            await tracker.add_comment(
                tracker_id,
                f"## Sprint Contract Agreed\n\n```json\n{contract_json}\n```",
            )
        except Exception:
            logger.warning("Failed to post contract comment on %s", tracker_id, exc_info=True)

        # Transition CONTRACTING → RUNNING
        validate_transition(RaidStatus.CONTRACTING, RaidStatus.RUNNING)
        updated = await tracker.update_raid_progress(tracker_id, status=RaidStatus.RUNNING)

        await self._emit_event(
            "contract.agreed",
            owner_id,
            {
                "tracker_id": tracker_id,
                "criteria_count": len(acceptance_criteria),
                "files_count": len(declared_files),
            },
        )

        # Also emit raid.state_changed so downstream listeners react
        await self._emit_event(
            "raid.state_changed",
            owner_id,
            {
                "raid_id": str(updated.id),
                "status": updated.status.value,
                "tracker_id": tracker_id,
                "action": "contract_agreed",
            },
        )

        self._cleanup_session(session_id)
        logger.info(
            "Contract agreed for raid %s: %d criteria, %d files",
            tracker_id,
            len(acceptance_criteria),
            len(declared_files),
        )

    async def _handle_contract_failed(
        self,
        tracker_id: str,
        owner_id: str,
        session_id: str,
        *,
        reason: str,
    ) -> None:
        """Handle a failed contract negotiation — escalate the raid."""
        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            logger.error("No tracker for owner %s during contract failure", owner_id[:8])
            self._cleanup_session(session_id)
            return
        tracker = trackers[0]

        validate_transition(RaidStatus.CONTRACTING, RaidStatus.ESCALATED)
        await tracker.update_raid_progress(tracker_id, status=RaidStatus.ESCALATED, reason=reason)

        await self._emit_event(
            "contract.failed",
            owner_id,
            {"tracker_id": tracker_id, "reason": reason},
        )

        await self._emit_event(
            "raid.state_changed",
            owner_id,
            {
                "tracker_id": tracker_id,
                "status": RaidStatus.ESCALATED.value,
                "action": "contract_failed",
            },
        )

        self._cleanup_session(session_id)
        logger.info("Contract failed for raid %s: %s", tracker_id, reason)

    async def evaluate(self, tracker_id: str, owner_id: str) -> None:
        """Spawn a contract planner session for a raid entering CONTRACTING.

        Called by the dispatcher (NIU-334) or by the event listener.
        """
        if not self._cfg.contract_enabled:
            logger.info("Contract engine disabled — skipping %s", tracker_id)
            return

        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            raise ValueError(f"No tracker adapter found for owner {owner_id}")
        tracker = trackers[0]

        raid = await tracker.get_raid(tracker_id)
        if raid.status != RaidStatus.CONTRACTING:
            raise ValueError(f"Raid {tracker_id} not in CONTRACTING state: {raid.status}")

        # Resolve the working session
        working_session: VolundrSession | None = None
        if raid.session_id:
            adapters = await self._volundr_factory.for_owner(owner_id)
            for adapter in adapters:
                try:
                    working_session = await adapter.get_session(raid.session_id)
                    if working_session is not None:
                        break
                except Exception:
                    continue

        # Send wait prompt to working session
        if working_session is not None:
            try:
                volundr_adapters = await self._volundr_factory.for_owner(owner_id)
                if volundr_adapters:
                    await volundr_adapters[0].send_message(
                        raid.session_id, self._cfg.working_session_wait_prompt
                    )
            except Exception:
                logger.warning(
                    "Failed to send wait prompt to session %s",
                    raid.session_id,
                    exc_info=True,
                )

        # Spawn the planner session
        session = await self._spawn_planner_session(raid, owner_id, working_session)
        if session is None:
            logger.warning(
                "Contract planner session not spawned for raid %s — escalating",
                tracker_id,
            )
            await self._handle_contract_failed(
                tracker_id,
                owner_id,
                "",
                reason="Failed to spawn contract planner session",
            )
            return

        # Persist planner session mapping
        await tracker.update_raid_progress(tracker_id, planner_session_id=session.id)
        self._contract_sessions[session.id] = (tracker_id, owner_id)
        self._contract_rounds[session.id] = 0

        logger.info(
            "Contract planner session %s spawned for raid %s",
            session.id,
            tracker_id,
        )

    async def _spawn_planner_session(
        self,
        raid,
        owner_id: str,
        working_session: VolundrSession | None,
    ) -> VolundrSession | None:
        """Spawn a contract planner session via Volundr."""
        adapters = await self._volundr_factory.for_owner(owner_id)
        if not adapters:
            logger.error(
                "No authenticated Volundr adapter for owner %s",
                owner_id[:8],
            )
            return None

        volundr = adapters[0]

        initial_prompt = build_contract_initial_prompt(
            raid_tracker_id=raid.tracker_id,
            raid_name=raid.name,
            raid_description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            working_session_id=working_session.id if working_session else "",
            max_rounds=self._cfg.contract_max_rounds,
            template=self._cfg.contract_initial_prompt_template,
        )

        request = SpawnRequest(
            name=f"contract-{(raid.identifier or raid.tracker_id[:8]).lower()}",
            repo=working_session.repo if working_session else "",
            branch=working_session.branch if working_session else "",
            base_branch=working_session.base_branch if working_session else "",
            model=self._cfg.contract_model,
            tracker_issue_id=raid.identifier or raid.tracker_id,
            tracker_issue_url=raid.url or "",
            system_prompt=self._cfg.contract_system_prompt,
            initial_prompt=initial_prompt,
            workload_type="planner",
            profile=self._cfg.contract_profile,
        )

        try:
            return await volundr.spawn_session(request)
        except Exception:
            logger.warning(
                "Failed to spawn contract planner for raid %s",
                raid.tracker_id,
                exc_info=True,
            )
            return None

    # -- Lifecycle --

    async def start(self) -> None:
        """Subscribe to the event bus and react to raids entering CONTRACTING.

        Rebuilds the in-memory contract session mapping from the database
        so that contract completions are handled after a restart.
        """
        await self._rebuild_contract_sessions()
        if self._event_bus is None:
            return
        self._task = asyncio.create_task(self._listen())

    async def _rebuild_contract_sessions(self) -> None:
        """Rebuild _contract_sessions from DB.

        Queries all active dispatchers and their trackers to find raids
        in CONTRACTING state with a planner_session_id.
        """
        if self._dispatcher_repo is None:
            return

        try:
            owner_ids = await self._dispatcher_repo.list_active_owner_ids()
        except Exception:
            logger.warning("Could not list active owners for contract rebuild", exc_info=True)
            return

        for owner_id in owner_ids:
            trackers = await self._tracker_factory.for_owner(owner_id)
            for tracker in trackers:
                raids = await tracker.list_raids_by_status(RaidStatus.CONTRACTING)
                for raid in raids:
                    if raid.planner_session_id:
                        self._contract_sessions[raid.planner_session_id] = (
                            raid.tracker_id,
                            owner_id,
                        )
        if self._contract_sessions:
            logger.info(
                "Rebuilt %d contract session mapping(s) from database",
                len(self._contract_sessions),
            )

    async def stop(self) -> None:
        """Cancel the event listener task."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _listen(self) -> None:
        """Listen for raid.state_changed events where status == CONTRACTING."""
        if self._event_bus is None:
            logger.warning("Contract engine has no event bus — cannot listen")
            return
        q = self._event_bus.subscribe()
        logger.info("Contract engine listening for raid.state_changed events")
        try:
            while True:
                event = await q.get()
                if event.event != "raid.state_changed":
                    continue
                if event.data.get("status") != RaidStatus.CONTRACTING.value:
                    continue
                tracker_id = event.data.get("tracker_id")
                owner_id = event.owner_id
                if not tracker_id or not owner_id:
                    logger.warning(
                        "Skipping — missing tracker_id=%s or owner_id=%s",
                        tracker_id,
                        owner_id,
                    )
                    continue
                logger.info(
                    "Contract engine evaluating raid %s for owner %s",
                    tracker_id,
                    owner_id[:8],
                )
                try:
                    await self.evaluate(tracker_id, owner_id)
                except Exception:
                    logger.warning(
                        "Contract engine failed for raid %s",
                        tracker_id,
                        exc_info=True,
                    )
        except asyncio.CancelledError:
            return
        finally:
            if self._event_bus is not None:
                self._event_bus.unsubscribe(q)

    # -- Helpers --

    def _cleanup_session(self, session_id: str) -> None:
        """Remove a session from tracking maps."""
        self._contract_sessions.pop(session_id, None)
        self._contract_rounds.pop(session_id, None)

    async def _emit_event(self, event_name: str, owner_id: str, data: dict) -> None:
        """Emit an event via the event bus."""
        if self._event_bus is None:
            return
        await self._event_bus.emit(TyrEvent(event=event_name, owner_id=owner_id, data=data))
