"""Tests for dispatch-time flock flow snapshotting (NIU-643).

1. Dispatch with ``flock_flow: code-review-flow`` expands to the expected
   ``workload_config.personas`` list.
2. Snapshot race: mutating the flow *after* ``_build_spawn_request`` is called
   does not affect the already-built SpawnRequest.
3. Missing flow name falls back to ``flock_default_personas``.
4. ``_snapshot_hash`` produces a deterministic 8-char hex string.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

from tyr.adapters.flows.config import ConfigFlockFlowProvider
from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride, PersonaLLMOverride
from tyr.domain.models import Saga, SagaStatus, TrackerIssue
from tyr.domain.services.dispatch_service import (
    DispatchConfig,
    DispatchItem,
    DispatchService,
    _snapshot_hash,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_saga() -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id="proj-1",
        tracker_type="linear",
        slug="test",
        name="Test Saga",
        repos=["org/repo"],
        feature_branch="feat/test",
        base_branch="main",
        status=SagaStatus.ACTIVE,
        confidence=0.5,
        created_at=datetime.now(UTC),
        owner_id="user-1",
    )


def _make_issue(identifier: str = "NIU-100") -> TrackerIssue:
    return TrackerIssue(
        id="i-1",
        identifier=identifier,
        title="Test Issue",
        description="Do the thing.",
        status="Todo",
        url="https://linear.app/i-1",
    )


def _make_flock_config(provider: ConfigFlockFlowProvider | None = None) -> DispatchConfig:
    return DispatchConfig(
        flock_enabled=True,
        flock_default_personas=[{"name": "coordinator"}, {"name": "reviewer"}],
        flock_mimir_hosted_url="https://mimir.test",
        flock_sleipnir_publish_urls=["nats://bus.test"],
    )


def _svc(
    config: DispatchConfig | None = None,
    provider: ConfigFlockFlowProvider | None = None,
) -> DispatchService:
    svc = MagicMock(spec=DispatchService)
    svc._config = config or _make_flock_config()
    svc._flock_flow_provider = provider
    svc._resolve_flock_personas = DispatchService._resolve_flock_personas.__get__(svc)
    svc._build_spawn_request = DispatchService._build_spawn_request.__get__(svc)
    return svc


# ---------------------------------------------------------------------------
# 1. Flow expansion → workload_config.personas
# ---------------------------------------------------------------------------


class TestFlockFlowExpansion:
    def test_named_flow_personas_appear_in_workload_config(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        flow = FlockFlowConfig(
            name="code-review-flow",
            personas=[
                FlockPersonaOverride(name="coordinator"),
                FlockPersonaOverride(
                    name="reviewer",
                    llm=PersonaLLMOverride(primary_alias="powerful", thinking_enabled=True),
                ),
            ],
        )
        provider.save(flow)

        svc = _svc(provider=provider)
        item = DispatchItem(
            saga_id=str(uuid4()),
            issue_id="i-1",
            repo="org/repo",
            flock_flow="code-review-flow",
        )
        req = svc._build_spawn_request(
            item=item,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )

        assert req.workload_type == "ravn_flock"
        personas = req.workload_config["personas"]
        assert len(personas) == 2
        assert personas[0] == {"name": "coordinator"}
        reviewer = personas[1]
        assert reviewer["name"] == "reviewer"
        assert reviewer["llm"]["primary_alias"] == "powerful"

    def test_named_flow_matches_inline_dispatch(self) -> None:
        """Dispatching by flow name must produce identical personas to inline dispatch."""
        personas_inline = [
            {"name": "coordinator"},
            {"name": "reviewer", "llm": {"primary_alias": "powerful"}},
        ]
        config_inline = DispatchConfig(
            flock_enabled=True,
            flock_default_personas=personas_inline,
        )

        # Dispatch inline
        svc_inline = _svc(config=config_inline)
        item_inline = DispatchItem(saga_id=str(uuid4()), issue_id="i-1", repo="org/repo")
        req_inline = svc_inline._build_spawn_request(
            item=item_inline,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )

        # Dispatch via named flow with same personas
        provider = ConfigFlockFlowProvider(path="")
        flow = FlockFlowConfig(
            name="same-flow",
            personas=[
                FlockPersonaOverride(name="coordinator"),
                FlockPersonaOverride(
                    name="reviewer",
                    llm=PersonaLLMOverride(primary_alias="powerful"),
                ),
            ],
        )
        provider.save(flow)
        svc_flow = _svc(provider=provider)
        item_flow = DispatchItem(
            saga_id=str(uuid4()), issue_id="i-1", repo="org/repo", flock_flow="same-flow"
        )
        req_flow = svc_flow._build_spawn_request(
            item=item_flow,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )

        assert req_inline.workload_config["personas"] == req_flow.workload_config["personas"]


# ---------------------------------------------------------------------------
# 2. Snapshot race — mutation after dispatch must not affect in-flight config
# ---------------------------------------------------------------------------


class TestSnapshotRaceIsolation:
    def test_mutate_flow_after_dispatch_does_not_affect_spawn_request(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        flow = FlockFlowConfig(
            name="mutable-flow",
            personas=[FlockPersonaOverride(name="coordinator")],
        )
        provider.save(flow)

        svc = _svc(provider=provider)
        item = DispatchItem(
            saga_id=str(uuid4()),
            issue_id="i-1",
            repo="org/repo",
            flock_flow="mutable-flow",
        )
        req = svc._build_spawn_request(
            item=item,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )

        # Simulate mutation: replace the flow with a different persona list
        mutated = FlockFlowConfig(
            name="mutable-flow",
            personas=[
                FlockPersonaOverride(name="coordinator"),
                FlockPersonaOverride(name="intruder"),
            ],
        )
        provider.save(mutated)

        # The already-built request must be unaffected
        assert len(req.workload_config["personas"]) == 1
        assert req.workload_config["personas"][0]["name"] == "coordinator"


# ---------------------------------------------------------------------------
# 3. Fallback when flow name is unknown
# ---------------------------------------------------------------------------


class TestFlowFallback:
    def test_unknown_flow_name_falls_back_to_defaults(self) -> None:
        provider = ConfigFlockFlowProvider(path="")  # empty — no flows stored
        config = DispatchConfig(
            flock_enabled=True,
            flock_default_personas=[{"name": "coordinator"}, {"name": "reviewer"}],
        )
        svc = _svc(config=config, provider=provider)
        item = DispatchItem(
            saga_id=str(uuid4()),
            issue_id="i-1",
            repo="org/repo",
            flock_flow="does-not-exist",
        )
        req = svc._build_spawn_request(
            item=item,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )

        assert req.workload_config["personas"] == [
            {"name": "coordinator"},
            {"name": "reviewer"},
        ]

    def test_no_flow_name_uses_defaults(self) -> None:
        config = DispatchConfig(
            flock_enabled=True,
            flock_default_personas=[{"name": "coordinator"}],
        )
        svc = _svc(config=config)
        item = DispatchItem(saga_id=str(uuid4()), issue_id="i-1", repo="org/repo")
        req = svc._build_spawn_request(
            item=item,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )
        assert req.workload_config["personas"] == [{"name": "coordinator"}]

    def test_no_provider_uses_defaults(self) -> None:
        config = DispatchConfig(
            flock_enabled=True,
            flock_default_personas=[{"name": "solo"}],
        )
        svc = _svc(config=config, provider=None)
        item = DispatchItem(
            saga_id=str(uuid4()),
            issue_id="i-1",
            repo="org/repo",
            flock_flow="some-flow",
        )
        req = svc._build_spawn_request(
            item=item,
            saga=_make_saga(),
            issue=_make_issue(),
            effective_model="claude-sonnet-4-6",
            effective_prompt="",
            integration_ids=[],
        )
        assert req.workload_config["personas"] == [{"name": "solo"}]


# ---------------------------------------------------------------------------
# 4. Snapshot hash
# ---------------------------------------------------------------------------


class TestSnapshotHash:
    def test_returns_8_char_hex_string(self) -> None:
        h = _snapshot_hash([{"name": "coordinator"}])
        assert len(h) == 8
        assert all(c in "0123456789abcdef" for c in h)

    def test_same_input_same_hash(self) -> None:
        personas = [{"name": "coordinator"}, {"name": "reviewer"}]
        assert _snapshot_hash(personas) == _snapshot_hash(personas)

    def test_different_inputs_different_hashes(self) -> None:
        h1 = _snapshot_hash([{"name": "coordinator"}])
        h2 = _snapshot_hash([{"name": "reviewer"}])
        assert h1 != h2

    def test_empty_personas_produces_hash(self) -> None:
        h = _snapshot_hash([])
        assert len(h) == 8

    def test_order_matters(self) -> None:
        h1 = _snapshot_hash([{"name": "a"}, {"name": "b"}])
        h2 = _snapshot_hash([{"name": "b"}, {"name": "a"}])
        assert h1 != h2
