"""Tests for resource validation edge cases."""

from volundr.adapters.outbound.k8s_resource_provider import K8sResourceProvider
from volundr.adapters.outbound.static_resource_provider import validate_resource_config
from volundr.domain.models import (
    ClusterResourceInfo,
    NodeResourceSummary,
)


class TestValidationEdgeCases:
    """Edge cases for resource validation."""

    def test_none_values_ignored(self):
        errors = validate_resource_config({"cpu": None, "memory": None, "gpu": None})
        assert errors == []

    def test_zero_cpu_invalid(self):
        errors = validate_resource_config({"cpu": "0"})
        assert len(errors) == 1
        assert "positive" in errors[0]

    def test_zero_gpu_valid(self):
        errors = validate_resource_config({"gpu": "0"})
        assert errors == []

    def test_memory_ki_suffix(self):
        errors = validate_resource_config({"memory": "4096Ki"})
        assert errors == []

    def test_memory_mi_suffix(self):
        errors = validate_resource_config({"memory": "512Mi"})
        assert errors == []

    def test_memory_ti_suffix(self):
        errors = validate_resource_config({"memory": "1Ti"})
        assert errors == []

    def test_fractional_cpu_valid(self):
        errors = validate_resource_config({"cpu": "0.5"})
        assert errors == []

    def test_multiple_errors(self):
        errors = validate_resource_config({"cpu": "abc", "gpu": "xyz"})
        assert len(errors) == 2


class TestK8sResourceProviderValidation:
    """Cluster-aware validation via K8sResourceProvider."""

    def _make_cluster_info(self, gpu_count: int = 0, gpu_product: str = "") -> ClusterResourceInfo:
        labels = {}
        allocatable = {}
        if gpu_count > 0:
            allocatable["nvidia.com/gpu"] = str(gpu_count)
            if gpu_product:
                labels["nvidia.com/gpu.product"] = gpu_product
        return ClusterResourceInfo(
            resource_types=[],
            nodes=[
                NodeResourceSummary(
                    name="node-1",
                    labels=labels,
                    allocatable=allocatable,
                    allocated={},
                    available=allocatable,
                )
            ],
        )

    def test_gpu_available(self):
        provider = K8sResourceProvider()
        cluster = self._make_cluster_info(gpu_count=4, gpu_product="A100")
        errors = provider.validate({"gpu": "2", "gpu_type": "A100"}, cluster)
        assert errors == []

    def test_gpu_not_enough(self):
        provider = K8sResourceProvider()
        cluster = self._make_cluster_info(gpu_count=2, gpu_product="A100")
        errors = provider.validate({"gpu": "4", "gpu_type": "A100"}, cluster)
        assert len(errors) == 1
        assert "4 available GPUs" in errors[0]

    def test_gpu_wrong_type(self):
        provider = K8sResourceProvider()
        cluster = self._make_cluster_info(gpu_count=4, gpu_product="A100")
        errors = provider.validate({"gpu": "1", "gpu_type": "H100"}, cluster)
        assert len(errors) == 1
        assert "H100" in errors[0]

    def test_no_gpu_nodes(self):
        provider = K8sResourceProvider()
        cluster = self._make_cluster_info(gpu_count=0)
        errors = provider.validate({"gpu": "1"}, cluster)
        assert len(errors) == 1
        assert "no GPU nodes" in errors[0]

    def test_no_cluster_info_skips_gpu_check(self):
        provider = K8sResourceProvider()
        errors = provider.validate({"gpu": "1"}, None)
        assert errors == []

    def test_no_gpu_request_skips_check(self):
        provider = K8sResourceProvider()
        cluster = self._make_cluster_info(gpu_count=0)
        errors = provider.validate({"cpu": "4"}, cluster)
        assert errors == []
