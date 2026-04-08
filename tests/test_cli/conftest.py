"""Shared fixtures for CLI tests."""

from __future__ import annotations

from collections.abc import Sequence

import pytest
import typer

from cli.registry import PluginRegistry, Service, ServicePlugin


class StubService(Service):
    """Test service that tracks start/stop/health calls."""

    def __init__(self, healthy: bool = True) -> None:
        self.started = False
        self.stopped = False
        self._healthy = healthy
        self.health_check_count = 0

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    async def health_check(self) -> bool:
        self.health_check_count += 1
        return self._healthy


class FakePlugin(ServicePlugin):
    """Test plugin for unit tests."""

    def __init__(
        self,
        name: str = "fake",
        description: str = "A fake plugin",
        deps: Sequence[str] | None = None,
        service: Service | None = None,
        has_commands: bool = False,
    ) -> None:
        self._name = name
        self._description = description
        self._deps = list(deps or [])
        self._service = service
        self._has_commands = has_commands

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return self._description

    def depends_on(self) -> Sequence[str]:
        return self._deps

    def create_service(self) -> Service | None:
        return self._service

    def register_commands(self, app: typer.Typer) -> None:
        if not self._has_commands:
            return

        @app.command()
        def test_cmd() -> None:
            """A test command."""
            typer.echo(f"{self._name} test command")


@pytest.fixture
def registry() -> PluginRegistry:
    """Return a fresh plugin registry."""
    return PluginRegistry()


@pytest.fixture
def fake_plugin() -> FakePlugin:
    """Return a basic fake plugin."""
    return FakePlugin()


@pytest.fixture
def stub_service() -> StubService:
    """Return a basic stub service."""
    return StubService()
