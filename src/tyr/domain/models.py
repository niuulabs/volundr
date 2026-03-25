"""Domain models for the Tyr saga coordinator."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from tyr.domain.exceptions import InvalidStateTransitionError

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class SagaStatus(StrEnum):
    ACTIVE = "ACTIVE"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class PhaseStatus(StrEnum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    GATED = "GATED"
    COMPLETE = "COMPLETE"


class RaidStatus(StrEnum):
    PENDING = "PENDING"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    REVIEW = "REVIEW"
    MERGED = "MERGED"
    FAILED = "FAILED"


class ConfidenceEventType(StrEnum):
    CI_PASS = "ci_pass"
    CI_FAIL = "ci_fail"
    SCOPE_BREACH = "scope_breach"
    RETRY = "retry"
    HUMAN_REJECT = "human_reject"
    HUMAN_APPROVED = "human_approved"


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

RAID_TRANSITIONS: dict[RaidStatus, frozenset[RaidStatus]] = {
    RaidStatus.PENDING: frozenset({RaidStatus.QUEUED}),
    RaidStatus.QUEUED: frozenset({RaidStatus.RUNNING, RaidStatus.FAILED}),
    RaidStatus.RUNNING: frozenset({RaidStatus.REVIEW, RaidStatus.MERGED, RaidStatus.FAILED}),
    RaidStatus.REVIEW: frozenset(
        {
            RaidStatus.PENDING,
            RaidStatus.QUEUED,
            RaidStatus.MERGED,
            RaidStatus.FAILED,
        }
    ),
    RaidStatus.MERGED: frozenset(),
    RaidStatus.FAILED: frozenset({RaidStatus.QUEUED}),
}


def validate_transition(current: RaidStatus, target: RaidStatus) -> None:
    """Validate a raid state transition, raising on invalid moves."""
    allowed = RAID_TRANSITIONS.get(current, frozenset())
    if target not in allowed:
        raise InvalidStateTransitionError(current, target)


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Saga:
    id: UUID
    tracker_id: str
    tracker_type: str
    slug: str
    name: str
    repos: list[str]
    feature_branch: str
    status: SagaStatus
    confidence: float
    created_at: datetime
    base_branch: str = "main"
    owner_id: str = ""


@dataclass(frozen=True)
class Phase:
    id: UUID
    saga_id: UUID
    tracker_id: str
    number: int
    name: str
    status: PhaseStatus
    confidence: float


@dataclass(frozen=True)
class Raid:
    id: UUID
    phase_id: UUID
    tracker_id: str
    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float | None
    status: RaidStatus
    confidence: float
    session_id: str | None
    branch: str | None
    chronicle_summary: str | None
    pr_url: str | None
    pr_id: str | None
    retry_count: int
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ConfidenceEvent:
    id: UUID
    raid_id: UUID
    event_type: ConfidenceEventType
    delta: float
    score_after: float
    created_at: datetime


@dataclass(frozen=True)
class DispatcherState:
    id: UUID
    owner_id: str
    running: bool
    threshold: float
    max_concurrent_raids: int
    updated_at: datetime


@dataclass(frozen=True)
class SessionInfo:
    session_id: str
    status: str


@dataclass(frozen=True)
class PRStatus:
    pr_id: str
    url: str
    state: str
    mergeable: bool
    ci_passed: bool | None


# ---------------------------------------------------------------------------
# Tracker browsing models (read-only, pre-import)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TrackerProject:
    """A project from an external tracker (read-only browsing model)."""

    id: str
    name: str
    description: str
    status: str
    url: str
    milestone_count: int
    issue_count: int
    slug: str = ""
    progress: float = 0.0
    start_date: str | None = None
    target_date: str | None = None


@dataclass(frozen=True)
class TrackerMilestone:
    """A milestone from an external tracker (read-only browsing model)."""

    id: str
    project_id: str
    name: str
    description: str
    sort_order: int
    progress: float
    target_date: str | None = None


@dataclass(frozen=True)
class TrackerIssue:
    """An issue from an external tracker (read-only browsing model)."""

    id: str
    identifier: str
    title: str
    description: str
    status: str
    status_type: str = ""
    assignee: str | None = None
    labels: list[str] | None = None
    priority: int = 0
    priority_label: str = ""
    estimate: float | None = None
    url: str = ""
    milestone_id: str | None = None


# ---------------------------------------------------------------------------
# Spec structures (LLM decomposition output)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RaidSpec:
    name: str
    description: str
    acceptance_criteria: list[str]
    declared_files: list[str]
    estimate_hours: float


@dataclass(frozen=True)
class PhaseSpec:
    name: str
    raids: list[RaidSpec]


@dataclass(frozen=True)
class SagaStructure:
    phases: list[PhaseSpec]


# ---------------------------------------------------------------------------
# Personal access tokens — re-exported from shared niuu module
# ---------------------------------------------------------------------------

from niuu.domain.models import PersonalAccessToken  # noqa: F401, E402
