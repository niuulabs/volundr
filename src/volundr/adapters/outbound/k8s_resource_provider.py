"""Kubernetes resource provider — discovers cluster resources via K8s API."""

import logging

from volundr.domain.models import (
    ClusterResourceInfo,
    NodeResourceSummary,
    ResourceCategory,
    ResourceType,
    TranslatedResources,
)
from volundr.domain.ports import ResourceProvider

from .static_resource_provider import (
    STANDARD_RESOURCE_TYPES,
    translate_resource_config,
    validate_resource_config,
)

logger = logging.getLogger(__name__)


class K8sResourceProvider(ResourceProvider):
    """Resource provider that queries the Kubernetes API for node capacity.

    Uses the device-plugin model (v1.30). The interface is designed so a
    DRA-backed adapter can be swapped in for v1.31+ without changing callers.
    """

    def __init__(self, *, namespace: str = "volundr-sessions", **_extra: object) -> None:
        self._namespace = namespace

    async def discover(self) -> ClusterResourceInfo:
        """List nodes, extract GPU labels/allocatable, build ClusterResourceInfo."""
        try:
            from kubernetes_asyncio import client, config

            await config.load_incluster_config()
            v1 = client.CoreV1Api()
            nodes_resp = await v1.list_node()
        except Exception:
            logger.warning(
                "Failed to query K8s API for node resources, falling back to static types",
                exc_info=True,
            )
            return ClusterResourceInfo(
                resource_types=list(STANDARD_RESOURCE_TYPES),
                nodes=[],
            )

        resource_types = list(STANDARD_RESOURCE_TYPES)
        seen_gpu_products: set[str] = set()
        nodes: list[NodeResourceSummary] = []

        for node in nodes_resp.items:
            labels = node.metadata.labels or {}
            allocatable = {k: str(v) for k, v in (node.status.allocatable or {}).items()}

            # Discover GPU product types from node labels
            gpu_product = labels.get("nvidia.com/gpu.product")
            if gpu_product and gpu_product not in seen_gpu_products:
                seen_gpu_products.add(gpu_product)

            nodes.append(
                NodeResourceSummary(
                    name=node.metadata.name,
                    labels=labels,
                    allocatable=allocatable,
                    allocated={},  # Would require metrics-server to compute
                    available=allocatable,  # Approximate
                )
            )

        # Add discovered GPU types as resource types
        for product in sorted(seen_gpu_products):
            resource_types.append(
                ResourceType(
                    name=f"gpu_{product.lower().replace(' ', '_')}",
                    resource_key="nvidia.com/gpu",
                    display_name=f"GPU ({product})",
                    unit="devices",
                    category=ResourceCategory.ACCELERATOR,
                )
            )

        return ClusterResourceInfo(resource_types=resource_types, nodes=nodes)

    def translate(self, resource_config: dict) -> TranslatedResources:
        return translate_resource_config(resource_config)

    def validate(
        self,
        resource_config: dict,
        cluster_info: ClusterResourceInfo | None = None,
    ) -> list[str]:
        errors = validate_resource_config(resource_config)

        if not cluster_info or not resource_config.get("gpu"):
            return errors

        # Check GPU availability across nodes
        gpu_count = int(resource_config.get("gpu", 0))
        gpu_type = resource_config.get("gpu_type")

        any_gpu_node = False
        for node in cluster_info.nodes:
            node_gpus = int(node.allocatable.get("nvidia.com/gpu", "0"))
            if node_gpus == 0:
                continue
            any_gpu_node = True
            if gpu_type:
                node_product = node.labels.get("nvidia.com/gpu.product", "")
                if node_product != gpu_type:
                    continue
            if node_gpus >= gpu_count:
                return errors  # Found a suitable node

        if not any_gpu_node:
            errors.append("no GPU nodes available in the cluster")
        elif gpu_type:
            errors.append(f"no nodes with GPU type '{gpu_type}' have {gpu_count} available GPUs")
        else:
            errors.append(f"no single node has {gpu_count} available GPUs")

        return errors
