"""Tests for the Bifröst rule engine."""

from __future__ import annotations

from volundr.bifrost.models import ParsedRequest, RequestContext
from volundr.bifrost.rules import (
    BackgroundRule,
    DefaultRule,
    RuleEngine,
    ThinkingRule,
    TokenCountRule,
    ToolResultRule,
    build_rules,
)


def _make_request(
    *,
    model: str = "claude-sonnet-4-5-20250929",
    messages: list | None = None,
    stream: bool = False,
    tools: list | None = None,
    thinking_enabled: bool = False,
    max_tokens: int = 4096,
    system: str | None = None,
) -> ParsedRequest:
    return ParsedRequest(
        model=model,
        messages=messages or [{"role": "user", "content": "hi"}],
        stream=stream,
        tools=tools or [],
        thinking_enabled=thinking_enabled,
        max_tokens=max_tokens,
        system=system,
        raw_body=b"{}",
    )


def _context(request: ParsedRequest) -> RequestContext:
    return RequestContext(request=request)


class TestBackgroundRule:
    def test_matches_haiku_model(self):
        rule = BackgroundRule()
        req = _make_request(model="claude-3-5-haiku-20241022")
        assert rule.matches(req, _context(req)) is True

    def test_no_match_sonnet(self):
        rule = BackgroundRule()
        req = _make_request(model="claude-sonnet-4-5-20250929")
        assert rule.matches(req, _context(req)) is False

    def test_label(self):
        assert BackgroundRule().label == "background"

    def test_name(self):
        assert BackgroundRule().name == "background"


class TestThinkingRule:
    def test_matches_thinking_enabled(self):
        rule = ThinkingRule()
        req = _make_request(thinking_enabled=True)
        assert rule.matches(req, _context(req)) is True

    def test_no_match_thinking_disabled(self):
        rule = ThinkingRule()
        req = _make_request(thinking_enabled=False)
        assert rule.matches(req, _context(req)) is False

    def test_label(self):
        assert ThinkingRule().label == "think"


class TestTokenCountRule:
    def test_matches_above_threshold(self):
        rule = TokenCountRule(threshold=100)
        # 500 chars / 4 = 125 tokens
        req = _make_request(
            messages=[{"role": "user", "content": "x" * 500}],
        )
        assert rule.matches(req, _context(req)) is True

    def test_no_match_below_threshold(self):
        rule = TokenCountRule(threshold=100)
        req = _make_request(
            messages=[{"role": "user", "content": "hi"}],
        )
        assert rule.matches(req, _context(req)) is False

    def test_custom_threshold(self):
        rule = TokenCountRule(threshold=10)
        req = _make_request(
            messages=[{"role": "user", "content": "a" * 44}],
        )
        assert rule.matches(req, _context(req)) is True

    def test_label(self):
        assert TokenCountRule().label == "large_context"


class TestToolResultRule:
    def test_matches_tool_result_message(self):
        rule = ToolResultRule()
        req = _make_request(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"},
                    ],
                },
            ],
        )
        assert rule.matches(req, _context(req)) is True

    def test_no_match_text_message(self):
        rule = ToolResultRule()
        req = _make_request()
        assert rule.matches(req, _context(req)) is False

    def test_no_match_mixed_content(self):
        rule = ToolResultRule()
        req = _make_request(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "hello"},
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"},
                    ],
                },
            ],
        )
        assert rule.matches(req, _context(req)) is False

    def test_label(self):
        assert ToolResultRule().label == "tool_passthrough"


class TestDefaultRule:
    def test_always_matches(self):
        rule = DefaultRule()
        req = _make_request()
        assert rule.matches(req, _context(req)) is True

    def test_label(self):
        assert DefaultRule().label == "default"


class TestRuleEngine:
    def test_first_match_wins(self):
        engine = RuleEngine([BackgroundRule(), DefaultRule()])
        req = _make_request(model="claude-3-5-haiku-20241022")
        label = engine.evaluate(req, _context(req))
        assert label == "background"

    def test_falls_through_to_default(self):
        engine = RuleEngine([BackgroundRule(), DefaultRule()])
        req = _make_request(model="claude-sonnet-4-5-20250929")
        label = engine.evaluate(req, _context(req))
        assert label == "default"

    def test_returns_default_when_no_rules(self):
        engine = RuleEngine([])
        req = _make_request()
        label = engine.evaluate(req, _context(req))
        assert label == "default"

    def test_multiple_rules_priority(self):
        engine = RuleEngine(
            [
                ThinkingRule(),
                BackgroundRule(),
                DefaultRule(),
            ]
        )
        # Thinking + haiku — thinking should win (first match)
        req = _make_request(
            model="claude-3-5-haiku-20241022",
            thinking_enabled=True,
        )
        label = engine.evaluate(req, _context(req))
        assert label == "think"

    def test_rules_property(self):
        rules = [BackgroundRule(), DefaultRule()]
        engine = RuleEngine(rules)
        assert len(engine.rules) == 2


class TestBuildRules:
    def test_builds_from_config(self):
        configs = [
            {"rule": "BackgroundRule"},
            {"rule": "ThinkingRule"},
            {"rule": "DefaultRule"},
        ]
        rules = build_rules(configs)
        assert len(rules) == 3
        assert rules[0].name == "background"
        assert rules[1].name == "thinking"
        assert rules[2].name == "default"

    def test_skips_unknown_rules(self):
        configs = [
            {"rule": "UnknownRule"},
            {"rule": "DefaultRule"},
        ]
        rules = build_rules(configs)
        assert len(rules) == 1
        assert rules[0].name == "default"

    def test_passes_params(self):
        configs = [
            {"rule": "TokenCountRule", "params": {"threshold": 50000}},
        ]
        rules = build_rules(configs)
        assert len(rules) == 1
        assert rules[0]._threshold == 50000  # noqa: SLF001

    def test_empty_config(self):
        rules = build_rules([])
        assert rules == []
