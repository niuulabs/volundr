"""Tests for PromptContributor."""

import pytest

from volundr.adapters.outbound.contributors.prompt import PromptContributor
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


class TestPromptContributor:
    """Tests for the prompt contributor."""

    @pytest.mark.asyncio
    async def test_empty_context_returns_empty(self):
        contributor = PromptContributor()
        context = SessionContext()
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {}

    @pytest.mark.asyncio
    async def test_system_prompt_only(self):
        contributor = PromptContributor()
        context = SessionContext(system_prompt="You are a code reviewer.")
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {"session": {"systemPrompt": "You are a code reviewer."}}

    @pytest.mark.asyncio
    async def test_initial_prompt_only(self):
        contributor = PromptContributor()
        context = SessionContext(initial_prompt="Fix the auth bug in login.py")
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {"session": {"initialPrompt": "Fix the auth bug in login.py"}}

    @pytest.mark.asyncio
    async def test_both_prompts(self):
        contributor = PromptContributor()
        context = SessionContext(
            system_prompt="You are an agent.",
            initial_prompt="Break down ticket TK-123.",
        )
        result = await contributor.contribute(_make_session(), context)
        assert result.values == {
            "session": {
                "systemPrompt": "You are an agent.",
                "initialPrompt": "Break down ticket TK-123.",
            }
        }

    @pytest.mark.asyncio
    async def test_name_property(self):
        contributor = PromptContributor()
        assert contributor.name == "prompt"

    @pytest.mark.asyncio
    async def test_accepts_extra_kwargs(self):
        """PromptContributor follows the dynamic adapter pattern and ignores extra kwargs."""
        contributor = PromptContributor(template_provider=None, some_port=object())
        context = SessionContext(system_prompt="test")
        result = await contributor.contribute(_make_session(), context)
        assert result.values["session"]["systemPrompt"] == "test"
