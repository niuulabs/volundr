"""Tests for VolundrAdapterFactory."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from niuu.domain.models import IntegrationConnection, IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from tyr.adapters.volundr_factory import VolundrAdapterFactory
from tyr.adapters.volundr_http import VolundrHTTPAdapter

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

_NOW = datetime.now(tz=UTC)


def _make_connection(
    *,
    enabled: bool = True,
    integration_type: IntegrationType = IntegrationType.CODE_FORGE,
    credential_name: str = "volundr-pat",
    config: dict | None = None,
) -> IntegrationConnection:
    return IntegrationConnection(
        id="conn-1",
        user_id="owner-1",
        integration_type=integration_type,
        adapter="tyr.adapters.volundr_http.VolundrHTTPAdapter",
        credential_name=credential_name,
        config={"url": "http://volundr-test:8000"} if config is None else config,
        enabled=enabled,
        created_at=_NOW,
        updated_at=_NOW,
    )


class StubIntegrationRepo(IntegrationRepository):
    """In-memory integration repository for testing."""

    def __init__(self, connections: list[IntegrationConnection] | None = None) -> None:
        self._connections = connections or []

    async def list_connections(
        self,
        user_id: str,
        integration_type: IntegrationType | None = None,
    ) -> list[IntegrationConnection]:
        return [
            c
            for c in self._connections
            if c.user_id == user_id
            and (integration_type is None or c.integration_type == integration_type)
        ]

    async def get_connection(self, connection_id: str) -> IntegrationConnection | None:
        return next((c for c in self._connections if c.id == connection_id), None)

    async def save_connection(self, connection: IntegrationConnection) -> IntegrationConnection:
        return connection

    async def delete_connection(self, connection_id: str) -> None:
        pass


class StubCredentialStore(CredentialStorePort):
    """In-memory credential store for testing."""

    def __init__(self, values: dict[str, dict[str, str]] | None = None) -> None:
        self._values = values or {}

    async def get_value(self, owner_type: str, owner_id: str, name: str) -> dict[str, str] | None:
        return self._values.get(f"{owner_type}:{owner_id}:{name}")

    async def store(self, *args, **kwargs):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def get(self, *args, **kwargs):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def delete(self, *args, **kwargs):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def list(self, *args, **kwargs):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def health_check(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_code_forge_connection_returns_none() -> None:
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[]),
        credential_store=StubCredentialStore(),
    )
    result = await factory.for_owner("owner-1")
    assert result is None


@pytest.mark.asyncio
async def test_disabled_connection_returns_none() -> None:
    conn = _make_connection(enabled=False)
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[conn]),
        credential_store=StubCredentialStore(
            values={"user:owner-1:volundr-pat": {"api_key": "tok-123"}}
        ),
    )
    result = await factory.for_owner("owner-1")
    assert result is None


@pytest.mark.asyncio
async def test_enabled_connection_valid_cred_returns_adapter() -> None:
    conn = _make_connection(enabled=True)
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[conn]),
        credential_store=StubCredentialStore(
            values={"user:owner-1:volundr-pat": {"api_key": "tok-123"}}
        ),
    )
    result = await factory.for_owner("owner-1")
    assert isinstance(result, VolundrHTTPAdapter)
    assert result._api_key == "tok-123"
    assert result._base_url == "http://volundr-test:8000"


@pytest.mark.asyncio
async def test_credential_store_returns_none() -> None:
    conn = _make_connection(enabled=True)
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[conn]),
        credential_store=StubCredentialStore(values={}),
    )
    result = await factory.for_owner("owner-1")
    assert result is None


@pytest.mark.asyncio
async def test_uses_default_url_when_not_in_config() -> None:
    conn = _make_connection(enabled=True, config={})
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[conn]),
        credential_store=StubCredentialStore(
            values={"user:owner-1:volundr-pat": {"api_key": "tok-456"}}
        ),
    )
    result = await factory.for_owner("owner-1")
    assert isinstance(result, VolundrHTTPAdapter)
    assert result._base_url == "http://volundr:8000"


@pytest.mark.asyncio
async def test_picks_first_enabled_connection() -> None:
    disabled = _make_connection(enabled=False)
    enabled = _make_connection(enabled=True, config={"url": "http://second:8000"})
    factory = VolundrAdapterFactory(
        integration_repo=StubIntegrationRepo(connections=[disabled, enabled]),
        credential_store=StubCredentialStore(
            values={"user:owner-1:volundr-pat": {"api_key": "tok-789"}}
        ),
    )
    result = await factory.for_owner("owner-1")
    assert isinstance(result, VolundrHTTPAdapter)
    assert result._base_url == "http://second:8000"
