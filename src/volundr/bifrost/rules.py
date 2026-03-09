"""Rule engine — classify requests and return routing labels."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from volundr.bifrost.models import ParsedRequest, RequestContext

logger = logging.getLogger(__name__)


class Rule(ABC):
    """A single classification rule.  First match wins."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def label(self) -> str: ...

    @abstractmethod
    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool: ...


# ------------------------------------------------------------------
# Built-in rules
# ------------------------------------------------------------------


class BackgroundRule(Rule):
    """Matches Claude Code's lightweight internal requests (haiku)."""

    @property
    def name(self) -> str:
        return "background"

    @property
    def label(self) -> str:
        return "background"

    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool:
        return "haiku" in request.model.lower()


class ThinkingRule(Rule):
    """Matches requests with extended thinking enabled."""

    @property
    def name(self) -> str:
        return "thinking"

    @property
    def label(self) -> str:
        return "think"

    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool:
        return request.thinking_enabled


class TokenCountRule(Rule):
    """Matches requests where estimated token count exceeds a threshold."""

    def __init__(self, threshold: int = 60000) -> None:
        self._threshold = threshold

    @property
    def name(self) -> str:
        return "token_count"

    @property
    def label(self) -> str:
        return "large_context"

    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool:
        return request.estimated_tokens > self._threshold


class ToolResultRule(Rule):
    """Matches when the last message is entirely tool_result content."""

    @property
    def name(self) -> str:
        return "tool_result"

    @property
    def label(self) -> str:
        return "tool_passthrough"

    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool:
        return request.last_message_is_tool_result


class DefaultRule(Rule):
    """Always matches.  Must be the last rule."""

    @property
    def name(self) -> str:
        return "default"

    @property
    def label(self) -> str:
        return "default"

    def matches(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> bool:
        return True


# ------------------------------------------------------------------
# Rule engine
# ------------------------------------------------------------------


class RuleEngine:
    """Evaluates an ordered list of rules.  First match wins."""

    def __init__(self, rules: list[Rule]) -> None:
        self._rules = rules

    def evaluate(
        self,
        request: ParsedRequest,
        context: RequestContext,
    ) -> str:
        for rule in self._rules:
            if rule.matches(request, context):
                logger.debug(
                    "Rule matched: %s → %s",
                    rule.name,
                    rule.label,
                )
                return rule.label
        return "default"

    @property
    def rules(self) -> list[Rule]:
        return list(self._rules)


# ------------------------------------------------------------------
# Factory
# ------------------------------------------------------------------

_RULE_CLASSES: dict[str, type[Rule]] = {
    "BackgroundRule": BackgroundRule,
    "ThinkingRule": ThinkingRule,
    "TokenCountRule": TokenCountRule,
    "ToolResultRule": ToolResultRule,
    "DefaultRule": DefaultRule,
}


def build_rules(configs: list[dict[str, Any]]) -> list[Rule]:
    """Instantiate rules from config entries.

    Each entry has ``rule`` (class name) and optional ``params`` (kwargs).
    """
    rules: list[Rule] = []
    for entry in configs:
        class_name = entry.get("rule", "")
        cls = _RULE_CLASSES.get(class_name)
        if cls is None:
            logger.warning("Unknown rule class: %s (skipped)", class_name)
            continue
        params = entry.get("params", {})
        rules.append(cls(**params))
    return rules
