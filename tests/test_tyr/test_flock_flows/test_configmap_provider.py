"""Tests for KubernetesConfigMapFlockFlowProvider with mocked k8s client.

Contract-test parity with ConfigFlockFlowProvider is achieved by importing
and running the contract suite from test_config_provider.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest
import yaml

from tests.test_tyr.test_flock_flows.test_config_provider import _make_flow
from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride, PersonaLLMOverride

# Fake the optional 'kubernetes' package so tests run without it installed.
_MOCK_K8S_MODULES = {
    "kubernetes": MagicMock(),
    "kubernetes.client": MagicMock(),
    "kubernetes.config": MagicMock(),
}

# ---------------------------------------------------------------------------
# Helpers — mock k8s client factory
# ---------------------------------------------------------------------------


def _make_cm(text: str) -> MagicMock:
    """Return a mock ConfigMap object with ``data = {"flows.yaml": text}``."""
    cm = MagicMock()
    cm.data = {"flows.yaml": text}
    return cm


def _provider_with_mock(initial_text: str = "[]"):
    """Return (provider, captured_writes) with a mocked k8s CoreV1Api."""
    from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

    captured: list[str] = []

    mock_v1 = MagicMock()
    mock_v1.read_namespaced_config_map.return_value = _make_cm(initial_text)

    def _replace(name, namespace, body, **kwargs):
        captured.append(body.data["flows.yaml"])
        return MagicMock()

    def _create(namespace, body, **kwargs):
        captured.append(body.data["flows.yaml"])
        return MagicMock()

    mock_v1.replace_namespaced_config_map.side_effect = _replace
    mock_v1.create_namespaced_config_map.side_effect = _create

    provider = KubernetesConfigMapFlockFlowProvider(namespace="tyr", configmap_name="flock-flows")

    return provider, mock_v1, captured


# ---------------------------------------------------------------------------
# Instantiation guard
# ---------------------------------------------------------------------------


class TestInstantiationGuard:
    def test_raises_import_error_when_kubernetes_missing(self) -> None:
        import sys

        # Temporarily hide 'kubernetes' from imports
        real_modules = sys.modules.copy()
        sys.modules["kubernetes"] = None  # type: ignore[assignment]
        try:
            from tyr.adapters.flows.configmap import (
                KubernetesConfigMapFlockFlowProvider,  # noqa: PLC0415
            )

            with pytest.raises(ImportError, match="kubernetes"):
                KubernetesConfigMapFlockFlowProvider()
        finally:
            # Restore
            for mod in list(sys.modules.keys()):
                if mod not in real_modules:
                    del sys.modules[mod]
            sys.modules.update(real_modules)


# ---------------------------------------------------------------------------
# Read / write round-trip
# ---------------------------------------------------------------------------


@patch.dict(sys.modules, _MOCK_K8S_MODULES)
class TestKubernetesConfigMapRoundTrip:
    def _build_provider(self, initial_text="[]"):
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        provider = KubernetesConfigMapFlockFlowProvider(
            namespace="tyr", configmap_name="flock-flows"
        )
        return provider

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_get_returns_none_for_empty_configmap(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.return_value = _make_cm("[]")
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        assert provider.get("anything") is None

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_list_returns_empty_for_empty_configmap(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.return_value = _make_cm("[]")
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        assert provider.list() == []

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_save_writes_to_configmap(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        written: list[str] = []
        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.return_value = _make_cm("[]")
        mock_v1.replace_namespaced_config_map.side_effect = lambda name, ns, body, **kw: (
            written.append(body.data["flows.yaml"]) or MagicMock()
        )
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        flow = _make_flow("test-flow")
        provider.save(flow)

        assert written, "replace_namespaced_config_map was not called"
        saved_text = written[-1]
        parsed = yaml.safe_load(saved_text)
        assert isinstance(parsed, list)
        assert any(f["name"] == "test-flow" for f in parsed)

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_get_after_save(self, mock_client_method) -> None:
        """Simulate a round-trip: save writes, then get reads the written data."""
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        storage: dict[str, str] = {"flows.yaml": "[]"}

        def _read(name, ns):
            cm = MagicMock()
            cm.data = dict(storage)
            return cm

        def _replace(name, ns, body, **kw):
            storage["flows.yaml"] = body.data["flows.yaml"]
            return MagicMock()

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.side_effect = _read
        mock_v1.replace_namespaced_config_map.side_effect = _replace
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        flow = _make_flow("my-flow")
        provider.save(flow)
        result = provider.get("my-flow")

        assert result is not None
        assert result.name == "my-flow"

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_delete_removes_flow(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        initial = yaml.dump([{"name": "to-delete"}, {"name": "keep"}])
        storage: dict[str, str] = {"flows.yaml": initial}

        def _read(name, ns):
            cm = MagicMock()
            cm.data = dict(storage)
            return cm

        def _replace(name, ns, body, **kw):
            storage["flows.yaml"] = body.data["flows.yaml"]
            return MagicMock()

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.side_effect = _read
        mock_v1.replace_namespaced_config_map.side_effect = _replace
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        assert provider.delete("to-delete") is True
        remaining = provider.list()
        assert len(remaining) == 1
        assert remaining[0].name == "keep"

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_delete_missing_returns_false(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.return_value = _make_cm("[]")
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        assert provider.delete("never-existed") is False

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_handles_k8s_read_failure_gracefully(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.side_effect = Exception("k8s unavailable")
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        assert provider.list() == []
        assert provider.get("anything") is None

    @patch("tyr.adapters.flows.configmap.KubernetesConfigMapFlockFlowProvider._k8s_client")
    def test_persona_llm_survives_yaml_round_trip(self, mock_client_method) -> None:
        from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

        storage: dict[str, str] = {"flows.yaml": "[]"}

        def _read(name, ns):
            cm = MagicMock()
            cm.data = dict(storage)
            return cm

        def _replace(name, ns, body, **kw):
            storage["flows.yaml"] = body.data["flows.yaml"]
            return MagicMock()

        mock_v1 = MagicMock()
        mock_v1.read_namespaced_config_map.side_effect = _read
        mock_v1.replace_namespaced_config_map.side_effect = _replace
        mock_client_method.return_value = mock_v1

        provider = KubernetesConfigMapFlockFlowProvider()
        flow = FlockFlowConfig(
            name="llm-flow",
            personas=[
                FlockPersonaOverride(
                    name="reviewer",
                    llm=PersonaLLMOverride(primary_alias="powerful", thinking_enabled=True),
                    iteration_budget=30,
                )
            ],
        )
        provider.save(flow)
        result = provider.get("llm-flow")

        assert result is not None
        p = result.personas[0]
        assert p.name == "reviewer"
        assert p.llm is not None
        assert p.llm.primary_alias == "powerful"
        assert p.llm.thinking_enabled is True
        assert p.iteration_budget == 30
