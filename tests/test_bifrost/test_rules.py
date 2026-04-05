"""Tests for the declarative routing rule engine (NIU-478).

Covers:
 - ports/rules.py          — RuleEnginePort, RuleMatch, RoutingContext, RuleAction
 - adapters/rules/yaml_engine.py — YamlRuleEngine (all conditions + actions)
 - domain/routing.py        — apply_rules(), RuleRejectError
 - config.py                — RuleConfig, RuleCondition validation
 - app.py                   — _build_rule_engine factory
 - router.py                — rule evaluation wired into complete() and stream()
 - inbound/routes.py        — RuleRejectError → HTTP 400 mapping
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from bifrost.adapters.rules.yaml_engine import YamlRuleEngine, _compare_numeric, _parse_numeric_expr
from bifrost.app import _build_rule_engine, create_app
from bifrost.config import BifrostConfig, ProviderConfig, RuleCondition, RuleConfig
from bifrost.domain.routing import RuleRejectError, apply_rules
from bifrost.ports.rules import RoutingContext, RuleAction, RuleEnginePort, RuleMatch
from bifrost.router import ModelRouter
from bifrost.translation.models import (
    AnthropicRequest,
    AnthropicResponse,
    Message,
    TextBlock,
    ToolDefinition,
    UsageInfo,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _req(
    model: str = "gpt-4o",
    max_tokens: int = 1024,
    thinking: dict | None = None,
    tools: list[ToolDefinition] | None = None,
) -> AnthropicRequest:
    return AnthropicRequest(
        model=model,
        max_tokens=max_tokens,
        messages=[Message(role="user", content="hi")],
        thinking=thinking,
        tools=tools,
    )


def _cfg_with_rules(rules: list[RuleConfig]) -> BifrostConfig:
    return BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        aliases={"fast": "claude-haiku", "balanced": "claude-sonnet-4-6"},
        rules=rules,
    )


def _make_response() -> AnthropicResponse:
    return AnthropicResponse(
        id="msg_test",
        content=[TextBlock(text="ok")],
        model="claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=5, output_tokens=3),
    )


# ---------------------------------------------------------------------------
# _parse_numeric_expr
# ---------------------------------------------------------------------------


class TestParseNumericExpr:
    def test_less_than_or_equal(self):
        assert _parse_numeric_expr("<= 512") == ("<=", 512.0)

    def test_greater_than_or_equal(self):
        assert _parse_numeric_expr(">= 80") == (">=", 80.0)

    def test_less_than(self):
        assert _parse_numeric_expr("< 100") == ("<", 100.0)

    def test_greater_than(self):
        assert _parse_numeric_expr("> 0") == (">", 0.0)

    def test_equal(self):
        assert _parse_numeric_expr("== 42") == ("==", 42.0)

    def test_not_equal(self):
        assert _parse_numeric_expr("!= 0") == ("!=", 0.0)

    def test_plain_number_becomes_equality(self):
        assert _parse_numeric_expr("512") == ("==", 512.0)

    def test_decimal_rhs(self):
        assert _parse_numeric_expr(">= 0.5") == (">=", 0.5)

    def test_invalid_raises_value_error(self):
        with pytest.raises(ValueError, match="Cannot parse"):
            _parse_numeric_expr("not-a-number")


# ---------------------------------------------------------------------------
# _compare_numeric
# ---------------------------------------------------------------------------


class TestCompareNumeric:
    def test_lte_true(self):
        assert _compare_numeric(512, "<= 512") is True

    def test_lte_false(self):
        assert _compare_numeric(513, "<= 512") is False

    def test_gte_true(self):
        assert _compare_numeric(80, ">= 80") is True

    def test_gte_false(self):
        assert _compare_numeric(79, ">= 80") is False

    def test_lt_true(self):
        assert _compare_numeric(99, "< 100") is True

    def test_lt_false(self):
        assert _compare_numeric(100, "< 100") is False

    def test_gt_true(self):
        assert _compare_numeric(1, "> 0") is True

    def test_eq_true(self):
        assert _compare_numeric(42, "== 42") is True

    def test_ne_true(self):
        assert _compare_numeric(1, "!= 0") is True

    def test_ne_false(self):
        assert _compare_numeric(0, "!= 0") is False

    def test_plain_number_equality(self):
        assert _compare_numeric(256, "256") is True


# ---------------------------------------------------------------------------
# RoutingContext
# ---------------------------------------------------------------------------


class TestRoutingContext:
    def test_default_agent_budget_pct_is_none(self):
        ctx = RoutingContext()
        assert ctx.agent_budget_pct is None

    def test_can_set_budget_pct(self):
        ctx = RoutingContext(agent_budget_pct=85.0)
        assert ctx.agent_budget_pct == 85.0


# ---------------------------------------------------------------------------
# RuleCondition and RuleConfig
# ---------------------------------------------------------------------------


class TestRuleCondition:
    def test_all_fields_default_to_none(self):
        cond = RuleCondition()
        assert cond.model is None
        assert cond.max_tokens is None
        assert cond.thinking is None
        assert cond.agent_budget_pct is None
        assert cond.provider is None
        assert cond.has_tools is None

    def test_explicit_values(self):
        cond = RuleCondition(model="gpt-4o", thinking=True, max_tokens="<= 512")
        assert cond.model == "gpt-4o"
        assert cond.thinking is True
        assert cond.max_tokens == "<= 512"


class TestRuleConfig:
    def test_route_to_rule(self):
        rule = RuleConfig(
            name="test-rule",
            when=RuleCondition(thinking=True),
            action="route_to",
            target="anthropic",
        )
        assert rule.name == "test-rule"
        assert rule.action == "route_to"
        assert rule.target == "anthropic"

    def test_reject_rule(self):
        rule = RuleConfig(
            name="reject-rule",
            when=RuleCondition(model="bad-model"),
            action="reject",
            message="Not allowed",
        )
        assert rule.message == "Not allowed"

    def test_log_rule(self):
        rule = RuleConfig(name="log-rule", when=RuleCondition(), action="log")
        assert rule.action == "log"


# ---------------------------------------------------------------------------
# YamlRuleEngine — condition matching
# ---------------------------------------------------------------------------


class TestYamlRuleEngineModelCondition:
    def test_matches_exact_model(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(model="gpt-4o"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="gpt-4o"), RoutingContext()) is not None

    def test_does_not_match_different_model(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(model="gpt-4o"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="claude-sonnet-4-6"), RoutingContext()) is None


class TestYamlRuleEngineMaxTokensCondition:
    def test_matches_lte_512_at_boundary(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(max_tokens="<= 512"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(max_tokens=512), RoutingContext()) is not None

    def test_does_not_match_lte_512_above(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(max_tokens="<= 512"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(max_tokens=513), RoutingContext()) is None

    def test_matches_gte_80(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(max_tokens=">= 1000"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(max_tokens=1024), RoutingContext()) is not None


class TestYamlRuleEngineThinkingCondition:
    def test_matches_thinking_enabled(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(thinking=True), action="log")],
            config=cfg,
        )
        req = _req(thinking={"type": "enabled", "budget_tokens": 5000})
        assert engine.evaluate(req, RoutingContext()) is not None

    def test_does_not_match_thinking_disabled(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(thinking=True), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(thinking=None), RoutingContext()) is None

    def test_thinking_false_matches_when_no_thinking(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(thinking=False), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(thinking=None), RoutingContext()) is not None

    def test_thinking_disabled_type_not_enabled(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(thinking=True), action="log")],
            config=cfg,
        )
        # type != "enabled" → not considered thinking
        req = _req(thinking={"type": "disabled"})
        assert engine.evaluate(req, RoutingContext()) is None


class TestYamlRuleEngineHasToolsCondition:
    def test_matches_has_tools_true(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(has_tools=True), action="log")],
            config=cfg,
        )
        tools = [ToolDefinition(name="search", input_schema={})]
        assert engine.evaluate(_req(tools=tools), RoutingContext()) is not None

    def test_does_not_match_has_tools_true_when_no_tools(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(has_tools=True), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(tools=None), RoutingContext()) is None

    def test_matches_has_tools_false_when_no_tools(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(has_tools=False), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(tools=None), RoutingContext()) is not None


class TestYamlRuleEngineAgentBudgetPctCondition:
    def test_matches_gte_80_with_context(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(name="r", when=RuleCondition(agent_budget_pct=">= 80"), action="log")
            ],
            config=cfg,
        )
        ctx = RoutingContext(agent_budget_pct=85.0)
        assert engine.evaluate(_req(), ctx) is not None

    def test_does_not_match_below_threshold(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(name="r", when=RuleCondition(agent_budget_pct=">= 80"), action="log")
            ],
            config=cfg,
        )
        ctx = RoutingContext(agent_budget_pct=70.0)
        assert engine.evaluate(_req(), ctx) is None

    def test_skips_when_context_budget_is_none(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(name="r", when=RuleCondition(agent_budget_pct=">= 80"), action="log")
            ],
            config=cfg,
        )
        assert engine.evaluate(_req(), RoutingContext()) is None


class TestYamlRuleEngineProviderCondition:
    def test_matches_correct_provider(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            rules=[],
        )
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(provider="anthropic"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="claude-sonnet-4-6"), RoutingContext()) is not None

    def test_does_not_match_wrong_provider(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            rules=[],
        )
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(provider="openai"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="claude-sonnet-4-6"), RoutingContext()) is None

    def test_provider_via_alias(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            aliases={"sonnet": "claude-sonnet-4-6"},
            rules=[],
        )
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(provider="anthropic"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="sonnet"), RoutingContext()) is not None


class TestYamlRuleEngineMultipleConditions:
    def test_all_conditions_must_match(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="r",
                    when=RuleCondition(max_tokens="<= 512", thinking=False),
                    action="log",
                )
            ],
            config=cfg,
        )
        # Both conditions match
        assert engine.evaluate(_req(max_tokens=256), RoutingContext()) is not None
        # Only max_tokens matches, thinking doesn't
        assert (
            engine.evaluate(_req(max_tokens=256, thinking={"type": "enabled"}), RoutingContext())
            is None
        )
        # Only thinking matches, max_tokens doesn't
        assert engine.evaluate(_req(max_tokens=1024), RoutingContext()) is None

    def test_empty_when_matches_all_requests(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="catch-all", when=RuleCondition(), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(), RoutingContext()) is not None


class TestYamlRuleEngineFirstMatchWins:
    def test_first_matching_rule_fires(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(name="first", when=RuleCondition(model="gpt-4o"), action="log"),
                RuleConfig(
                    name="second",
                    when=RuleCondition(model="gpt-4o"),
                    action="reject",
                    message="nope",
                ),
            ],
            config=cfg,
        )
        result = engine.evaluate(_req(model="gpt-4o"), RoutingContext())
        assert result is not None
        assert result.rule_name == "first"
        assert result.action == RuleAction.LOG

    def test_no_rules_returns_none(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(rules=[], config=cfg)
        assert engine.evaluate(_req(), RoutingContext()) is None

    def test_no_matching_rule_returns_none(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="r", when=RuleCondition(model="other"), action="log")],
            config=cfg,
        )
        assert engine.evaluate(_req(model="gpt-4o"), RoutingContext()) is None


class TestYamlRuleEngineActions:
    def test_route_to_returns_correct_match(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="r",
                    when=RuleCondition(thinking=True),
                    action="route_to",
                    target="anthropic",
                )
            ],
            config=cfg,
        )
        req = _req(thinking={"type": "enabled", "budget_tokens": 5000})
        result = engine.evaluate(req, RoutingContext())
        assert result is not None
        assert result.action == RuleAction.ROUTE_TO
        assert result.target == "anthropic"

    def test_reject_returns_correct_match(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="r",
                    when=RuleCondition(model="forbidden"),
                    action="reject",
                    message="Model is not allowed",
                )
            ],
            config=cfg,
        )
        result = engine.evaluate(_req(model="forbidden"), RoutingContext())
        assert result is not None
        assert result.action == RuleAction.REJECT
        assert result.message == "Model is not allowed"

    def test_log_returns_correct_match(self):
        cfg = _cfg_with_rules([])
        engine = YamlRuleEngine(
            rules=[RuleConfig(name="audit", when=RuleCondition(), action="log")],
            config=cfg,
        )
        result = engine.evaluate(_req(), RoutingContext())
        assert result is not None
        assert result.action == RuleAction.LOG
        assert result.rule_name == "audit"


# ---------------------------------------------------------------------------
# apply_rules()
# ---------------------------------------------------------------------------


class FakeRuleEngine(RuleEnginePort):
    """Test double that returns a fixed match (or None)."""

    def __init__(self, match: RuleMatch | None = None) -> None:
        self._match = match

    def evaluate(self, request: AnthropicRequest, context: RoutingContext) -> RuleMatch | None:
        return self._match


class TestApplyRules:
    def test_no_engine_returns_request_unchanged(self):
        req = _req(model="gpt-4o")
        result = apply_rules(req, RoutingContext(), engine=None)
        assert result is req

    def test_no_match_returns_request_unchanged(self):
        req = _req(model="gpt-4o")
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=None))
        assert result is req

    def test_route_to_overrides_model(self):
        req = _req(model="gpt-4o")
        match = RuleMatch(rule_name="r", action=RuleAction.ROUTE_TO, target="claude-sonnet-4-6")
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert result.model == "claude-sonnet-4-6"
        # Original request is not mutated
        assert req.model == "gpt-4o"

    def test_reject_raises_rule_reject_error(self):
        req = _req(model="bad")
        match = RuleMatch(rule_name="r", action=RuleAction.REJECT, message="Not allowed")
        with pytest.raises(RuleRejectError) as exc_info:
            apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert exc_info.value.message == "Not allowed"
        assert exc_info.value.rule_name == "r"

    def test_reject_uses_default_message_when_none(self):
        req = _req(model="bad")
        match = RuleMatch(rule_name="my-rule", action=RuleAction.REJECT, message=None)
        with pytest.raises(RuleRejectError) as exc_info:
            apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert "my-rule" in exc_info.value.message

    def test_log_returns_request_unchanged(self):
        req = _req(model="gpt-4o")
        match = RuleMatch(rule_name="audit", action=RuleAction.LOG)
        result = apply_rules(req, RoutingContext(), engine=FakeRuleEngine(match=match))
        assert result is req


# ---------------------------------------------------------------------------
# ModelRouter integration
# ---------------------------------------------------------------------------


class FakeProvider:
    def __init__(self, response=None, raises=None):
        self._response = response or _make_response()
        self._raises = raises
        self.complete_calls: list = []
        self.stream_calls: list = []

    async def complete(self, request, model):
        self.complete_calls.append((request, model))
        if self._raises:
            raise self._raises
        return self._response

    async def stream(self, request, model) -> AsyncIterator[str]:
        self.stream_calls.append((request, model))
        if self._raises:
            raise self._raises
        yield "data: test\n\n"

    async def close(self):
        pass


class TestModelRouterRuleIntegrationTracked:
    @pytest.mark.asyncio
    async def test_complete_respects_route_to_rule(self):
        cfg = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-sonnet-4-6"]),
                "openai": ProviderConfig(models=["gpt-4o"]),
            },
        )
        match = RuleMatch(rule_name="r", action=RuleAction.ROUTE_TO, target="claude-sonnet-4-6")
        router = ModelRouter(cfg, rule_engine=FakeRuleEngine(match=match))

        anthropic_fake = FakeProvider()
        openai_fake = FakeProvider()
        router._adapters["anthropic"] = anthropic_fake
        router._adapters["openai"] = openai_fake

        await router.complete(_req(model="gpt-4o"))
        assert len(anthropic_fake.complete_calls) == 1
        assert len(openai_fake.complete_calls) == 0

    @pytest.mark.asyncio
    async def test_complete_propagates_reject_error(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        match = RuleMatch(rule_name="r", action=RuleAction.REJECT, message="Rejected")
        router = ModelRouter(cfg, rule_engine=FakeRuleEngine(match=match))
        with pytest.raises(RuleRejectError, match="Rejected"):
            await router.complete(_req(model="claude-sonnet-4-6"))

    @pytest.mark.asyncio
    async def test_stream_respects_route_to_rule(self):
        cfg = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-sonnet-4-6"]),
                "openai": ProviderConfig(models=["gpt-4o"]),
            },
        )
        match = RuleMatch(rule_name="r", action=RuleAction.ROUTE_TO, target="claude-sonnet-4-6")
        router = ModelRouter(cfg, rule_engine=FakeRuleEngine(match=match))
        fake = FakeProvider()
        router._adapters["anthropic"] = fake

        chunks = []
        async for chunk in router.stream(_req(model="gpt-4o")):
            chunks.append(chunk)
        assert chunks == ["data: test\n\n"]
        assert len(fake.stream_calls) == 1

    @pytest.mark.asyncio
    async def test_stream_propagates_reject_error(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        match = RuleMatch(rule_name="r", action=RuleAction.REJECT, message="No streaming")
        router = ModelRouter(cfg, rule_engine=FakeRuleEngine(match=match))
        with pytest.raises(RuleRejectError):
            async for _ in router.stream(_req(model="claude-sonnet-4-6")):
                pass


# ---------------------------------------------------------------------------
# _build_rule_engine (app factory)
# ---------------------------------------------------------------------------


class TestBuildRuleEngine:
    def test_returns_none_when_no_rules(self):
        cfg = BifrostConfig(providers={"a": ProviderConfig(models=["m"])}, rules=[])
        assert _build_rule_engine(cfg) is None

    def test_returns_yaml_engine_when_rules_configured(self):
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine

        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            rules=[RuleConfig(name="r", when=RuleCondition(), action="log")],
        )
        engine = _build_rule_engine(cfg)
        assert engine is not None
        assert isinstance(engine, YamlRuleEngine)


# ---------------------------------------------------------------------------
# HTTP layer: RuleRejectError → 400
# ---------------------------------------------------------------------------


def _make_test_client_with_rules(rules: list[RuleConfig]) -> TestClient:
    cfg = BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        rules=rules,
    )
    app = create_app(cfg)
    with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as mock_complete:
        mock_complete.side_effect = RuleRejectError("r", "Request rejected by rule 'r'")
        client = TestClient(app, raise_server_exceptions=False)
        return client


class TestHttpRuleReject:
    def test_messages_endpoint_returns_400_on_rule_reject(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        app = create_app(cfg)

        with patch(
            "bifrost.router.ModelRouter.complete",
            new_callable=AsyncMock,
            side_effect=RuleRejectError("r", "Blocked by rule"),
        ):
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post(
                "/v1/messages",
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 100,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 400
        assert "Blocked by rule" in resp.json()["detail"]

    def test_chat_completions_endpoint_returns_400_on_rule_reject(self):
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        app = create_app(cfg)

        with patch(
            "bifrost.router.ModelRouter.complete",
            new_callable=AsyncMock,
            side_effect=RuleRejectError("r", "Blocked by rule"),
        ):
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post(
                "/v1/chat/completions",
                json={
                    "model": "claude-sonnet-4-6",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# BifrostConfig with rules field
# ---------------------------------------------------------------------------


class TestBifrostConfigWithRules:
    def test_default_rules_is_empty(self):
        cfg = BifrostConfig()
        assert cfg.rules == []

    def test_rules_deserialized_from_dict(self):
        cfg = BifrostConfig.model_validate(
            {
                "providers": {},
                "rules": [
                    {
                        "name": "thinking-requires-anthropic",
                        "when": {"thinking": True},
                        "action": "route_to",
                        "target": "anthropic",
                    }
                ],
            }
        )
        assert len(cfg.rules) == 1
        assert cfg.rules[0].name == "thinking-requires-anthropic"
        assert cfg.rules[0].when.thinking is True
        assert cfg.rules[0].action == "route_to"
        assert cfg.rules[0].target == "anthropic"

    def test_full_example_from_spec(self):
        """Validate the exact YAML structure from the NIU-478 task description."""
        cfg = BifrostConfig.model_validate(
            {
                "providers": {},
                "rules": [
                    {
                        "name": "thinking-requires-anthropic",
                        "when": {"thinking": True},
                        "action": "route_to",
                        "target": "anthropic",
                    },
                    {
                        "name": "small-tasks-stay-local",
                        "when": {"max_tokens": "<= 512", "model": "fast"},
                        "action": "route_to",
                        "target": "local",
                    },
                    {
                        "name": "force-balanced-on-budget",
                        "when": {"agent_budget_pct": ">= 80"},
                        "action": "route_to",
                        "target": "balanced",
                    },
                ],
            }
        )
        assert len(cfg.rules) == 3
        assert cfg.rules[1].when.max_tokens == "<= 512"
        assert cfg.rules[1].when.model == "fast"
        assert cfg.rules[2].when.agent_budget_pct == ">= 80"


# ---------------------------------------------------------------------------
# AnthropicRequest thinking field
# ---------------------------------------------------------------------------


class TestAnthropicRequestThinking:
    def test_thinking_defaults_to_none(self):
        req = AnthropicRequest(
            model="m",
            max_tokens=10,
            messages=[Message(role="user", content="hi")],
        )
        assert req.thinking is None

    def test_thinking_can_be_set(self):
        req = AnthropicRequest(
            model="m",
            max_tokens=10,
            messages=[Message(role="user", content="hi")],
            thinking={"type": "enabled", "budget_tokens": 5000},
        )
        assert req.thinking == {"type": "enabled", "budget_tokens": 5000}
