"""Tests for BifrostPlugin."""

from __future__ import annotations

import pytest

from bifrost.plugin import BifrostPlugin, _BifrostService


class TestBifrostService:
    @pytest.mark.asyncio
    async def test_start(self) -> None:
        svc = _BifrostService()
        await svc.start()  # should not raise

    @pytest.mark.asyncio
    async def test_stop(self) -> None:
        svc = _BifrostService()
        await svc.stop()  # should not raise

    @pytest.mark.asyncio
    async def test_health_check_returns_true(self) -> None:
        svc = _BifrostService()
        assert await svc.health_check() is True


class TestBifrostPlugin:
    def test_name(self) -> None:
        plugin = BifrostPlugin()
        assert plugin.name == "bifrost"

    def test_description(self) -> None:
        plugin = BifrostPlugin()
        assert plugin.description

    def test_register_service_returns_definition(self) -> None:
        plugin = BifrostPlugin()
        svc_def = plugin.register_service()
        assert svc_def is not None
        assert svc_def.name == "bifrost"
        assert svc_def.default_port == 8082

    def test_create_service_returns_instance(self) -> None:
        plugin = BifrostPlugin()
        svc = plugin.create_service()
        assert isinstance(svc, _BifrostService)

    def test_create_api_app_returns_fastapi_app(self) -> None:
        from fastapi import FastAPI

        plugin = BifrostPlugin()
        app = plugin.create_api_app()
        assert isinstance(app, FastAPI)

    def test_depends_on_is_empty(self) -> None:
        plugin = BifrostPlugin()
        svc_def = plugin.register_service()
        assert svc_def.depends_on == []
