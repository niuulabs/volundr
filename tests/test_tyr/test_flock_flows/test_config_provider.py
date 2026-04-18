"""Tests for ConfigFlockFlowProvider — YAML round-trip + runtime additions.

Contract tests against the FlockFlowProvider port are defined in this module
and run for both providers (config + k8s configmap).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tyr.adapters.flows.config import ConfigFlockFlowProvider, parse_flow
from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride, PersonaLLMOverride

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_flow(
    name: str = "code-review-flow",
    personas: list[FlockPersonaOverride] | None = None,
) -> FlockFlowConfig:
    return FlockFlowConfig(
        name=name,
        description="A test flock flow",
        personas=personas
        or [
            FlockPersonaOverride(name="coordinator"),
            FlockPersonaOverride(
                name="reviewer",
                llm=PersonaLLMOverride(primary_alias="powerful", thinking_enabled=True),
                iteration_budget=20,
            ),
        ],
        mimir_hosted_url="https://mimir.example.com",
        sleipnir_publish_urls=["nats://bus.example.com"],
        max_concurrent_tasks=5,
    )


def _write_flows_yaml(tmp_path: Path, flows: list[dict]) -> Path:
    p = tmp_path / "flock_flows.yaml"
    p.write_text(yaml.dump(flows, allow_unicode=True), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# parse_flow unit tests
# ---------------------------------------------------------------------------


class TestParseFlow:
    def test_returns_none_for_non_dict(self) -> None:
        assert parse_flow("not a dict") is None

    def test_returns_none_for_missing_name(self) -> None:
        assert parse_flow({"description": "oops"}) is None

    def test_parses_minimal_flow(self) -> None:
        flow = parse_flow({"name": "minimal"})
        assert flow is not None
        assert flow.name == "minimal"
        assert flow.personas == []
        assert flow.mesh_transport == "nng"
        assert flow.max_concurrent_tasks == 3

    def test_parses_bare_string_persona(self) -> None:
        flow = parse_flow({"name": "x", "personas": ["coordinator"]})
        assert flow is not None
        assert len(flow.personas) == 1
        assert flow.personas[0].name == "coordinator"
        assert flow.personas[0].llm is None

    def test_parses_persona_with_llm(self) -> None:
        raw = {
            "name": "x",
            "personas": [
                {
                    "name": "reviewer",
                    "llm": {"primary_alias": "powerful", "thinking_enabled": True},
                    "iteration_budget": 10,
                }
            ],
        }
        flow = parse_flow(raw)
        assert flow is not None
        p = flow.personas[0]
        assert p.name == "reviewer"
        assert p.llm is not None
        assert p.llm.primary_alias == "powerful"
        assert p.llm.thinking_enabled is True
        assert p.iteration_budget == 10

    def test_parses_all_top_level_fields(self) -> None:
        raw = {
            "name": "full-flow",
            "description": "desc",
            "mesh_transport": "tcp",
            "mimir_hosted_url": "https://mimir.test",
            "sleipnir_publish_urls": ["nats://bus"],
            "max_concurrent_tasks": 7,
            "personas": [],
        }
        flow = parse_flow(raw)
        assert flow is not None
        assert flow.description == "desc"
        assert flow.mesh_transport == "tcp"
        assert flow.mimir_hosted_url == "https://mimir.test"
        assert flow.sleipnir_publish_urls == ["nats://bus"]
        assert flow.max_concurrent_tasks == 7

    def test_skips_invalid_persona_entry(self) -> None:
        raw = {"name": "x", "personas": [{"name": ""}, {"name": "coordinator"}]}
        flow = parse_flow(raw)
        assert flow is not None
        assert len(flow.personas) == 1
        assert flow.personas[0].name == "coordinator"


# ---------------------------------------------------------------------------
# ConfigFlockFlowProvider tests
# ---------------------------------------------------------------------------


class TestConfigFlockFlowProviderNoPath:
    def test_list_returns_empty_when_no_path(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        assert provider.list() == []

    def test_get_returns_none_when_no_path(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        assert provider.get("anything") is None

    def test_save_then_get_works_without_file(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        flow = _make_flow()
        provider.save(flow)
        assert provider.get(flow.name) is flow


class TestConfigFlockFlowProviderYamlLoad:
    def test_loads_flows_from_yaml(self, tmp_path: Path) -> None:
        raw = [{"name": "flow-a"}, {"name": "flow-b"}]
        p = _write_flows_yaml(tmp_path, raw)
        provider = ConfigFlockFlowProvider(path=str(p))
        names = {f.name for f in provider.list()}
        assert names == {"flow-a", "flow-b"}

    def test_loads_full_flow_from_yaml(self, tmp_path: Path) -> None:
        raw = [
            {
                "name": "review-flow",
                "description": "testing",
                "personas": [
                    {"name": "coordinator"},
                    {
                        "name": "reviewer",
                        "llm": {"primary_alias": "powerful"},
                        "iteration_budget": 15,
                    },
                ],
                "mimir_hosted_url": "https://mimir.test",
                "max_concurrent_tasks": 4,
            }
        ]
        p = _write_flows_yaml(tmp_path, raw)
        provider = ConfigFlockFlowProvider(path=str(p))
        flow = provider.get("review-flow")
        assert flow is not None
        assert flow.description == "testing"
        assert len(flow.personas) == 2
        reviewer = flow.personas[1]
        assert reviewer.llm is not None
        assert reviewer.llm.primary_alias == "powerful"
        assert reviewer.iteration_budget == 15
        assert flow.mimir_hosted_url == "https://mimir.test"
        assert flow.max_concurrent_tasks == 4

    def test_handles_nonexistent_path_gracefully(self) -> None:
        provider = ConfigFlockFlowProvider(path="/nonexistent/path/flows.yaml")
        assert provider.list() == []

    def test_handles_invalid_yaml_gracefully(self, tmp_path: Path) -> None:
        p = tmp_path / "bad.yaml"
        p.write_text("this is not valid yaml: [unterminated", encoding="utf-8")
        provider = ConfigFlockFlowProvider(path=str(p))
        assert provider.list() == []

    def test_handles_non_list_yaml_gracefully(self, tmp_path: Path) -> None:
        p = tmp_path / "dict.yaml"
        p.write_text("name: oops\n", encoding="utf-8")
        provider = ConfigFlockFlowProvider(path=str(p))
        assert provider.list() == []


# ---------------------------------------------------------------------------
# Shared contract tests — exercised against ConfigFlockFlowProvider
# ---------------------------------------------------------------------------


class TestFlockFlowProviderContract:
    """FlockFlowProvider port contract.

    These tests define the minimum correct behaviour any implementation must
    satisfy.  The k8s configmap tests import and run this suite as well.
    """

    @pytest.fixture()
    def provider(self) -> ConfigFlockFlowProvider:
        return ConfigFlockFlowProvider(path="")

    def test_get_missing_returns_none(self, provider: ConfigFlockFlowProvider) -> None:
        assert provider.get("nonexistent") is None

    def test_list_starts_empty(self, provider: ConfigFlockFlowProvider) -> None:
        assert provider.list() == []

    def test_save_and_get_round_trip(self, provider: ConfigFlockFlowProvider) -> None:
        flow = _make_flow()
        provider.save(flow)
        retrieved = provider.get(flow.name)
        assert retrieved is not None
        assert retrieved.name == flow.name
        assert retrieved.description == flow.description

    def test_save_overwrites_existing(self, provider: ConfigFlockFlowProvider) -> None:
        flow = _make_flow()
        provider.save(flow)
        updated = FlockFlowConfig(name=flow.name, description="updated")
        provider.save(updated)
        assert provider.get(flow.name).description == "updated"

    def test_list_returns_all_saved(self, provider: ConfigFlockFlowProvider) -> None:
        provider.save(_make_flow("flow-a"))
        provider.save(_make_flow("flow-b"))
        names = {f.name for f in provider.list()}
        assert names == {"flow-a", "flow-b"}

    def test_delete_existing_returns_true(self, provider: ConfigFlockFlowProvider) -> None:
        flow = _make_flow()
        provider.save(flow)
        assert provider.delete(flow.name) is True
        assert provider.get(flow.name) is None

    def test_delete_missing_returns_false(self, provider: ConfigFlockFlowProvider) -> None:
        assert provider.delete("never-existed") is False

    def test_delete_reduces_list(self, provider: ConfigFlockFlowProvider) -> None:
        provider.save(_make_flow("a"))
        provider.save(_make_flow("b"))
        provider.delete("a")
        names = {f.name for f in provider.list()}
        assert names == {"b"}


# ---------------------------------------------------------------------------
# Snapshot isolation test
# ---------------------------------------------------------------------------


class TestFlockFlowSnapshot:
    def test_snapshot_is_independent_of_original(self) -> None:
        flow = _make_flow()
        snapshot = flow.snapshot_personas()
        # Mutate the original flow's persona list
        flow.personas.append(FlockPersonaOverride(name="new-persona"))
        # Snapshot must be unaffected
        assert len(snapshot) == 2
        assert all(p["name"] != "new-persona" for p in snapshot)

    def test_snapshot_persona_dict_format(self) -> None:
        flow = _make_flow()
        snapshot = flow.snapshot_personas()
        coordinator = next(p for p in snapshot if p["name"] == "coordinator")
        reviewer = next(p for p in snapshot if p["name"] == "reviewer")
        assert coordinator == {"name": "coordinator"}
        assert reviewer["name"] == "reviewer"
        assert reviewer["llm"]["primary_alias"] == "powerful"
        assert reviewer["llm"]["thinking_enabled"] is True
        assert reviewer["iteration_budget"] == 20
