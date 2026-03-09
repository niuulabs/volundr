"""Tests for TemplateContributor."""

from unittest.mock import MagicMock

import pytest

from volundr.adapters.outbound.contributors.template import TemplateContributor
from volundr.domain.models import ForgeProfile, Session, WorkspaceTemplate
from volundr.domain.ports import SessionContext


@pytest.fixture
def session():
    return Session(name="test", model="claude", repo="", branch="main")


@pytest.fixture
def template():
    return WorkspaceTemplate(
        name="default",
        resource_config={"requests": {"cpu": "100m"}},
        env_vars={"KEY": "val"},
        mcp_servers=[{"name": "test"}],
        system_prompt="Be helpful",
        workload_config={"extra": "config"},
    )


@pytest.fixture
def profile():
    return ForgeProfile(
        name="default",
        resource_config={"requests": {"memory": "256Mi"}},
        env_vars={"PROFILE_KEY": "profile_val"},
    )


class TestTemplateContributor:
    async def test_name(self):
        c = TemplateContributor()
        assert c.name == "template"

    async def test_no_providers_returns_empty(self, session):
        c = TemplateContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_template_values(self, session, template):
        provider = MagicMock()
        provider.get.return_value = template
        c = TemplateContributor(template_provider=provider)
        ctx = SessionContext(template_name="default")
        result = await c.contribute(session, ctx)
        assert result.values["resources"] == {"requests": {"cpu": "100m"}}
        assert result.values["env"] == {"KEY": "val"}
        assert result.values["mcpServers"] == [{"name": "test"}]
        assert result.values["session"] == {"systemPrompt": "Be helpful"}
        assert result.values["extra"] == "config"

    async def test_profile_fallback(self, session, profile):
        profile_provider = MagicMock()
        profile_provider.get.return_value = profile
        c = TemplateContributor(profile_provider=profile_provider)
        ctx = SessionContext(profile_name="default")
        result = await c.contribute(session, ctx)
        assert result.values["resources"] == {"requests": {"memory": "256Mi"}}
        assert result.values["env"] == {"PROFILE_KEY": "profile_val"}

    async def test_template_takes_precedence_over_profile(self, session, template, profile):
        template_provider = MagicMock()
        template_provider.get.return_value = template
        profile_provider = MagicMock()
        profile_provider.get.return_value = profile
        c = TemplateContributor(
            template_provider=template_provider,
            profile_provider=profile_provider,
        )
        ctx = SessionContext(template_name="default", profile_name="default")
        result = await c.contribute(session, ctx)
        # Template resources should win
        assert result.values["resources"] == {"requests": {"cpu": "100m"}}

    async def test_default_profile_fallback(self, session, profile):
        profile_provider = MagicMock()
        profile_provider.get.return_value = None
        profile_provider.get_default.return_value = profile
        c = TemplateContributor(profile_provider=profile_provider)
        ctx = SessionContext(profile_name="nonexistent")
        result = await c.contribute(session, ctx)
        assert result.values["resources"] == {"requests": {"memory": "256Mi"}}
