"""Tests for RavnPlugin — ServicePlugin implementation."""

from __future__ import annotations

import pytest

from niuu.ports.plugin import Service, ServiceDefinition, TUIPageSpec
from ravn.plugin import RavnPlugin, _RavnService

# ---------------------------------------------------------------------------
# _RavnService lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ravn_service_start_is_noop():
    svc = _RavnService()
    await svc.start()  # Should not raise


@pytest.mark.asyncio
async def test_ravn_service_stop_is_noop():
    svc = _RavnService()
    await svc.stop()  # Should not raise


@pytest.mark.asyncio
async def test_ravn_service_health_check_returns_true():
    svc = _RavnService()
    assert await svc.health_check() is True


# ---------------------------------------------------------------------------
# RavnPlugin identity
# ---------------------------------------------------------------------------


def test_plugin_name():
    plugin = RavnPlugin()
    assert plugin.name == "ravn"


def test_plugin_description():
    plugin = RavnPlugin()
    assert "agent" in plugin.description.lower()


# ---------------------------------------------------------------------------
# ServiceDefinition
# ---------------------------------------------------------------------------


def test_register_service_returns_definition():
    plugin = RavnPlugin()
    defn = plugin.register_service()
    assert isinstance(defn, ServiceDefinition)
    assert defn.name == "ravn"


def test_register_service_factory_creates_service():
    plugin = RavnPlugin()
    defn = plugin.register_service()
    svc = defn.factory()
    assert isinstance(svc, Service)


def test_create_service_returns_service():
    plugin = RavnPlugin()
    svc = plugin.create_service()
    assert isinstance(svc, Service)


def test_depends_on_returns_empty():
    plugin = RavnPlugin()
    assert list(plugin.depends_on()) == []


# ---------------------------------------------------------------------------
# TUI pages
# ---------------------------------------------------------------------------


def test_tui_pages_returns_agents_page():
    plugin = RavnPlugin()
    pages = plugin.tui_pages()
    assert len(pages) == 1
    spec = pages[0]
    assert isinstance(spec, TUIPageSpec)
    assert spec.name == "Agents"


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------


def test_register_commands_adds_ravn_typer():
    import typer

    plugin = RavnPlugin()
    app = typer.Typer()
    plugin.register_commands(app)

    # The ravn sub-command group should now be registered.
    group_names = {g.name for g in app.registered_groups}
    assert "ravn" in group_names


# ---------------------------------------------------------------------------
# API app
# ---------------------------------------------------------------------------


def test_create_api_app_returns_fastapi():
    from fastapi import FastAPI

    plugin = RavnPlugin()
    app = plugin.create_api_app()
    assert isinstance(app, FastAPI)
