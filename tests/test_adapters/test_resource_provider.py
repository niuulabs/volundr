"""Tests for resource provider adapters."""

from unittest.mock import AsyncMock, patch

import pytest

import volundr.adapters.outbound.k8s_resource_provider as k8s_mod
from volundr.adapters.outbound.static_resource_provider import (
    StaticResourceProvider,
    translate_resource_config,
    validate_resource_config,
)
from volundr.domain.models import (
    ClusterResourceInfo,
    TranslatedResources,
)


class TestTranslateResourceConfig:
    """Tests for translate_resource_config shared logic."""

    def test_empty_config(self):
        result = translate_resource_config({})
        assert result == TranslatedResources()

    def test_cpu_only(self):
        result = translate_resource_config({"cpu": "4"})
        assert result.requests == {"cpu": "4"}
        assert result.limits == {"cpu": "4"}
        assert result.node_selector == {}
        assert result.tolerations == []
        assert result.runtime_class_name is None

    def test_memory_only(self):
        result = translate_resource_config({"memory": "8Gi"})
        assert result.requests == {"memory": "8Gi"}
        assert result.limits == {"memory": "8Gi"}

    def test_cpu_and_memory(self):
        result = translate_resource_config({"cpu": "2", "memory": "4Gi"})
        assert result.requests == {"cpu": "2", "memory": "4Gi"}
        assert result.limits == {"cpu": "2", "memory": "4Gi"}

    def test_gpu_adds_limits_tolerations_runtime(self):
        result = translate_resource_config({"gpu": "1"})
        assert result.limits == {"nvidia.com/gpu": "1"}
        assert result.requests == {}
        assert len(result.tolerations) == 1
        assert result.tolerations[0]["key"] == "nvidia.com/gpu"
        assert result.runtime_class_name == "nvidia"

    def test_gpu_zero_ignored(self):
        result = translate_resource_config({"gpu": "0"})
        assert "nvidia.com/gpu" not in result.limits
        assert result.tolerations == []
        assert result.runtime_class_name is None

    def test_gpu_type_sets_node_selector(self):
        result = translate_resource_config({"gpu": "2", "gpu_type": "A100"})
        assert result.limits == {"nvidia.com/gpu": "2"}
        assert result.node_selector == {"nvidia.com/gpu.product": "A100"}

    def test_full_config(self):
        result = translate_resource_config(
            {
                "cpu": "8",
                "memory": "32Gi",
                "gpu": "4",
                "gpu_type": "H100",
            }
        )
        assert result.requests == {"cpu": "8", "memory": "32Gi"}
        assert result.limits == {"cpu": "8", "memory": "32Gi", "nvidia.com/gpu": "4"}
        assert result.node_selector == {"nvidia.com/gpu.product": "H100"}
        assert len(result.tolerations) == 1
        assert result.runtime_class_name == "nvidia"


class TestValidateResourceConfig:
    """Tests for validate_resource_config."""

    def test_valid_config(self):
        errors = validate_resource_config({"cpu": "4", "memory": "8Gi", "gpu": "1"})
        assert errors == []

    def test_empty_config(self):
        errors = validate_resource_config({})
        assert errors == []

    def test_invalid_cpu(self):
        errors = validate_resource_config({"cpu": "abc"})
        assert len(errors) == 1
        assert "invalid cpu" in errors[0]

    def test_negative_cpu(self):
        errors = validate_resource_config({"cpu": "-1"})
        assert len(errors) == 1
        assert "positive" in errors[0]

    def test_invalid_memory_suffix(self):
        errors = validate_resource_config({"memory": "8GB"})
        assert len(errors) == 1
        assert "memory" in errors[0]

    def test_valid_memory_numeric(self):
        errors = validate_resource_config({"memory": "1073741824"})
        assert errors == []

    def test_invalid_gpu(self):
        errors = validate_resource_config({"gpu": "1.5"})
        assert len(errors) == 1
        assert "integer" in errors[0]

    def test_negative_gpu(self):
        errors = validate_resource_config({"gpu": "-1"})
        assert len(errors) == 1
        assert "non-negative" in errors[0]


class TestStaticResourceProvider:
    """Tests for StaticResourceProvider."""

    @pytest.mark.asyncio
    async def test_discover_returns_standard_types(self):
        provider = StaticResourceProvider()
        info = await provider.discover()
        assert isinstance(info, ClusterResourceInfo)
        assert len(info.resource_types) == 2
        names = {rt.name for rt in info.resource_types}
        assert names == {"cpu", "memory"}
        assert info.nodes == []

    def test_translate_delegates(self):
        provider = StaticResourceProvider()
        result = provider.translate({"cpu": "4", "gpu": "1"})
        assert result.limits["nvidia.com/gpu"] == "1"
        assert result.requests["cpu"] == "4"

    def test_validate_delegates(self):
        provider = StaticResourceProvider()
        errors = provider.validate({"cpu": "abc"})
        assert len(errors) == 1


class TestK8sResourceProviderKubeconfig:
    """Tests for K8sResourceProvider kubeconfig fallback logic."""

    @pytest.mark.asyncio
    async def test_kubeconfig_kwarg_triggers_load_kube_config(self):
        """When kubeconfig is provided, load_kube_config(config_file=...) is called."""
        provider = k8s_mod.K8sResourceProvider(kubeconfig="/path/to/kubeconfig")

        # Directly test via mocking kubernetes_asyncio imports
        mock_config = AsyncMock()
        mock_client = AsyncMock()
        mock_v1 = AsyncMock()
        mock_client.CoreV1Api.return_value = mock_v1
        mock_v1.list_node.return_value = AsyncMock(items=[])

        with patch.dict(
            "sys.modules",
            {
                "kubernetes_asyncio": AsyncMock(client=mock_client, config=mock_config),
                "kubernetes_asyncio.client": mock_client,
                "kubernetes_asyncio.config": mock_config,
            },
        ):
            # Re-import to pick up mocked modules
            import importlib

            importlib.reload(k8s_mod)
            provider = k8s_mod.K8sResourceProvider(kubeconfig="/path/to/kubeconfig")
            info = await provider.discover()

            mock_config.load_kube_config.assert_called_once_with(config_file="/path/to/kubeconfig")
            mock_config.load_incluster_config.assert_not_called()
            assert isinstance(info, ClusterResourceInfo)

    @pytest.mark.asyncio
    async def test_empty_kubeconfig_tries_incluster_first(self):
        """When no kubeconfig is set, try load_incluster_config first."""
        mock_config = AsyncMock()
        mock_client = AsyncMock()
        mock_v1 = AsyncMock()
        mock_client.CoreV1Api.return_value = mock_v1
        mock_v1.list_node.return_value = AsyncMock(items=[])

        with patch.dict(
            "sys.modules",
            {
                "kubernetes_asyncio": AsyncMock(client=mock_client, config=mock_config),
                "kubernetes_asyncio.client": mock_client,
                "kubernetes_asyncio.config": mock_config,
            },
        ):
            import importlib

            importlib.reload(k8s_mod)
            provider = k8s_mod.K8sResourceProvider()
            info = await provider.discover()

            mock_config.load_incluster_config.assert_called_once()
            mock_config.load_kube_config.assert_not_called()
            assert isinstance(info, ClusterResourceInfo)

    @pytest.mark.asyncio
    async def test_incluster_failure_falls_back_to_kube_config(self):
        """When load_incluster_config fails, fall back to load_kube_config."""
        mock_config = AsyncMock()
        mock_config.ConfigException = type("ConfigException", (Exception,), {})
        mock_config.load_incluster_config.side_effect = mock_config.ConfigException(
            "not in cluster"
        )
        mock_client = AsyncMock()
        mock_v1 = AsyncMock()
        mock_client.CoreV1Api.return_value = mock_v1
        mock_v1.list_node.return_value = AsyncMock(items=[])

        with patch.dict(
            "sys.modules",
            {
                "kubernetes_asyncio": AsyncMock(client=mock_client, config=mock_config),
                "kubernetes_asyncio.client": mock_client,
                "kubernetes_asyncio.config": mock_config,
            },
        ):
            import importlib

            importlib.reload(k8s_mod)
            provider = k8s_mod.K8sResourceProvider()
            info = await provider.discover()

            mock_config.load_incluster_config.assert_called_once()
            mock_config.load_kube_config.assert_called_once_with()
            assert isinstance(info, ClusterResourceInfo)

    @pytest.mark.asyncio
    async def test_all_failures_fall_back_to_static_types(self):
        """When all config loading fails, return static resource types."""
        provider = k8s_mod.K8sResourceProvider(kubeconfig="/nonexistent/path")

        # The discover method catches all exceptions and falls back
        info = await provider.discover()

        assert isinstance(info, ClusterResourceInfo)
        assert len(info.resource_types) == 2
        names = {rt.name for rt in info.resource_types}
        assert names == {"cpu", "memory"}
        assert info.nodes == []
