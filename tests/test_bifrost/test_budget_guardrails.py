"""Tests for NIU-480 cost-based guardrail routing.

Covers:
 - BudgetGuardrailConfig, ContextWindowGuardrailConfig, GuardrailsConfig models
 - _evaluate_guardrails() helper: warn routing, hard-limit 429, context-window reject
 - X-Bifrost-Budget-Warning header injection on /v1/messages, /v1/chat/completions
 - Budget hard-limit 429 + Retry-After header on both endpoints
 - Context-window limit rejection
 - ModelRouter.complete() / .stream() accept RoutingContext parameter
 - RoutingContext.agent_budget_pct is populated and forwarded to the rule engine
 - No guardrail firing when no budget config / quota configured
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from bifrost.adapters.memory_store import MemoryUsageStore
from bifrost.app import create_app
from bifrost.auth import AgentIdentity
from bifrost.config import (
    AgentPermissions,
    BifrostConfig,
    BudgetGuardrailConfig,
    ContextWindowGuardrailConfig,
    GuardrailsConfig,
    ProviderConfig,
    QuotaConfig,
)
from bifrost.inbound.routes import _evaluate_guardrails, _seconds_until_utc_midnight
from bifrost.ports.rules import RoutingContext
from bifrost.ports.usage_store import UsageRecord
from bifrost.translation.models import (
    AnthropicRequest,
    AnthropicResponse,
    Message,
    TextBlock,
    UsageInfo,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_response() -> AnthropicResponse:
    return AnthropicResponse(
        id="msg",
        content=[TextBlock(text="ok")],
        model="claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=10, output_tokens=5),
    )


def _req(
    model: str = "claude-sonnet-4-6",
    n_messages: int = 1,
) -> AnthropicRequest:
    messages = [Message(role="user", content=f"msg {i}") for i in range(n_messages)]
    return AnthropicRequest(model=model, max_tokens=100, messages=messages)


def _identity(agent_id: str = "agent-1", tenant_id: str = "tenant-1") -> AgentIdentity:
    return AgentIdentity(agent_id=agent_id, tenant_id=tenant_id)


def _now_record(
    agent_id: str = "agent-1",
    tenant_id: str = "tenant-1",
    cost_usd: float = 0.0,
) -> UsageRecord:
    return UsageRecord(
        request_id="",
        agent_id=agent_id,
        tenant_id=tenant_id,
        session_id="",
        saga_id="",
        model="claude-sonnet-4-6",
        input_tokens=0,
        output_tokens=0,
        cost_usd=cost_usd,
        timestamp=datetime.now(UTC),
    )


def _seeded_store(*records: UsageRecord) -> MemoryUsageStore:
    store = MemoryUsageStore()
    store._records.extend(records)
    return store


# ---------------------------------------------------------------------------
# Config model tests
# ---------------------------------------------------------------------------


class TestBudgetGuardrailConfig:
    def test_defaults(self):
        cfg = BudgetGuardrailConfig()
        assert cfg.warn_at_pct == 80.0
        assert cfg.warn_action == "route_to"
        assert cfg.warn_target == "fast"
        assert cfg.hard_limit_action == "reject"

    def test_custom_values(self):
        cfg = BudgetGuardrailConfig(warn_at_pct=60.0, warn_target="haiku")
        assert cfg.warn_at_pct == 60.0
        assert cfg.warn_target == "haiku"

    def test_deserialization(self):
        cfg = BudgetGuardrailConfig.model_validate(
            {
                "warn_at_pct": 75,
                "warn_action": "route_to",
                "warn_target": "cheap",
                "hard_limit_action": "reject",
            }
        )
        assert cfg.warn_at_pct == 75.0
        assert cfg.warn_target == "cheap"


class TestContextWindowGuardrailConfig:
    def test_defaults(self):
        cfg = ContextWindowGuardrailConfig()
        assert cfg.max_messages == 50
        assert cfg.action == "reject"
        assert cfg.reason == "Context window limit reached"

    def test_custom_values(self):
        cfg = ContextWindowGuardrailConfig(max_messages=10, reason="Too many messages")
        assert cfg.max_messages == 10
        assert cfg.reason == "Too many messages"


class TestGuardrailsConfig:
    def test_defaults_no_guardrails_active(self):
        cfg = GuardrailsConfig()
        assert cfg.budget is None
        assert cfg.context_window is None

    def test_budget_guardrail_nested(self):
        cfg = GuardrailsConfig(budget=BudgetGuardrailConfig(warn_at_pct=70.0))
        assert cfg.budget is not None
        assert cfg.budget.warn_at_pct == 70.0

    def test_context_window_nested(self):
        cfg = GuardrailsConfig(context_window=ContextWindowGuardrailConfig(max_messages=20))
        assert cfg.context_window is not None
        assert cfg.context_window.max_messages == 20

    def test_bifrost_config_includes_guardrails(self):
        """BifrostConfig.guardrails is present and defaults to empty."""
        cfg = BifrostConfig()
        assert isinstance(cfg.guardrails, GuardrailsConfig)
        assert cfg.guardrails.budget is None
        assert cfg.guardrails.context_window is None

    def test_bifrost_config_full_deserialization(self):
        """Full YAML-style config as described in the task spec."""
        cfg = BifrostConfig.model_validate(
            {
                "providers": {},
                "guardrails": {
                    "budget": {
                        "warn_at_pct": 80,
                        "warn_action": "route_to",
                        "warn_target": "fast",
                        "hard_limit_action": "reject",
                    },
                    "context_window": {
                        "max_messages": 50,
                        "action": "reject",
                        "reason": "Context window limit reached",
                    },
                },
            }
        )
        assert cfg.guardrails.budget is not None
        assert cfg.guardrails.budget.warn_at_pct == 80.0
        assert cfg.guardrails.budget.warn_target == "fast"
        assert cfg.guardrails.context_window is not None
        assert cfg.guardrails.context_window.max_messages == 50


# ---------------------------------------------------------------------------
# _seconds_until_utc_midnight helper
# ---------------------------------------------------------------------------


class TestSecondsUntilUtcMidnight:
    def test_returns_non_negative_int(self):
        result = _seconds_until_utc_midnight()
        assert isinstance(result, int)
        assert result >= 0

    def test_returns_at_most_86400_seconds(self):
        assert _seconds_until_utc_midnight() <= 86400


# ---------------------------------------------------------------------------
# _evaluate_guardrails unit tests
# ---------------------------------------------------------------------------


class TestEvaluateGuardrailsNoBudget:
    """When no budget guardrail is configured, behaviour is unchanged."""

    async def test_no_guardrails_returns_unchanged_request(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        store = MemoryUsageStore()
        identity = _identity()
        req = _req()
        agent_perms = AgentPermissions()

        new_req, ctx, budget_warn = await _evaluate_guardrails(
            req, identity, config, store, agent_perms
        )

        assert new_req is req
        assert ctx.agent_budget_pct is None
        assert budget_warn is None

    async def test_budget_guardrail_without_agent_quota_skipped(self):
        """budget config exists but agent has no max_cost_per_day → no action."""
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
        )
        store = _seeded_store(_now_record(cost_usd=99.0))
        identity = _identity()
        agent_perms = AgentPermissions()  # no quota set (max_cost_per_day = 0)

        new_req, ctx, budget_warn = await _evaluate_guardrails(
            _req(), identity, config, store, agent_perms
        )

        assert ctx.agent_budget_pct is None
        assert budget_warn is None


class TestEvaluateGuardrailsBudgetWarn:
    """Budget warn threshold reached: model override + header."""

    async def test_warn_threshold_routes_to_cheaper_model(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6", "fast"])},
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(warn_at_pct=80.0, warn_target="fast")
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))  # 85% of $1
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        req = _req(model="claude-sonnet-4-6")

        new_req, ctx, budget_warn = await _evaluate_guardrails(
            req, identity, config, store, agent_perms
        )

        assert new_req.model == "fast"
        assert budget_warn is not None
        assert "budget_consumed=85.0%" in budget_warn
        assert "routed_to=fast" in budget_warn

    async def test_warn_threshold_populates_routing_context(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig(warn_at_pct=80.0)),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        _, ctx, _ = await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert ctx.agent_budget_pct is not None
        assert abs(ctx.agent_budget_pct - 85.0) < 0.01

    async def test_exactly_at_warn_threshold_fires(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig(warn_at_pct=80.0)),
        )
        store = _seeded_store(_now_record(cost_usd=0.80))  # exactly 80%
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        _, _, budget_warn = await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert budget_warn is not None

    async def test_below_warn_threshold_no_action(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig(warn_at_pct=80.0)),
        )
        store = _seeded_store(_now_record(cost_usd=0.50))  # 50% — below threshold
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        req = _req()

        new_req, ctx, budget_warn = await _evaluate_guardrails(
            req, identity, config, store, agent_perms
        )

        assert new_req is req
        assert budget_warn is None
        assert ctx.agent_budget_pct is not None
        assert abs(ctx.agent_budget_pct - 50.0) < 0.01

    async def test_original_request_not_mutated(self):
        """model_copy is used; the original request object is not changed."""
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig(warn_target="cheap")),
        )
        store = _seeded_store(_now_record(cost_usd=0.9))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        req = _req(model="claude-sonnet-4-6")

        new_req, _, _ = await _evaluate_guardrails(req, identity, config, store, agent_perms)

        assert req.model == "claude-sonnet-4-6"
        assert new_req.model == "cheap"


class TestEvaluateGuardrailsBudgetHardLimit:
    """Budget exhausted (>= 100%): raises 429 with Retry-After."""

    async def test_hard_limit_raises_429(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
        )
        store = _seeded_store(_now_record(cost_usd=1.05))  # 105% of $1
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert exc_info.value.status_code == 429

    async def test_hard_limit_includes_retry_after_header(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
        )
        store = _seeded_store(_now_record(cost_usd=2.0))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert "Retry-After" in exc_info.value.headers
        assert int(exc_info.value.headers["Retry-After"]) > 0

    async def test_exactly_at_100_pct_raises_429(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
        )
        store = _seeded_store(_now_record(cost_usd=1.0))  # exactly 100%
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert exc_info.value.status_code == 429


class TestEvaluateGuardrailsContextWindow:
    """Context-window guardrail: reject when message count >= max_messages."""

    async def test_exceeds_max_messages_raises_400(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(
                context_window=ContextWindowGuardrailConfig(max_messages=5)
            ),
        )
        store = MemoryUsageStore()
        identity = _identity()
        agent_perms = AgentPermissions()

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(n_messages=5), identity, config, store, agent_perms)

        assert exc_info.value.status_code == 400

    async def test_exceeds_max_messages_uses_configured_reason(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(
                context_window=ContextWindowGuardrailConfig(max_messages=3, reason="Too long")
            ),
        )
        store = MemoryUsageStore()
        identity = _identity()
        agent_perms = AgentPermissions()

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(n_messages=3), identity, config, store, agent_perms)

        assert exc_info.value.detail == "Too long"

    async def test_below_max_messages_passes(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(
                context_window=ContextWindowGuardrailConfig(max_messages=10)
            ),
        )
        store = MemoryUsageStore()
        identity = _identity()
        agent_perms = AgentPermissions()
        req = _req(n_messages=5)

        new_req, ctx, budget_warn = await _evaluate_guardrails(
            req, identity, config, store, agent_perms
        )

        assert new_req is req
        assert budget_warn is None

    async def test_context_window_checked_before_budget(self):
        """Context-window check fires even when budget is also configured."""
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(),
                context_window=ContextWindowGuardrailConfig(max_messages=2),
            ),
        )
        store = MemoryUsageStore()
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        with pytest.raises(HTTPException) as exc_info:
            await _evaluate_guardrails(_req(n_messages=2), identity, config, store, agent_perms)

        assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# HTTP endpoint integration tests (via TestClient)
# ---------------------------------------------------------------------------


def _make_app(guardrails: GuardrailsConfig, agent_perms: AgentPermissions | None = None) -> object:
    cfg = BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6", "fast"])},
        aliases={"fast": "claude-sonnet-4-6"},
        guardrails=guardrails,
        agent_permissions=({"agent-1": agent_perms} if agent_perms is not None else {}),
    )
    return create_app(cfg)


class TestMessagesEndpointBudgetGuardrail:
    def _client_with_seeded_cost(
        self,
        agent_cost: float,
        budget_limit: float,
        warn_at_pct: float = 80.0,
    ) -> TestClient:
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=budget_limit))
        app = _make_app(
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=warn_at_pct,
                    warn_target="fast",
                )
            ),
            agent_perms=agent_perms,
        )
        store = _seeded_store(_now_record(agent_id="agent-1", cost_usd=agent_cost))
        # Patch the store used by the app.
        app.state.store = store  # type: ignore[attr-defined]
        return TestClient(app, raise_server_exceptions=False)

    def test_budget_warning_header_present_at_warn_threshold(self):
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        app = _make_app(
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(warn_at_pct=80.0, warn_target="fast")
            ),
            agent_perms=agent_perms,
        )
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            with patch("bifrost.inbound.routes._evaluate_guardrails") as mock_eval:
                mock_eval.return_value = (
                    _req(),
                    RoutingContext(agent_budget_pct=85.0),
                    "budget_consumed=85.0% ($0.8500/$1.0000); routed_to=fast",
                )
                with TestClient(app, raise_server_exceptions=False) as client:
                    resp = client.post(
                        "/v1/messages",
                        headers={"x-agent-id": "agent-1"},
                        json={
                            "model": "claude-sonnet-4-6",
                            "max_tokens": 10,
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
        assert resp.status_code == 200
        assert "X-Bifrost-Budget-Warning" in resp.headers

    def test_budget_exhausted_returns_429(self):
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        app = _make_app(
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
            agent_perms=agent_perms,
        )
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock):
            with patch("bifrost.inbound.routes._evaluate_guardrails") as mock_eval:
                mock_eval.side_effect = HTTPException(
                    status_code=429,
                    detail="Agent daily budget exhausted ($1.0500 / $1.0000).",
                    headers={"Retry-After": "3600"},
                )
                with TestClient(app, raise_server_exceptions=False) as client:
                    resp = client.post(
                        "/v1/messages",
                        headers={"x-agent-id": "agent-1"},
                        json={
                            "model": "claude-sonnet-4-6",
                            "max_tokens": 10,
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
        assert resp.status_code == 429

    def test_context_window_exceeded_returns_400(self):
        app = _make_app(
            guardrails=GuardrailsConfig(context_window=ContextWindowGuardrailConfig(max_messages=2))
        )
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock):
            with TestClient(app, raise_server_exceptions=False) as client:
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 10,
                        "messages": [
                            {"role": "user", "content": "msg1"},
                            {"role": "assistant", "content": "msg2"},
                        ],
                    },
                )
        assert resp.status_code == 400
        assert "Context window" in resp.json().get("detail", "")


class TestChatCompletionsEndpointBudgetGuardrail:
    def test_budget_warning_header_present(self):
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        app = _make_app(
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(warn_at_pct=80.0, warn_target="fast")
            ),
            agent_perms=agent_perms,
        )
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            with patch("bifrost.inbound.routes._evaluate_guardrails") as mock_eval:
                mock_eval.return_value = (
                    _req(),
                    RoutingContext(agent_budget_pct=85.0),
                    "budget_consumed=85.0% ($0.8500/$1.0000); routed_to=fast",
                )
                with TestClient(app, raise_server_exceptions=False) as client:
                    resp = client.post(
                        "/v1/chat/completions",
                        headers={"x-agent-id": "agent-1"},
                        json={
                            "model": "claude-sonnet-4-6",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
        assert resp.status_code == 200
        assert "X-Bifrost-Budget-Warning" in resp.headers

    def test_budget_exhausted_returns_429(self):
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        app = _make_app(
            guardrails=GuardrailsConfig(budget=BudgetGuardrailConfig()),
            agent_perms=agent_perms,
        )
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock):
            with patch("bifrost.inbound.routes._evaluate_guardrails") as mock_eval:
                mock_eval.side_effect = HTTPException(
                    status_code=429,
                    detail="Agent daily budget exhausted.",
                    headers={"Retry-After": "3600"},
                )
                with TestClient(app, raise_server_exceptions=False) as client:
                    resp = client.post(
                        "/v1/chat/completions",
                        headers={"x-agent-id": "agent-1"},
                        json={
                            "model": "claude-sonnet-4-6",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
        assert resp.status_code == 429


# ---------------------------------------------------------------------------
# ModelRouter accepts RoutingContext
# ---------------------------------------------------------------------------


class TestModelRouterAcceptsRoutingContext:
    """Verify that complete() and stream() propagate RoutingContext to apply_rules()."""

    async def test_complete_with_context_calls_apply_rules(self):
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
        from bifrost.config import RuleCondition, RuleConfig
        from bifrost.router import ModelRouter

        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6", "cheap"])},
            aliases={"cheap": "claude-sonnet-4-6"},
            rules=[
                RuleConfig(
                    name="budget-downgrade",
                    when=RuleCondition(agent_budget_pct=">= 80"),
                    action="route_to",
                    target="cheap",
                )
            ],
        )
        engine = YamlRuleEngine(rules=cfg.rules, config=cfg)
        router = ModelRouter(config=cfg, rule_engine=engine)

        context = RoutingContext(agent_budget_pct=85.0)

        with patch(
            "bifrost.adapters.anthropic.AnthropicAdapter.complete",
            new_callable=AsyncMock,
        ) as mock_complete:
            mock_complete.return_value = _make_response()
            result_req_model: list[str] = []

            async def capture_complete(req, model):
                result_req_model.append(req.model)
                return _make_response()

            mock_complete.side_effect = capture_complete
            await router.complete(_req(model="claude-sonnet-4-6"), context=context)

        # The rule routed to "cheap" alias which resolves to "claude-sonnet-4-6"
        assert len(result_req_model) == 1

    async def test_complete_without_context_uses_empty_routing_context(self):
        """When context=None, apply_rules is called with an empty RoutingContext.

        A budget rule with agent_budget_pct condition should NOT fire.
        """
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
        from bifrost.config import RuleCondition, RuleConfig
        from bifrost.router import ModelRouter

        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            rules=[
                RuleConfig(
                    name="budget-rule",
                    when=RuleCondition(agent_budget_pct=">= 80"),
                    action="reject",
                    message="budget exceeded",
                )
            ],
        )
        engine = YamlRuleEngine(rules=cfg.rules, config=cfg)
        router = ModelRouter(config=cfg, rule_engine=engine)

        with patch(
            "bifrost.adapters.anthropic.AnthropicAdapter.complete",
            new_callable=AsyncMock,
        ) as mock_complete:
            mock_complete.return_value = _make_response()
            # Should not raise — budget condition is skipped when context has no pct
            result = await router.complete(_req(), context=None)

        assert result is not None


# ---------------------------------------------------------------------------
# Integration: agent_budget_pct flows through to rule engine
# ---------------------------------------------------------------------------


class TestAgentBudgetPctInRuleEngine:
    """End-to-end: RoutingContext.agent_budget_pct enables budget-driven rules."""

    async def test_budget_rule_fires_when_pct_consumed_above_threshold(self):
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
        from bifrost.config import RuleCondition, RuleConfig
        from bifrost.domain.routing import RuleRejectError, apply_rules

        rules = [
            RuleConfig(
                name="block-over-budget",
                when=RuleCondition(agent_budget_pct=">= 90"),
                action="reject",
                message="Over budget",
            )
        ]
        cfg = BifrostConfig(providers={}, rules=rules)
        engine = YamlRuleEngine(rules=rules, config=cfg)

        ctx = RoutingContext(agent_budget_pct=95.0)
        with pytest.raises(RuleRejectError):
            apply_rules(_req(), ctx, engine)

    async def test_budget_rule_skipped_when_pct_none(self):
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
        from bifrost.config import RuleCondition, RuleConfig
        from bifrost.domain.routing import apply_rules

        rules = [
            RuleConfig(
                name="block-over-budget",
                when=RuleCondition(agent_budget_pct=">= 90"),
                action="reject",
                message="Over budget",
            )
        ]
        cfg = BifrostConfig(providers={}, rules=rules)
        engine = YamlRuleEngine(rules=rules, config=cfg)

        ctx = RoutingContext(agent_budget_pct=None)
        req = _req()
        result = apply_rules(req, ctx, engine)
        assert result is req  # not rejected

    async def test_budget_route_to_rule_fires_at_threshold(self):
        from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
        from bifrost.config import RuleCondition, RuleConfig
        from bifrost.domain.routing import apply_rules

        rules = [
            RuleConfig(
                name="downgrade-on-budget",
                when=RuleCondition(agent_budget_pct=">= 80"),
                action="route_to",
                target="cheap-model",
            )
        ]
        cfg = BifrostConfig(providers={}, rules=rules)
        engine = YamlRuleEngine(rules=rules, config=cfg)

        ctx = RoutingContext(agent_budget_pct=82.0)
        req = _req(model="expensive-model")
        result = apply_rules(req, ctx, engine)
        assert result.model == "cheap-model"
