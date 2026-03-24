"""Tests for VolundrAdapterFactory."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from niuu.domain.models import IntegrationConnection, IntegrationType
from tyr.adapters.volundr_factory import VolundrAdapterFactory
from tyr.adapters.volundr_http import VolundrHTTPAdapter

from tests.test_tyr.conftest import StubCredentialStore, StubIntegrationRepo

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
