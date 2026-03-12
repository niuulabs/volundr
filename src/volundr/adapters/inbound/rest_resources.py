"""REST endpoint for cluster resource discovery."""

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from volundr.domain.ports import ResourceProvider

logger = logging.getLogger(__name__)


class ResourceTypeResponse(BaseModel):
    """A discoverable resource type."""

    name: str
    resource_key: str
    display_name: str
    unit: str
    category: str


class NodeResourceSummaryResponse(BaseModel):
    """Resource availability for a node."""

    name: str
    labels: dict[str, str] = Field(default_factory=dict)
    allocatable: dict[str, str] = Field(default_factory=dict)
    allocated: dict[str, str] = Field(default_factory=dict)
    available: dict[str, str] = Field(default_factory=dict)


class ClusterResourceInfoResponse(BaseModel):
    """Cluster resource discovery response."""

    resource_types: list[ResourceTypeResponse] = Field(default_factory=list)
    nodes: list[NodeResourceSummaryResponse] = Field(default_factory=list)


def create_resources_router(
    resource_provider: ResourceProvider,
) -> APIRouter:
    """Create the resources REST router."""

    router = APIRouter(prefix="/api/v1/volundr", tags=["Resources"])

    @router.get(
        "/resources",
        response_model=ClusterResourceInfoResponse,
    )
    async def get_cluster_resources(request: Request) -> ClusterResourceInfoResponse:
        """Discover available cluster resource types and capacity."""
        info = await resource_provider.discover()
        return ClusterResourceInfoResponse(
            resource_types=[
                ResourceTypeResponse(
                    name=rt.name,
                    resource_key=rt.resource_key,
                    display_name=rt.display_name,
                    unit=rt.unit,
                    category=rt.category.value,
                )
                for rt in info.resource_types
            ],
            nodes=[
                NodeResourceSummaryResponse(
                    name=n.name,
                    labels=n.labels,
                    allocatable=n.allocatable,
                    allocated=n.allocated,
                    available=n.available,
                )
                for n in info.nodes
            ],
        )

    return router
