"""Tests for GatewayContributor."""

from unittest.mock import MagicMock

import pytest

from volundr.adapters.outbound.contributors.gateway import GatewayContributor
from volundr.domain.models import Session
from volundr.domain.ports import SessionContext


@pytest.fixture
def session():
    return Session(
        name="test",
        model="claude",
        repo="",
        branch="main",
        owner_id="user-1",
    )


class TestGatewayContributor:
    async def test_name(self):
        c = GatewayContributor()
        assert c.name == "gateway"

    async def test_no_gateway_returns_empty(self, session):
        c = GatewayContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_empty_config_returns_empty(self, session):
        gw = MagicMock()
        gw.get_gateway_config.return_value = {}
        c = GatewayContributor(gateway=gw)
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_gateway_values(self, session):
        gw = MagicMock()
        gw.get_gateway_config.return_value = {
            "gateway_name": "my-gw",
            "gateway_namespace": "system",
            "cors_origins": "https://app.example.com",
        }
        c = GatewayContributor(gateway=gw)
        result = await c.contribute(session, SessionContext())
        assert result.values["gateway"]["enabled"] is True
        assert result.values["gateway"]["name"] == "my-gw"
        assert result.values["gateway"]["namespace"] == "system"
        assert result.values["gateway"]["userId"] == "user-1"
        assert result.values["gateway"]["cors"]["allowOrigins"] == [
            "https://app.example.com"
        ]

    async def test_gateway_with_jwt(self, session):
        gw = MagicMock()
        gw.get_gateway_config.return_value = {
            "gateway_name": "gw",
            "gateway_namespace": "system",
            "issuer_url": "https://idp.example.com",
            "audience": "volundr",
            "jwks_uri": "https://idp.example.com/.well-known/jwks",
        }
        c = GatewayContributor(gateway=gw)
        result = await c.contribute(session, SessionContext())
        jwt = result.values["gateway"]["jwt"]
        assert jwt["enabled"] is True
        assert jwt["issuer"] == "https://idp.example.com"
        assert jwt["audiences"] == ["volundr"]
