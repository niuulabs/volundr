"""Static resource provider for dev/test environments."""

from volundr.domain.models import (
    ClusterResourceInfo,
    ResourceCategory,
    ResourceType,
    TranslatedResources,
)
from volundr.domain.ports import ResourceProvider

# Standard resource types always available (CPU + Memory only;
# GPU and other resources are discovered dynamically from node data)
STANDARD_RESOURCE_TYPES = [
    ResourceType(
        name="cpu",
        resource_key="cpu",
        display_name="CPU",
        unit="cores",
        category=ResourceCategory.COMPUTE,
    ),
    ResourceType(
        name="memory",
        resource_key="memory",
        display_name="Memory",
        unit="bytes",
        category=ResourceCategory.COMPUTE,
    ),
]

# Default GPU toleration for NVIDIA device plugin nodes
_GPU_TOLERATION = {
    "key": "nvidia.com/gpu",
    "operator": "Exists",
    "effect": "NoSchedule",
}

# Default runtime class for GPU workloads
_GPU_RUNTIME_CLASS = "nvidia"


class StaticResourceProvider(ResourceProvider):
    """Resource provider returning hardcoded types without cluster access.

    Translation still works correctly — only cluster-aware validation
    and discovery are stubbed.
    """

    def __init__(self, **_extra: object) -> None:
        pass

    async def discover(self) -> ClusterResourceInfo:
        return ClusterResourceInfo(
            resource_types=list(STANDARD_RESOURCE_TYPES),
            nodes=[],
        )

    def translate(self, resource_config: dict) -> TranslatedResources:
        return translate_resource_config(resource_config)

    def validate(
        self,
        resource_config: dict,
        cluster_info: ClusterResourceInfo | None = None,
    ) -> list[str]:
        return validate_resource_config(resource_config)


def translate_resource_config(resource_config: dict) -> TranslatedResources:
    """Translate user-friendly resource config to K8s-native primitives.

    Shared logic used by both Static and K8s providers.
    """
    if not resource_config:
        return TranslatedResources()

    requests: dict[str, str] = {}
    limits: dict[str, str] = {}
    node_selector: dict[str, str] = {}
    tolerations: list[dict] = []
    runtime_class_name: str | None = None

    # CPU
    cpu = resource_config.get("cpu")
    if cpu:
        requests["cpu"] = str(cpu)
        limits["cpu"] = str(cpu)

    # Memory
    memory = resource_config.get("memory")
    if memory:
        requests["memory"] = str(memory)
        limits["memory"] = str(memory)

    # GPU
    gpu = resource_config.get("gpu")
    if gpu and str(gpu) != "0":
        limits["nvidia.com/gpu"] = str(gpu)
        tolerations.append(_GPU_TOLERATION)
        runtime_class_name = _GPU_RUNTIME_CLASS

    # GPU type → node selector
    gpu_type = resource_config.get("gpu_type")
    if gpu_type:
        node_selector["nvidia.com/gpu.product"] = str(gpu_type)

    return TranslatedResources(
        requests=requests,
        limits=limits,
        node_selector=node_selector,
        tolerations=tolerations,
        runtime_class_name=runtime_class_name,
    )


def validate_resource_config(resource_config: dict) -> list[str]:
    """Basic validation of resource config values."""
    errors: list[str] = []

    cpu = resource_config.get("cpu")
    if cpu is not None:
        try:
            val = float(cpu)
            if val <= 0:
                errors.append("cpu must be positive")
        except (ValueError, TypeError):
            errors.append(f"invalid cpu value: {cpu}")

    memory = resource_config.get("memory")
    if memory is not None:
        mem_str = str(memory)
        if mem_str and not any(mem_str.endswith(s) for s in ("Ki", "Mi", "Gi", "Ti")):
            # Allow plain numbers (bytes) or K8s suffixes
            try:
                float(mem_str)
            except (ValueError, TypeError):
                errors.append(f"invalid memory value: {memory} (use Ki, Mi, Gi, or Ti suffix)")

    gpu = resource_config.get("gpu")
    if gpu is not None:
        try:
            val = int(gpu)
            if val < 0:
                errors.append("gpu must be non-negative")
        except (ValueError, TypeError):
            errors.append(f"invalid gpu value: {gpu} (must be integer)")

    return errors
