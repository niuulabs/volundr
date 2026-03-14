"""Tests for ResourceContributor."""

import pytest

from volundr.adapters.outbound.contributors.resource import ResourceContributor
from volundr.adapters.outbound.static_resource_provider import StaticResourceProvider
from volundr.domain.models import GitSource, Session
from volundr.domain.ports import SessionContext


def _make_session(**overrides) -> Session:
    defaults = {
        "name": "test-session",
        "model": "claude-sonnet",
        "source": GitSource(repo="github.com/org/repo", branch="main"),
    }
    defaults.update(overrides)
    return Session(**defaults)


class TestResourceContributor:
    """Tests for the resource contributor."""

    @pytest.mark.asyncio
    async def test_no_provider_returns_empty(self):
        contributor = ResourceContributor(resource_provider=None)
        context = SessionContext(resource_config={"cpu": "4"})
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {}

    @pytest.mark.asyncio
    async def test_empty_resource_config(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(resource_config={})
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {}

    @pytest.mark.asyncio
    async def test_cpu_memory_translation(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(resource_config={"cpu": "4", "memory": "8Gi"})
        result = await contributor.contribute(_make_session(), context)
        # CPU/memory goes to both skuld (top-level) and devrunner
        assert result.values["resources"]["requests"] == {"cpu": "4", "memory": "8Gi"}
        assert result.values["resources"]["limits"] == {"cpu": "4", "memory": "8Gi"}
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["requests"] == {"cpu": "4", "memory": "8Gi"}
        assert devrunner_res["limits"] == {"cpu": "4", "memory": "8Gi"}
        assert "nodeSelector" not in result.values
        assert "tolerations" not in result.values
        assert "runtimeClassName" not in result.values

    @pytest.mark.asyncio
    async def test_gpu_translation(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(resource_config={"gpu": "2", "gpu_type": "A100"})
        result = await contributor.contribute(_make_session(), context)
        # GPU goes to devrunner only, not top-level resources
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["limits"]["nvidia.com/gpu"] == "2"
        assert "resources" not in result.values  # No CPU/memory → no top-level resources
        assert result.values["nodeSelector"] == {"nvidia.com/gpu.product": "A100"}
        assert len(result.values["tolerations"]) == 1
        assert result.values["runtimeClassName"] == "nvidia"

    @pytest.mark.asyncio
    async def test_full_config(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(
            resource_config={"cpu": "8", "memory": "32Gi", "gpu": "4", "gpu_type": "H100"}
        )
        result = await contributor.contribute(_make_session(), context)
        # Top-level resources has CPU/memory only (for skuld broker)
        res = result.values["resources"]
        assert res["requests"]["cpu"] == "8"
        assert res["requests"]["memory"] == "32Gi"
        assert "nvidia.com/gpu" not in res.get("limits", {})
        # Devrunner gets CPU/memory + GPU
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["requests"]["cpu"] == "8"
        assert devrunner_res["limits"]["nvidia.com/gpu"] == "4"
        assert result.values["nodeSelector"]["nvidia.com/gpu.product"] == "H100"

    @pytest.mark.asyncio
    async def test_gpu_timeslice_shares_gpu_with_skuld(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(resource_config={"gpu": "1", "gpu_timeslice": "true"})
        result = await contributor.contribute(_make_session(), context)
        # GPU should be on both skuld (top-level) and devrunner
        assert result.values["resources"]["limits"]["nvidia.com/gpu"] == "1"
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["limits"]["nvidia.com/gpu"] == "1"

    @pytest.mark.asyncio
    async def test_gpu_no_timeslice_only_devrunner(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(resource_config={"gpu": "1"})
        result = await contributor.contribute(_make_session(), context)
        # GPU should only be on devrunner, not skuld
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["limits"]["nvidia.com/gpu"] == "1"
        assert "resources" not in result.values  # No CPU/memory → no top-level

    @pytest.mark.asyncio
    async def test_gpu_timeslice_with_cpu_memory(self):
        provider = StaticResourceProvider()
        contributor = ResourceContributor(resource_provider=provider)
        context = SessionContext(
            resource_config={"cpu": "4", "memory": "8Gi", "gpu": "2", "gpu_timeslice": "true"}
        )
        result = await contributor.contribute(_make_session(), context)
        # Skuld gets CPU/memory + GPU (time-sliced)
        skuld_res = result.values["resources"]
        assert skuld_res["requests"] == {"cpu": "4", "memory": "8Gi"}
        assert skuld_res["limits"]["nvidia.com/gpu"] == "2"
        assert skuld_res["limits"]["cpu"] == "4"
        # Devrunner also gets everything
        devrunner_res = result.values["localServices"]["devrunner"]["resources"]
        assert devrunner_res["limits"]["nvidia.com/gpu"] == "2"
        assert devrunner_res["requests"]["cpu"] == "4"

    @pytest.mark.asyncio
    async def test_contributor_name(self):
        contributor = ResourceContributor()
        assert contributor.name == "resource"
