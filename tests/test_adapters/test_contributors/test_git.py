"""Tests for GitContributor."""

from unittest.mock import MagicMock

import pytest

from volundr.adapters.outbound.contributors.git import GitContributor
from volundr.domain.models import Session
from volundr.domain.ports import SessionContext


@pytest.fixture
def session():
    return Session(
        name="test",
        model="claude",
        repo="https://github.com/org/repo",
        branch="feat/test",
    )


class TestGitContributor:
    async def test_name(self):
        c = GitContributor()
        assert c.name == "git"

    async def test_no_registry_returns_empty(self, session):
        c = GitContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_no_repo_returns_empty(self):
        session = Session(name="test", model="claude", repo="", branch="main")
        registry = MagicMock()
        c = GitContributor(git_registry=registry)
        result = await c.contribute(session, SessionContext())
        assert result.values == {}
        registry.get_clone_url.assert_not_called()

    async def test_clone_url_available(self, session):
        registry = MagicMock()
        registry.get_clone_url.return_value = "https://token@github.com/org/repo.git"
        c = GitContributor(git_registry=registry)
        result = await c.contribute(session, SessionContext())
        assert result.values["git"]["repoUrl"] == "https://github.com/org/repo"
        assert result.values["git"]["cloneUrl"] == "https://token@github.com/org/repo.git"
        assert result.values["git"]["branch"] == "feat/test"

    async def test_clone_url_none(self, session):
        registry = MagicMock()
        registry.get_clone_url.return_value = None
        c = GitContributor(git_registry=registry)
        result = await c.contribute(session, SessionContext())
        assert result.values == {}
