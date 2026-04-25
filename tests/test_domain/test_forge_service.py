"""Tests for the shared Forge application service."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from volundr.domain.models import ModelProvider, SessionActivityState
from volundr.domain.services import RepoService, SessionService, StatsService, TokenService
from volundr.domain.services.forge import ForgeService


@pytest.mark.asyncio
async def test_create_and_start_session_delegates_to_session_service() -> None:
    session_service = AsyncMock(spec=SessionService)
    created = SimpleNamespace(id=uuid4())
    started = SimpleNamespace(id=created.id)
    session_service.create_session.return_value = created
    session_service.start_session.return_value = started
    forge = ForgeService(session_service)
    data = SimpleNamespace(
        name="demo",
        model="claude",
        source=SimpleNamespace(),
        template_name="template",
        preset_id=None,
        workspace_id=None,
        issue_id=None,
        issue_url=None,
        profile_name="default",
        terminal_restricted=False,
        credential_names=["cred"],
        integration_ids=["int-1"],
        resource_config={},
        system_prompt="system",
        initial_prompt="start",
        workload_type="interactive",
        workload_config={},
    )

    result = await forge.create_and_start_session(data)

    assert result is started
    session_service.create_session.assert_awaited_once()
    session_service.start_session.assert_awaited_once_with(
        created.id,
        profile_name="default",
        template_name="template",
        principal=None,
        terminal_restricted=False,
        credential_names=["cred"],
        integration_ids=["int-1"],
        resource_config=None,
        system_prompt="system",
        initial_prompt="start",
        workload_type="interactive",
        workload_config=None,
    )


@pytest.mark.asyncio
async def test_record_usage_delegates_to_token_service() -> None:
    session_service = AsyncMock(spec=SessionService)
    token_service = AsyncMock(spec=TokenService)
    forge = ForgeService(session_service, token_service=token_service)

    await forge.record_usage(
        session_id=uuid4(),
        tokens=42,
        provider=ModelProvider.CLOUD,
        model="claude",
        message_count=3,
        cost=1.25,
    )

    token_service.record_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_stats_uses_stats_service() -> None:
    session_service = AsyncMock(spec=SessionService)
    stats_service = AsyncMock(spec=StatsService)
    stats_service.get_stats.return_value = SimpleNamespace(active_sessions=1)
    forge = ForgeService(session_service, stats_service=stats_service)

    stats = await forge.get_stats()

    assert stats.active_sessions == 1
    stats_service.get_stats.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_update_activity_delegates_to_session_service() -> None:
    session_service = AsyncMock(spec=SessionService)
    forge = ForgeService(session_service)
    session_id = uuid4()

    await forge.update_activity(session_id, SessionActivityState.ACTIVE, {"source": "test"})

    session_service.update_activity.assert_awaited_once_with(
        session_id,
        SessionActivityState.ACTIVE,
        {"source": "test"},
    )


def test_list_providers_uses_repo_service() -> None:
    session_service = AsyncMock(spec=SessionService)
    repo_service = AsyncMock(spec=RepoService)
    repo_service.list_providers.return_value = [SimpleNamespace(name="github")]
    forge = ForgeService(session_service, repo_service=repo_service)

    providers = forge.list_providers()

    assert providers[0].name == "github"
    repo_service.list_providers.assert_called_once_with()
