"""Tests for SecretInjectionContributor and SecretsContributor."""

from unittest.mock import AsyncMock

import pytest

from volundr.adapters.outbound.contributors.secrets import (
    SecretInjectionContributor,
    SecretsContributor,
)
from volundr.domain.models import GitSource, PodSpecAdditions, Session
from volundr.domain.ports import SessionContext


@pytest.fixture
def session():
    return Session(
        name="test",
        model="claude",
        source=GitSource(repo="", branch="main"),
        owner_id="user-1",
    )


class TestSecretInjectionContributor:
    async def test_name(self):
        c = SecretInjectionContributor()
        assert c.name == "secret_injection"

    async def test_no_adapter_returns_empty(self, session):
        c = SecretInjectionContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}
        assert result.pod_spec is None

    async def test_no_owner_returns_empty(self):
        session = Session(name="test", model="claude", source=GitSource(repo="", branch="main"))
        adapter = AsyncMock()
        c = SecretInjectionContributor(secret_injection=adapter)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is None
        adapter.pod_spec_additions.assert_not_called()

    async def test_returns_pod_spec(self, session):
        pod_spec = PodSpecAdditions(
            volumes=({"name": "secrets"},),
            labels={"injected": "true"},
        )
        adapter = AsyncMock()
        adapter.pod_spec_additions.return_value = pod_spec
        c = SecretInjectionContributor(secret_injection=adapter)
        result = await c.contribute(session, SessionContext())
        assert result.pod_spec is pod_spec
        adapter.pod_spec_additions.assert_called_once_with("user-1", str(session.id))


class TestSecretsContributor:
    async def test_name(self):
        c = SecretsContributor()
        assert c.name == "secrets"

    async def test_contribute_returns_empty(self, session):
        c = SecretsContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_cleanup_calls_delete(self, session):
        repo = AsyncMock()
        c = SecretsContributor(secret_repo=repo)
        await c.cleanup(session, SessionContext())
        repo.delete_session_secrets.assert_called_once_with(str(session.id))

    async def test_cleanup_noop_without_repo(self, session):
        c = SecretsContributor()
        await c.cleanup(session, SessionContext())  # Should not raise
