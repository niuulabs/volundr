"""Tests for SecretInjectionContributor and SecretsContributor."""

import datetime
from unittest.mock import AsyncMock

import pytest

from volundr.adapters.outbound.contributors.secrets import (
    SecretInjectionContributor,
    SecretsContributor,
)
from volundr.domain.models import (
    GitSource,
    MountType,
    PodSpecAdditions,
    Principal,
    SecretType,
    Session,
    StoredCredential,
)
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


def _make_credential(
    name: str = "my-token",
    secret_type: SecretType = SecretType.API_KEY,
    keys: tuple[str, ...] = ("token",),
) -> StoredCredential:
    now = datetime.datetime.now(datetime.UTC)
    return StoredCredential(
        id="cred-1",
        name=name,
        secret_type=secret_type,
        keys=keys,
        metadata={},
        owner_id="user-1",
        owner_type="user",
        created_at=now,
        updated_at=now,
    )


class TestSecretInjectionContributorCredentials:
    """Tests for credential resolution in SecretInjectionContributor."""

    @pytest.fixture
    def principal(self):
        return Principal(user_id="user-1", email="u@test.com", tenant_id="t1", roles=[])

    @pytest.fixture
    def session(self):
        return Session(
            name="test",
            model="claude",
            source=GitSource(repo="", branch="main"),
            owner_id="user-1",
        )

    async def test_resolves_env_secrets_from_credentials(self, session, principal):
        """Resolves user-selected credentials into envSecrets entries."""
        cred_store = AsyncMock()
        cred_store.get.return_value = _make_credential(
            name="gh-token",
            secret_type=SecretType.API_KEY,
            keys=("token", "api_key"),
        )

        ctx = SessionContext(
            principal=principal,
            credential_names=("gh-token",),
        )
        c = SecretInjectionContributor(credential_store=cred_store)
        result = await c.contribute(session, ctx)

        assert "envSecrets" in result.values
        env_secrets = result.values["envSecrets"]
        assert len(env_secrets) == 2
        assert env_secrets[0]["envVar"] == "TOKEN"
        assert env_secrets[0]["secretName"] == "gh-token"
        assert env_secrets[0]["secretKey"] == "token"

    async def test_missing_credential_skipped(self, session, principal):
        """Missing credentials are skipped with a warning."""
        cred_store = AsyncMock()
        cred_store.get.return_value = None

        ctx = SessionContext(
            principal=principal,
            credential_names=("nonexistent",),
        )
        c = SecretInjectionContributor(credential_store=cred_store)
        result = await c.contribute(session, ctx)

        # No envSecrets when credential not found
        assert "envSecrets" not in result.values

    async def test_no_credentials_no_principal(self, session):
        """No credential resolution without principal."""
        cred_store = AsyncMock()
        ctx = SessionContext(credential_names=("gh-token",))
        c = SecretInjectionContributor(credential_store=cred_store)
        result = await c.contribute(session, ctx)

        assert "envSecrets" not in result.values
        cred_store.get.assert_not_called()

    async def test_no_credential_names_skips_resolution(self, session, principal):
        """No credential resolution when credential_names is empty."""
        cred_store = AsyncMock()
        ctx = SessionContext(principal=principal, credential_names=())
        c = SecretInjectionContributor(credential_store=cred_store)
        result = await c.contribute(session, ctx)

        assert "envSecrets" not in result.values
        cred_store.get.assert_not_called()
