"""ServiceManager — orchestrates service startup via dependency graph.

Topological sort for start order, reverse for shutdown.
Health checks with backoff before declaring ready.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum

from cli.registry import PluginRegistry
from niuu.ports.plugin import Service

logger = logging.getLogger(__name__)


class ServiceState(Enum):
    """Current state of a managed service."""

    STOPPED = "stopped"
    STARTING = "starting"
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    STOPPING = "stopping"


class CircularDependencyError(Exception):
    """Raised when a circular dependency is detected in the plugin graph."""


@dataclass
class ServiceStatus:
    """Status of a single managed service."""

    name: str
    state: ServiceState = ServiceState.STOPPED
    service: Service | None = None


class ServiceManager:
    """Manages service lifecycle with dependency resolution."""

    def __init__(
        self,
        registry: PluginRegistry,
        health_check_interval: float = 2.0,
        health_check_timeout: float = 30.0,
        health_check_max_retries: int = 15,
    ) -> None:
        self._registry = registry
        self._health_check_interval = health_check_interval
        self._health_check_timeout = health_check_timeout
        self._health_check_max_retries = health_check_max_retries
        self._services: dict[str, ServiceStatus] = {}

    @property
    def services(self) -> dict[str, ServiceStatus]:
        """Return current service statuses."""
        return dict(self._services)

    def resolve_start_order(self, only: str | None = None) -> list[str]:
        """Resolve topological start order for enabled plugins.

        If only is provided, returns only that service + its dependencies.
        Raises CircularDependencyError if a cycle is detected.
        """
        plugins = self._registry.plugins
        graph: dict[str, list[str]] = {}
        for name, plugin in plugins.items():
            deps = [d for d in plugin.depends_on() if d in plugins]
            graph[name] = deps

        if only:
            needed = self._collect_deps(only, graph)
            graph = {k: v for k, v in graph.items() if k in needed}

        return self._topological_sort(graph)

    def _collect_deps(self, name: str, graph: dict[str, list[str]]) -> set[str]:
        """Collect all transitive dependencies of a service."""
        result: set[str] = set()
        stack = [name]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            for dep in graph.get(current, []):
                stack.append(dep)
        return result

    def _topological_sort(self, graph: dict[str, list[str]]) -> list[str]:
        """Kahn's algorithm for topological sort. Detects cycles."""
        # Build adjacency for "dep -> dependent"
        adj: dict[str, list[str]] = {n: [] for n in graph}
        for node, deps in graph.items():
            for dep in deps:
                if dep not in adj:
                    adj[dep] = []
                adj[dep].append(node)

        # Recompute in-degree from adjacency
        in_deg: dict[str, int] = {n: 0 for n in adj}
        for node, deps in graph.items():
            in_deg[node] = len(deps)
            if node not in adj:
                adj[node] = []

        queue = [n for n in in_deg if in_deg[n] == 0]
        result: list[str] = []

        while queue:
            queue.sort()
            node = queue.pop(0)
            result.append(node)
            for dependent in adj.get(node, []):
                in_deg[dependent] -= 1
                if in_deg[dependent] == 0:
                    queue.append(dependent)

        if len(result) != len(in_deg):
            missing = set(in_deg) - set(result)
            raise CircularDependencyError(
                f"circular dependency detected among: {', '.join(sorted(missing))}"
            )

        return result

    async def start_all(self, only: str | None = None) -> None:
        """Start services in dependency order."""
        order = self.resolve_start_order(only=only)
        plugins = self._registry.plugins

        for name in order:
            plugin = plugins.get(name)
            if not plugin:
                continue
            service = plugin.create_service()
            if not service:
                self._services[name] = ServiceStatus(name=name, state=ServiceState.HEALTHY)
                continue

            status = ServiceStatus(name=name, state=ServiceState.STARTING, service=service)
            self._services[name] = status

            await service.start()
            healthy = await self._wait_healthy(name, service)
            status.state = ServiceState.HEALTHY if healthy else ServiceState.UNHEALTHY

    async def stop_all(self) -> None:
        """Stop services in reverse dependency order."""
        order = list(reversed(self.resolve_start_order()))
        for name in order:
            status = self._services.get(name)
            if not status or not status.service:
                continue
            status.state = ServiceState.STOPPING
            try:
                await status.service.stop()
            except Exception:
                logger.exception("error stopping service: %s", name)
            status.state = ServiceState.STOPPED

    async def _wait_healthy(self, name: str, service: Service) -> bool:
        """Poll health check until healthy, timeout, or max retries."""
        loop = asyncio.get_event_loop()
        deadline = loop.time() + self._health_check_timeout
        for attempt in range(self._health_check_max_retries):
            if loop.time() > deadline:
                break
            try:
                if await service.health_check():
                    return True
            except Exception:
                logger.debug("health check failed for %s (attempt %d)", name, attempt + 1)
            await asyncio.sleep(self._health_check_interval)
        logger.error("service %s failed to become healthy", name)
        return False
