"""Tests for KubernetesConfigMapFlockFlowProvider — mocked k8s client.

Contract-test parity with ConfigFlockFlowProvider.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import yaml

from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider
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


def _make_configmap(flows: list[dict] | None = None) -> SimpleNamespace:
    """Build a mock ConfigMap response."""
    data = {}
    if flows is not None:
        data["flows.yaml"] = yaml.dump(flows, default_flow_style=False)
    return SimpleNamespace(data=data)


def _make_provider(
    flows: list[dict] | None = None,
) -> tuple[KubernetesConfigMapFlockFlowProvider, MagicMock]:
    """Build a provider with a mocked k8s client pre-loaded with flows."""
    client = MagicMock()
    cm = _make_configmap(flows)
    client.read_namespaced_config_map.return_value = cm
    provider = KubernetesConfigMapFlockFlowProvider(
        namespace="tyr",
        configmap_name="flock-flows",
        kube_client=client,
    )
    return provider, client


class TestKubernetesConfigMapFlockFlowProvider:
    """Contract tests — same interface as ConfigFlockFlowProvider."""

    def test_implements_port(self) -> None:
        provider, _ = _make_provider()
        assert isinstance(provider, FlockFlowProvider)

    def test_empty_configmap(self) -> None:
        provider, _ = _make_provider(flows=[])
        assert provider.list() == []
        assert provider.get("nonexistent") is None

    def test_save_and_get(self) -> None:
        provider, client = _make_provider(flows=[])
        flow = _make_flow()
        provider.save(flow)

        # Verify patch was called
        client.patch_namespaced_config_map.assert_called_once()
        call_kwargs = client.patch_namespaced_config_map.call_args
        assert call_kwargs.kwargs["name"] == "flock-flows"

    def test_get_from_existing(self) -> None:
        flow_data = [_make_flow("existing").to_dict()]
        provider, _ = _make_provider(flows=flow_data)

        result = provider.get("existing")
        assert result is not None
        assert result.name == "existing"
        assert len(result.personas) == 2

    def test_get_nonexistent(self) -> None:
        provider, _ = _make_provider(flows=[_make_flow().to_dict()])
        assert provider.get("nonexistent") is None

    def test_list(self) -> None:
        flow_data = [_make_flow("flow-a").to_dict(), _make_flow("flow-b").to_dict()]
        provider, _ = _make_provider(flows=flow_data)

        flows = provider.list()
        names = {f.name for f in flows}
        assert names == {"flow-a", "flow-b"}

    def test_save_overwrites_existing(self) -> None:
        flow_data = [_make_flow("test-flow").to_dict()]
        provider, client = _make_provider(flows=flow_data)

        updated = FlockFlowConfig(name="test-flow", description="Updated")
        provider.save(updated)

        call_body = client.patch_namespaced_config_map.call_args.kwargs["body"]
        saved_data = yaml.safe_load(call_body["data"]["flows.yaml"])
        assert len(saved_data) == 1
        assert saved_data[0]["description"] == "Updated"

    def test_save_appends_new(self) -> None:
        flow_data = [_make_flow("existing").to_dict()]
        provider, client = _make_provider(flows=flow_data)

        provider.save(_make_flow("new-flow"))

        call_body = client.patch_namespaced_config_map.call_args.kwargs["body"]
        saved_data = yaml.safe_load(call_body["data"]["flows.yaml"])
        assert len(saved_data) == 2

    def test_delete_existing(self) -> None:
        flow_data = [_make_flow("to-delete").to_dict()]
        provider, client = _make_provider(flows=flow_data)

        assert provider.delete("to-delete") is True
        client.patch_namespaced_config_map.assert_called_once()
        call_body = client.patch_namespaced_config_map.call_args.kwargs["body"]
        saved_data = yaml.safe_load(call_body["data"]["flows.yaml"])
        assert saved_data == []

    def test_delete_nonexistent(self) -> None:
        provider, client = _make_provider(flows=[])
        assert provider.delete("nonexistent") is False
        client.patch_namespaced_config_map.assert_not_called()

    def test_no_client_returns_empty(self) -> None:
        provider = KubernetesConfigMapFlockFlowProvider(kube_client=None)
        assert provider.list() == []
        assert provider.get("anything") is None

    def test_no_client_delete_returns_false(self) -> None:
        provider = KubernetesConfigMapFlockFlowProvider(kube_client=None)
        assert provider.delete("anything") is False

    def test_read_error_returns_empty(self) -> None:
        client = MagicMock()
        client.read_namespaced_config_map.side_effect = RuntimeError("k8s error")
        provider = KubernetesConfigMapFlockFlowProvider(kube_client=client)
        assert provider.list() == []

    def test_configmap_with_no_data_key(self) -> None:
        client = MagicMock()
        client.read_namespaced_config_map.return_value = SimpleNamespace(data={})
        provider = KubernetesConfigMapFlockFlowProvider(kube_client=client)
        assert provider.list() == []
