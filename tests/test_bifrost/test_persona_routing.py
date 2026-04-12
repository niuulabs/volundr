"""Tests for NIU-583 — persona-aware model routing via X-Ravn-Agent-Id.

Covers:
 - RoutingContext.agent_id field
 - RuleCondition.agent_id fnmatch pattern condition
 - YamlRuleEngine matching agent_id patterns (exact, wildcard, no-match)
 - BifrostConfig.degradation_chain in BudgetGuardrailConfig
 - _resolve_degraded_model() — downgrade chain logic
 - BudgetDegradedEvent structure
 - _evaluate_guardrails() — degradation chain + event emission + agent_id in context
 - Header-based routing: reviewer* → Opus, ship* → Haiku, no header → default
"""

from __future__ import annotations

from datetime import UTC, datetime

from bifrost.adapters.memory_store import MemoryUsageStore
from bifrost.adapters.rules.yaml_engine import YamlRuleEngine
from bifrost.auth import AgentIdentity
from bifrost.config import (
    AgentPermissions,
    BifrostConfig,
    BudgetGuardrailConfig,
    GuardrailsConfig,
    ProviderConfig,
    QuotaConfig,
    RuleCondition,
    RuleConfig,
)
from bifrost.inbound.routes import _evaluate_guardrails, _resolve_degraded_model
from bifrost.ports.events import BudgetDegradedEvent, CostEventEmitter
from bifrost.ports.rules import RoutingContext
from bifrost.ports.usage_store import UsageRecord
from bifrost.translation.models import AnthropicRequest, Message

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _req(model: str = "claude-sonnet-4-6") -> AnthropicRequest:
    return AnthropicRequest(
        model=model,
        max_tokens=100,
        messages=[Message(role="user", content="hi")],
    )


def _identity(agent_id: str = "agent-1", session_id: str = "sess-1") -> AgentIdentity:
    return AgentIdentity(agent_id=agent_id, tenant_id="tenant-1", session_id=session_id)


def _now_record(agent_id: str = "agent-1", cost_usd: float = 0.0) -> UsageRecord:
    return UsageRecord(
        request_id="",
        agent_id=agent_id,
        tenant_id="tenant-1",
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


def _cfg() -> BifrostConfig:
    return BifrostConfig(
        providers={
            "anthropic": ProviderConfig(
                models=[
                    "claude-opus-4-6",
                    "claude-sonnet-4-6",
                    "claude-haiku-4-5-20251001",
                ]
            )
        }
    )


# ---------------------------------------------------------------------------
# RoutingContext.agent_id
# ---------------------------------------------------------------------------


class TestRoutingContextAgentId:
    def test_default_agent_id_is_empty_string(self):
        ctx = RoutingContext()
        assert ctx.agent_id == ""

    def test_agent_id_can_be_set(self):
        ctx = RoutingContext(agent_id="reviewer-bot")
        assert ctx.agent_id == "reviewer-bot"

    def test_agent_id_and_budget_pct_independent(self):
        ctx = RoutingContext(agent_id="qa-agent", agent_budget_pct=42.0)
        assert ctx.agent_id == "qa-agent"
        assert ctx.agent_budget_pct == 42.0


# ---------------------------------------------------------------------------
# RuleCondition.agent_id field
# ---------------------------------------------------------------------------


class TestRuleConditionAgentId:
    def test_agent_id_defaults_to_none(self):
        cond = RuleCondition()
        assert cond.agent_id is None

    def test_agent_id_can_be_set(self):
        cond = RuleCondition(agent_id="reviewer*")
        assert cond.agent_id == "reviewer*"

    def test_agent_id_deserialized_from_dict(self):
        rule = RuleConfig.model_validate(
            {
                "name": "reviewer-to-opus",
                "when": {"agent_id": "reviewer*"},
                "action": "route_to",
                "target": "claude-opus-4-6",
            }
        )
        assert rule.when.agent_id == "reviewer*"
        assert rule.action == "route_to"
        assert rule.target == "claude-opus-4-6"


# ---------------------------------------------------------------------------
# YamlRuleEngine — agent_id condition matching
# ---------------------------------------------------------------------------


class TestYamlRuleEngineAgentIdCondition:
    def _engine(self, pattern: str) -> YamlRuleEngine:
        cfg = _cfg()
        return YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="agent-rule",
                    when=RuleCondition(agent_id=pattern),
                    action="log",
                )
            ],
            config=cfg,
        )

    def test_exact_match_fires(self):
        engine = self._engine("reviewer")
        ctx = RoutingContext(agent_id="reviewer")
        assert engine.evaluate(_req(), ctx) is not None

    def test_wildcard_suffix_matches(self):
        engine = self._engine("reviewer*")
        ctx = RoutingContext(agent_id="reviewer-bot")
        assert engine.evaluate(_req(), ctx) is not None

    def test_wildcard_suffix_matches_base_name(self):
        engine = self._engine("reviewer*")
        ctx = RoutingContext(agent_id="reviewer")
        assert engine.evaluate(_req(), ctx) is not None

    def test_wildcard_suffix_does_not_match_different_prefix(self):
        engine = self._engine("reviewer*")
        ctx = RoutingContext(agent_id="ship-agent")
        assert engine.evaluate(_req(), ctx) is None

    def test_ship_wildcard_matches_ship_agent(self):
        engine = self._engine("ship*")
        ctx = RoutingContext(agent_id="ship-agent")
        assert engine.evaluate(_req(), ctx) is not None

    def test_qa_wildcard_matches_qa_bot(self):
        engine = self._engine("qa*")
        ctx = RoutingContext(agent_id="qa-bot")
        assert engine.evaluate(_req(), ctx) is not None

    def test_empty_agent_id_does_not_match_specific_pattern(self):
        engine = self._engine("reviewer*")
        ctx = RoutingContext(agent_id="")
        assert engine.evaluate(_req(), ctx) is None

    def test_wildcard_star_matches_any_agent_id(self):
        engine = self._engine("*")
        ctx = RoutingContext(agent_id="anything-at-all")
        assert engine.evaluate(_req(), ctx) is not None

    def test_wildcard_star_does_not_match_empty_agent_id(self):
        """fnmatch('', '*') is True, but an absent header must never match."""
        engine = self._engine("*")
        ctx = RoutingContext(agent_id="")
        assert engine.evaluate(_req(), ctx) is None

    def test_agent_id_combined_with_model_condition(self):
        cfg = _cfg()
        engine = YamlRuleEngine(
            rules=[
                RuleConfig(
                    name="combo-rule",
                    when=RuleCondition(agent_id="reviewer*", model="claude-opus-4-6"),
                    action="log",
                )
            ],
            config=cfg,
        )
        # Both match
        ctx_match = RoutingContext(agent_id="reviewer-bot")
        assert engine.evaluate(_req(model="claude-opus-4-6"), ctx_match) is not None
        # Only agent_id matches
        ctx_match2 = RoutingContext(agent_id="reviewer-bot")
        assert engine.evaluate(_req(model="claude-sonnet-4-6"), ctx_match2) is None
        # Only model matches
        ctx_no_match = RoutingContext(agent_id="ship-agent")
        assert engine.evaluate(_req(model="claude-opus-4-6"), ctx_no_match) is None


class TestPersonaRoutingRules:
    """Validate the three canonical persona rules from the task spec."""

    def _engine_with_persona_rules(self) -> YamlRuleEngine:
        cfg = _cfg()
        rules = [
            RuleConfig(
                name="reviewer-to-opus",
                when=RuleCondition(agent_id="reviewer*"),
                action="route_to",
                target="claude-opus-4-6",
            ),
            RuleConfig(
                name="ship-to-haiku",
                when=RuleCondition(agent_id="ship*"),
                action="route_to",
                target="claude-haiku-4-5-20251001",
            ),
            RuleConfig(
                name="qa-to-sonnet",
                when=RuleCondition(agent_id="qa*"),
                action="route_to",
                target="claude-sonnet-4-6",
            ),
        ]
        return YamlRuleEngine(rules=rules, config=cfg)

    def test_reviewer_routes_to_opus(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id="reviewer"))
        assert result is not None
        assert result.target == "claude-opus-4-6"

    def test_reviewer_bot_routes_to_opus(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id="reviewer-bot"))
        assert result is not None
        assert result.target == "claude-opus-4-6"

    def test_ship_agent_routes_to_haiku(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id="ship-agent"))
        assert result is not None
        assert result.target == "claude-haiku-4-5-20251001"

    def test_qa_agent_routes_to_sonnet(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id="qa-bot"))
        assert result is not None
        assert result.target == "claude-sonnet-4-6"

    def test_no_agent_id_falls_through_all_rules(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id=""))
        assert result is None

    def test_unknown_agent_id_falls_through(self):
        engine = self._engine_with_persona_rules()
        result = engine.evaluate(_req(), RoutingContext(agent_id="unknown-agent"))
        assert result is None

    def test_first_match_wins_reviewer_not_qa(self):
        cfg = _cfg()
        rules = [
            RuleConfig(
                name="reviewer-to-opus",
                when=RuleCondition(agent_id="reviewer*"),
                action="route_to",
                target="claude-opus-4-6",
            ),
            RuleConfig(
                name="catch-all-to-haiku",
                when=RuleCondition(agent_id="*"),
                action="route_to",
                target="claude-haiku-4-5-20251001",
            ),
        ]
        engine = YamlRuleEngine(rules=rules, config=cfg)
        result = engine.evaluate(_req(), RoutingContext(agent_id="reviewer"))
        assert result is not None
        assert result.target == "claude-opus-4-6"
        assert result.rule_name == "reviewer-to-opus"


# ---------------------------------------------------------------------------
# BudgetGuardrailConfig.degradation_chain
# ---------------------------------------------------------------------------


_CHAIN = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]


class TestBudgetGuardrailConfigDegradationChain:
    def test_default_chain_is_empty(self):
        cfg = BudgetGuardrailConfig()
        assert cfg.degradation_chain == []

    def test_chain_can_be_configured(self):
        cfg = BudgetGuardrailConfig(degradation_chain=_CHAIN)
        assert cfg.degradation_chain == _CHAIN

    def test_chain_deserialized_from_dict(self):
        cfg = BudgetGuardrailConfig.model_validate(
            {
                "warn_at_pct": 80,
                "warn_action": "route_to",
                "warn_target": "fast",
                "hard_limit_action": "reject",
                "degradation_chain": _CHAIN,
            }
        )
        assert cfg.degradation_chain == _CHAIN

    def test_duplicate_in_chain_raises(self):
        import pytest

        with pytest.raises(Exception, match="duplicate"):
            BudgetGuardrailConfig(
                degradation_chain=["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-6"]
            )


# ---------------------------------------------------------------------------
# _resolve_degraded_model
# ---------------------------------------------------------------------------


class TestResolveDegradedModel:
    def _budget_cfg(self, chain: list[str], warn_target: str = "fast") -> BudgetGuardrailConfig:
        return BudgetGuardrailConfig(
            degradation_chain=chain,
            warn_target=warn_target,
        )

    def test_empty_chain_returns_warn_target(self):
        cfg = self._budget_cfg(chain=[], warn_target="claude-haiku-4-5-20251001")
        assert _resolve_degraded_model("claude-opus-4-6", cfg) == "claude-haiku-4-5-20251001"

    def test_opus_downgrades_to_sonnet(self):
        cfg = self._budget_cfg(chain=_CHAIN)
        assert _resolve_degraded_model("claude-opus-4-6", cfg) == "claude-sonnet-4-6"

    def test_sonnet_downgrades_to_haiku(self):
        cfg = self._budget_cfg(chain=_CHAIN)
        result = _resolve_degraded_model("claude-sonnet-4-6", cfg)
        assert result == "claude-haiku-4-5-20251001"

    def test_haiku_stays_at_haiku(self):
        cfg = self._budget_cfg(chain=_CHAIN)
        result = _resolve_degraded_model("claude-haiku-4-5-20251001", cfg)
        assert result == "claude-haiku-4-5-20251001"

    def test_unknown_model_returns_last_in_chain(self):
        cfg = self._budget_cfg(chain=_CHAIN)
        result = _resolve_degraded_model("unknown-model", cfg)
        assert result == "claude-haiku-4-5-20251001"

    def test_single_item_chain_returns_itself(self):
        cfg = self._budget_cfg(chain=["claude-haiku-4-5-20251001"])
        result = _resolve_degraded_model("claude-haiku-4-5-20251001", cfg)
        assert result == "claude-haiku-4-5-20251001"


# ---------------------------------------------------------------------------
# BudgetDegradedEvent
# ---------------------------------------------------------------------------


class TestBudgetDegradedEvent:
    def test_event_type(self):
        evt = BudgetDegradedEvent(
            agent_id="reviewer",
            session_id="sess-1",
            original_model="claude-opus-4-6",
            degraded_model="claude-sonnet-4-6",
            budget_pct_consumed=85.0,
            daily_limit_usd=10.0,
            spent_usd=8.5,
        )
        assert evt.type == "bifrost.budget.degraded"

    def test_fields_are_set(self):
        evt = BudgetDegradedEvent(
            agent_id="ship-agent",
            session_id="sess-abc",
            original_model="claude-opus-4-6",
            degraded_model="claude-haiku-4-5-20251001",
            budget_pct_consumed=95.0,
            daily_limit_usd=5.0,
            spent_usd=4.75,
        )
        assert evt.agent_id == "ship-agent"
        assert evt.session_id == "sess-abc"
        assert evt.original_model == "claude-opus-4-6"
        assert evt.degraded_model == "claude-haiku-4-5-20251001"
        assert evt.budget_pct_consumed == 95.0
        assert evt.daily_limit_usd == 5.0
        assert evt.spent_usd == 4.75


# ---------------------------------------------------------------------------
# _evaluate_guardrails — degradation chain + event emission + agent_id context
# ---------------------------------------------------------------------------


class FakeEmitter(CostEventEmitter):
    """Test double that records all emitted events."""

    def __init__(self) -> None:
        self.degraded_events: list[BudgetDegradedEvent] = []

    async def emit_request_completed(self, event) -> None:  # noqa: ANN001
        pass

    async def emit_budget_warning(self, event) -> None:  # noqa: ANN001
        pass

    async def emit_budget_degraded(self, event: BudgetDegradedEvent) -> None:
        self.degraded_events.append(event)


class TestEvaluateGuardrailsAgentIdInContext:
    """RoutingContext.agent_id is populated from identity.agent_id."""

    async def test_agent_id_propagated_to_context(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        store = MemoryUsageStore()
        identity = _identity(agent_id="reviewer-bot")
        agent_perms = AgentPermissions()

        _, ctx, _ = await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert ctx.agent_id == "reviewer-bot"

    async def test_agent_id_empty_string_when_anonymous(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        store = MemoryUsageStore()
        identity = _identity(agent_id="")
        agent_perms = AgentPermissions()

        _, ctx, _ = await _evaluate_guardrails(_req(), identity, config, store, agent_perms)

        assert ctx.agent_id == ""


class TestEvaluateGuardrailsDegradationChain:
    """_evaluate_guardrails uses the chain when budget threshold is hit."""

    async def test_opus_downgrades_to_sonnet_via_chain(self):
        config = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-opus-4-6", "claude-sonnet-4-6"])
            },
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    degradation_chain=_CHAIN,
                )
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        new_req, _, budget_warn = await _evaluate_guardrails(
            _req(model="claude-opus-4-6"), identity, config, store, agent_perms
        )

        assert new_req.model == "claude-sonnet-4-6"
        assert "routed_to=claude-sonnet-4-6" in budget_warn

    async def test_sonnet_downgrades_to_haiku_via_chain(self):
        config = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(
                    models=["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
                )
            },
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    degradation_chain=_CHAIN,
                )
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        new_req, _, _ = await _evaluate_guardrails(
            _req(model="claude-sonnet-4-6"), identity, config, store, agent_perms
        )

        assert new_req.model == "claude-haiku-4-5-20251001"

    async def test_empty_chain_falls_back_to_warn_target(self):
        config = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-opus-4-6", "claude-haiku-4-5-20251001"])
            },
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    warn_target="claude-haiku-4-5-20251001",
                    degradation_chain=[],
                )
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        new_req, _, _ = await _evaluate_guardrails(
            _req(model="claude-opus-4-6"), identity, config, store, agent_perms
        )

        assert new_req.model == "claude-haiku-4-5-20251001"


class TestEvaluateGuardrailsBudgetDegradedEvent:
    """bifrost.budget.degraded is emitted when degradation fires."""

    async def test_event_emitted_on_degradation(self):
        config = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-opus-4-6", "claude-sonnet-4-6"])
            },
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    degradation_chain=_CHAIN,
                )
            ),
        )
        store = _seeded_store(_now_record(agent_id="reviewer-bot", cost_usd=0.85))
        identity = _identity(agent_id="reviewer-bot", session_id="sess-xyz")
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        emitter = FakeEmitter()

        await _evaluate_guardrails(
            _req(model="claude-opus-4-6"),
            identity,
            config,
            store,
            agent_perms,
            emitter,
        )

        assert len(emitter.degraded_events) == 1
        evt = emitter.degraded_events[0]
        assert evt.agent_id == "reviewer-bot"
        assert evt.session_id == "sess-xyz"
        assert evt.original_model == "claude-opus-4-6"
        assert evt.degraded_model == "claude-sonnet-4-6"
        assert evt.type == "bifrost.budget.degraded"

    async def test_no_event_when_below_threshold(self):
        config = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-opus-4-6"])},
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    degradation_chain=_CHAIN,
                )
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.50))  # 50% — below threshold
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
        emitter = FakeEmitter()

        await _evaluate_guardrails(
            _req(model="claude-opus-4-6"),
            identity,
            config,
            store,
            agent_perms,
            emitter,
        )

        assert len(emitter.degraded_events) == 0

    async def test_no_event_when_no_emitter(self):
        """When event_emitter=None, no error is raised."""
        config = BifrostConfig(
            providers={
                "anthropic": ProviderConfig(models=["claude-opus-4-6", "claude-sonnet-4-6"])
            },
            guardrails=GuardrailsConfig(
                budget=BudgetGuardrailConfig(
                    warn_at_pct=80.0,
                    degradation_chain=_CHAIN,
                )
            ),
        )
        store = _seeded_store(_now_record(cost_usd=0.85))
        identity = _identity()
        agent_perms = AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))

        new_req, _, budget_warn = await _evaluate_guardrails(
            _req(model="claude-opus-4-6"),
            identity,
            config,
            store,
            agent_perms,
            None,  # no emitter
        )

        assert new_req.model == "claude-sonnet-4-6"
        assert budget_warn is not None


# ---------------------------------------------------------------------------
# Sleipnir registry constant
# ---------------------------------------------------------------------------


class TestSleipnirRegistry:
    def test_budget_degraded_event_type_registered(self):
        from sleipnir.domain.registry import BIFROST_BUDGET_DEGRADED

        assert BIFROST_BUDGET_DEGRADED == "bifrost.budget.degraded"


# ---------------------------------------------------------------------------
# NullEventEmitter and SleipnirEventEmitter implement emit_budget_degraded
# ---------------------------------------------------------------------------


class TestNullEmitterBudgetDegraded:
    async def test_emit_budget_degraded_is_noop(self):
        from bifrost.adapters.events.null import NullEventEmitter

        emitter = NullEventEmitter()
        evt = BudgetDegradedEvent(
            agent_id="a",
            session_id="s",
            original_model="claude-opus-4-6",
            degraded_model="claude-sonnet-4-6",
            budget_pct_consumed=85.0,
            daily_limit_usd=10.0,
            spent_usd=8.5,
        )
        # Should not raise
        await emitter.emit_budget_degraded(evt)
