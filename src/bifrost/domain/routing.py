"""Routing domain logic: rule evaluation before strategy selection.

``apply_rules`` is the single entry-point called by the ``ModelRouter`` before
it builds provider candidates.  It delegates to whichever ``RuleEnginePort``
implementation is configured, and handles the three possible outcomes:

* ``route_to``  — returns a copy of the request with the model overridden.
* ``reject``    — raises ``RuleRejectError`` (callers map this to HTTP 400).
* ``log``       — emits a full-level audit log entry, returns the request unchanged.
"""

from __future__ import annotations

import logging

from bifrost.ports.rules import RoutingContext, RuleAction, RuleEnginePort
from bifrost.translation.models import AnthropicRequest

logger = logging.getLogger(__name__)


class RuleRejectError(Exception):
    """Raised when a routing rule rejects the request."""

    def __init__(self, rule_name: str, message: str) -> None:
        super().__init__(message)
        self.rule_name = rule_name
        self.message = message


def apply_rules(
    request: AnthropicRequest,
    context: RoutingContext,
    engine: RuleEnginePort | None,
) -> AnthropicRequest:
    """Evaluate *engine*'s rules against *request* and act on the first match.

    If *engine* is ``None`` (no rules configured), the request is returned
    unchanged.

    Args:
        request: Inbound Anthropic-format request.
        context: Per-request routing context (agent budget, etc.).
        engine:  Rule engine to evaluate, or ``None`` to skip.

    Returns:
        The original request, or a copy with an overridden model when a
        ``route_to`` rule fires.

    Raises:
        RuleRejectError: When a ``reject`` rule fires.
    """
    if engine is None:
        return request

    match_result = engine.evaluate(request, context)
    if match_result is None:
        return request

    match match_result.action:
        case RuleAction.ROUTE_TO:
            logger.debug(
                "Rule '%s' rerouting model '%s' → '%s'",
                match_result.rule_name,
                request.model,
                match_result.target,
            )
            return request.model_copy(update={"model": match_result.target})

        case RuleAction.REJECT:
            reject_msg = match_result.message or (
                f"Request rejected by rule '{match_result.rule_name}'"
            )
            logger.info(
                "Rule '%s' rejected request for model '%s': %s",
                match_result.rule_name,
                request.model,
                reject_msg,
            )
            raise RuleRejectError(match_result.rule_name, reject_msg)

        case RuleAction.LOG:
            logger.info(
                "AUDIT rule='%s' model='%s' action=log",
                match_result.rule_name,
                request.model,
            )
            return request

        case _:
            logger.warning("Unknown rule action '%s'; ignoring", match_result.action)
            return request
