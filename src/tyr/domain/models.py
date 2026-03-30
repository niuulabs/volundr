"""Domain models for Tyr raid orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class RaidStatus(StrEnum):
    """Status of a raid."""

    QUEUED = "QUEUED"
    CONTRACTING = "CONTRACTING"
    RUNNING = "RUNNING"
    ESCALATED = "ESCALATED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


RAID_TRANSITIONS: dict[RaidStatus, frozenset[RaidStatus]] = {
    RaidStatus.QUEUED: frozenset({RaidStatus.CONTRACTING, RaidStatus.RUNNING, RaidStatus.FAILED}),
    RaidStatus.CONTRACTING: frozenset(
        {RaidStatus.RUNNING, RaidStatus.ESCALATED, RaidStatus.FAILED}
    ),
    RaidStatus.RUNNING: frozenset({RaidStatus.COMPLETED, RaidStatus.ESCALATED, RaidStatus.FAILED}),
    RaidStatus.ESCALATED: frozenset({RaidStatus.FAILED}),
    RaidStatus.FAILED: frozenset(),
    RaidStatus.COMPLETED: frozenset(),
}


def is_valid_transition(current: RaidStatus, target: RaidStatus) -> bool:
    """Check whether a raid status transition is allowed."""
    return target in RAID_TRANSITIONS.get(current, frozenset())


class ContractStatus(StrEnum):
    """Status of a contract negotiation."""

    PENDING = "PENDING"
    AGREED = "AGREED"
    FAILED = "FAILED"


class ConfidenceEventType(StrEnum):
    """Types of confidence-affecting events."""

    CONTRACT_AGREED = "contract_agreed"
    CONTRACT_FAILED = "contract_failed"


@dataclass(frozen=True)
class ContractNegotiation:
    """A contract negotiation between planner and working sessions.

    CONTRACTING means both planner and working sessions are alive;
    the working session is idle waiting for the contract message
    before it starts coding.
    """

    id: UUID
    raid_id: UUID
    planner_session_id: str
    working_session_id: str
    status: ContractStatus
    acceptance_criteria: list[str]
    declared_files: list[str]
    rounds: int
    created_at: datetime
    agreed_at: datetime | None
