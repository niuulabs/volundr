"""Tests for cli.services.manager — ServiceManager."""

from __future__ import annotations

import pytest

from cli.registry import PluginRegistry
from cli.services.manager import (
    CircularDependencyError,
    ServiceManager,
    ServiceState,
)
from tests.test_cli.conftest import FakePlugin, StubService


@pytest.fixture
def manager(registry: PluginRegistry) -> ServiceManager:
    return ServiceManager(
        registry=registry,
        health_check_interval=0.01,
        health_check_timeout=1.0,
        health_check_max_retries=3,
    )


class TestDependencyResolution:
    """Tests for topological sort and dependency resolution."""

    def test_no_deps(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b"))
        order = manager.resolve_start_order()
        assert set(order) == {"a", "b"}

    def test_linear_deps(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b", deps=["a"]))
        registry.register(FakePlugin(name="c", deps=["b"]))
        order = manager.resolve_start_order()
        assert order.index("a") < order.index("b")
        assert order.index("b") < order.index("c")

    def test_diamond_deps(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b", deps=["a"]))
        registry.register(FakePlugin(name="c", deps=["a"]))
        registry.register(FakePlugin(name="d", deps=["b", "c"]))
        order = manager.resolve_start_order()
        assert order.index("a") < order.index("b")
        assert order.index("a") < order.index("c")
        assert order.index("b") < order.index("d")
        assert order.index("c") < order.index("d")

    def test_circular_dependency(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        registry.register(FakePlugin(name="a", deps=["b"]))
        registry.register(FakePlugin(name="b", deps=["a"]))
        with pytest.raises(CircularDependencyError, match="circular dependency"):
            manager.resolve_start_order()

    def test_only_filters_to_service_and_deps(
        self, registry: PluginRegistry, manager: ServiceManager
    ) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b", deps=["a"]))
        registry.register(FakePlugin(name="c"))
        order = manager.resolve_start_order(only="b")
        assert "a" in order
        assert "b" in order
        assert "c" not in order

    def test_only_single_no_deps(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b"))
        order = manager.resolve_start_order(only="a")
        assert order == ["a"]

    def test_ignores_deps_on_disabled_plugins(
        self, registry: PluginRegistry, manager: ServiceManager
    ) -> None:
        registry.register(FakePlugin(name="a"))
        registry.register(FakePlugin(name="b", deps=["a"]))
        registry.disable("a")
        # "a" is disabled, so "b" should have no deps resolved
        order = manager.resolve_start_order()
        assert order == ["b"]


class TestServiceLifecycle:
    """Tests for start/stop and health checks."""

    async def test_start_all(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        svc = StubService()
        registry.register(FakePlugin(name="a", service=svc))
        await manager.start_all()
        assert svc.started is True
        assert manager.services["a"].state == ServiceState.HEALTHY

    async def test_start_unhealthy(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        svc = StubService(healthy=False)
        registry.register(FakePlugin(name="a", service=svc))
        await manager.start_all()
        assert svc.started is True
        assert manager.services["a"].state == ServiceState.UNHEALTHY

    async def test_stop_all(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        svc = StubService()
        registry.register(FakePlugin(name="a", service=svc))
        await manager.start_all()
        await manager.stop_all()
        assert svc.stopped is True
        assert manager.services["a"].state == ServiceState.STOPPED

    async def test_start_with_only(self, registry: PluginRegistry, manager: ServiceManager) -> None:
        svc_a = StubService()
        svc_b = StubService()
        svc_c = StubService()
        registry.register(FakePlugin(name="a", service=svc_a))
        registry.register(FakePlugin(name="b", deps=["a"], service=svc_b))
        registry.register(FakePlugin(name="c", service=svc_c))
        await manager.start_all(only="b")
        assert svc_a.started is True
        assert svc_b.started is True
        assert svc_c.started is False

    async def test_plugin_without_service(
        self, registry: PluginRegistry, manager: ServiceManager
    ) -> None:
        registry.register(FakePlugin(name="a"))
        await manager.start_all()
        assert manager.services["a"].state == ServiceState.HEALTHY

    async def test_stop_handles_errors(
        self, registry: PluginRegistry, manager: ServiceManager
    ) -> None:
        svc = StubService()
        registry.register(FakePlugin(name="a", service=svc))
        await manager.start_all()

        async def bad_stop() -> None:
            raise RuntimeError("stop failed")

        svc.stop = bad_stop  # type: ignore[assignment]
        await manager.stop_all()
        assert manager.services["a"].state == ServiceState.STOPPED

    async def test_services_property_is_copy(
        self, registry: PluginRegistry, manager: ServiceManager
    ) -> None:
        registry.register(FakePlugin(name="a"))
        await manager.start_all()
        services = manager.services
        services.clear()
        assert len(manager.services) == 1
