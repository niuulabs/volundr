"""RuleEnginePort — abstract interface for declarative routing rule engines."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum

from bifrost.translation.models import AnthropicRequest


class RuleAction(StrEnum):
    """Actions a matched rule can take."""

    ROUTE_TO = "route_to"
    """Override the model/alias used for routing."""

    REJECT = "reject"
    """Reject the request with HTTP 400."""

    LOG = "log"
    """Emit a full-level audit log entry; request continues unchanged."""

    TAG = "tag"
    """Add metadata tags to the audit entry; request continues unchanged."""

    STRIP_IMAGES = "strip_images"
    """Remove all image blocks from the request before forwarding."""


@dataclass
class RuleMatch:
    """The result of a successful rule evaluation."""

    rule_name: str
    """Name of the matched rule."""

    action: RuleAction
    """Action to take."""

    target: str | None = None
    """Model or alias to route to (only for ROUTE_TO)."""

    message: str | None = None
    """Rejection message shown to the caller (only for REJECT)."""

    tags: dict = field(default_factory=dict)
    """Metadata tags to attach to the audit entry (only for TAG)."""


@dataclass
class RoutingContext:
    """Per-request context passed alongside the request during rule evaluation.

    Carries computed values that are not present in the raw request body, such
    as the remaining agent budget percentage.
    """

    agent_budget_pct: float | None = field(
        default=None,
        metadata={"description": "Fraction (0–100) of the agent's daily budget already consumed."},
    )
    """Remaining agent budget as a percentage (0–100).

    ``None`` when the usage store has not been queried or when there is no
    per-agent budget configured (M4 feature).
    """


class RuleEnginePort(ABC):
    """Abstract interface for rule engines that evaluate routing rules.

    Implementations receive the inbound request and a routing context and
    return the first matching ``RuleMatch``, or ``None`` if no rule fires.
    """

    @abstractmethod
    def evaluate(
        self,
        request: AnthropicRequest,
        context: RoutingContext,
    ) -> RuleMatch | None:
        """Evaluate rules against *request* and *context*.

        Rules are evaluated in order; the first match wins.

        Args:
            request: The inbound Anthropic-format request.
            context: Extra per-request routing context.

        Returns:
            The first matching ``RuleMatch``, or ``None`` if no rule fires.
        """
