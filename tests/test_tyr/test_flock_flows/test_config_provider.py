"""Tests for ConfigFlockFlowProvider — YAML round-trip + runtime additions."""

from __future__ import annotations

import textwrap
from pathlib import Path

from tyr.adapters.flows.config import ConfigFlockFlowProvider
from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride
from tyr.ports.flock_flow import FlockFlowProvider


def _make_flow(name: str = "test-flow") -> FlockFlowConfig:
    return FlockFlowConfig(
        name=name,
        description="A test flow",
        personas=[
            FlockPersonaOverride(name="coordinator"),
            FlockPersonaOverride(name="reviewer", llm={"model": "claude-opus-4-6"}),
        ],
        mesh_transport="nng",
        mimir_hosted_url="http://mimir:8080",
        sleipnir_publish_urls=["http://sleipnir:4222"],
        max_concurrent_tasks=5,
    )


class TestConfigFlockFlowProvider:
    """Contract tests for ConfigFlockFlowProvider."""

    def test_implements_port(self) -> None:
        provider = ConfigFlockFlowProvider()
        assert isinstance(provider, FlockFlowProvider)

    def test_empty_by_default(self) -> None:
        provider = ConfigFlockFlowProvider()
        assert provider.list() == []
        assert provider.get("nonexistent") is None

    def test_save_and_get(self) -> None:
        provider = ConfigFlockFlowProvider()
        flow = _make_flow()
        provider.save(flow)

        result = provider.get("test-flow")
        assert result is not None
        assert result.name == "test-flow"
        assert result.description == "A test flow"
        assert len(result.personas) == 2
        assert result.personas[0].name == "coordinator"
        assert result.personas[1].llm == {"model": "claude-opus-4-6"}
        assert result.max_concurrent_tasks == 5

    def test_save_overwrites(self) -> None:
        provider = ConfigFlockFlowProvider()
        provider.save(_make_flow())

        updated = FlockFlowConfig(name="test-flow", description="Updated")
        provider.save(updated)

        result = provider.get("test-flow")
        assert result is not None
        assert result.description == "Updated"

    def test_list(self) -> None:
        provider = ConfigFlockFlowProvider()
        provider.save(_make_flow("flow-a"))
        provider.save(_make_flow("flow-b"))

        flows = provider.list()
        names = {f.name for f in flows}
        assert names == {"flow-a", "flow-b"}

    def test_delete_existing(self) -> None:
        provider = ConfigFlockFlowProvider()
        provider.save(_make_flow())

        assert provider.delete("test-flow") is True
        assert provider.get("test-flow") is None

    def test_delete_nonexistent(self) -> None:
        provider = ConfigFlockFlowProvider()
        assert provider.delete("nonexistent") is False


class TestConfigFlockFlowProviderYAML:
    """YAML file loading tests."""

    def test_loads_from_yaml(self, tmp_path: Path) -> None:
        yaml_content = textwrap.dedent("""\
            - name: code-review-flow
              description: Standard code review
              personas:
                - name: coordinator
                - name: reviewer
                  llm:
                    model: claude-opus-4-6
              mesh_transport: nng
              mimir_hosted_url: http://mimir:8080
              max_concurrent_tasks: 3
            - name: security-audit
              description: Security-focused review
              personas:
                - name: security-auditor
                  system_prompt_extra: Focus on OWASP top 10
                  iteration_budget: 10
        """)
        yaml_file = tmp_path / "flows.yaml"
        yaml_file.write_text(yaml_content)

        provider = ConfigFlockFlowProvider(path=str(yaml_file))

        assert len(provider.list()) == 2

        flow = provider.get("code-review-flow")
        assert flow is not None
        assert flow.description == "Standard code review"
        assert len(flow.personas) == 2
        assert flow.personas[1].llm == {"model": "claude-opus-4-6"}

        audit = provider.get("security-audit")
        assert audit is not None
        assert audit.personas[0].system_prompt_extra == "Focus on OWASP top 10"
        assert audit.personas[0].iteration_budget == 10

    def test_runtime_additions_after_yaml_load(self, tmp_path: Path) -> None:
        yaml_content = textwrap.dedent("""\
            - name: initial-flow
              personas:
                - name: coordinator
        """)
        yaml_file = tmp_path / "flows.yaml"
        yaml_file.write_text(yaml_content)

        provider = ConfigFlockFlowProvider(path=str(yaml_file))
        provider.save(_make_flow("runtime-flow"))

        assert len(provider.list()) == 2
        assert provider.get("initial-flow") is not None
        assert provider.get("runtime-flow") is not None

    def test_missing_file_is_warning(self) -> None:
        provider = ConfigFlockFlowProvider(path="/nonexistent/path.yaml")
        assert provider.list() == []

    def test_empty_path_no_load(self) -> None:
        provider = ConfigFlockFlowProvider(path="")
        assert provider.list() == []

    def test_invalid_yaml_format(self, tmp_path: Path) -> None:
        yaml_file = tmp_path / "bad.yaml"
        yaml_file.write_text("not_a_list: true")
        provider = ConfigFlockFlowProvider(path=str(yaml_file))
        assert provider.list() == []

    def test_yaml_round_trip(self, tmp_path: Path) -> None:
        """Test that to_dict → from_dict round-trips correctly."""
        original = _make_flow("roundtrip")
        d = original.to_dict()
        restored = FlockFlowConfig.from_dict(d)

        assert restored.name == original.name
        assert restored.description == original.description
        assert len(restored.personas) == len(original.personas)
        assert restored.personas[1].llm == original.personas[1].llm
        assert restored.mimir_hosted_url == original.mimir_hosted_url
        assert restored.sleipnir_publish_urls == original.sleipnir_publish_urls
        assert restored.max_concurrent_tasks == original.max_concurrent_tasks
