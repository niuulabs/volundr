"""Tests for IntegrationContributor."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from volundr.adapters.outbound.contributors.integrations import IntegrationContributor
from volundr.domain.models import (
    GitSource,
    IntegrationConnection,
    IntegrationDefinition,
    MCPServerSpec,
    Principal,
    Session,
)
from volundr.domain.ports import SessionContext
from volundr.domain.services.integration_registry import IntegrationRegistry


@pytest.fixture
def session():
    return Session(
        name="test",
        model="claude",
        source=GitSource(repo="", branch="main"),
        owner_id="user-1",
    )


@pytest.fixture
def principal():
    return Principal(user_id="user-1", email="u@x.com", tenant_id="t-1", roles=[])


def _linear_definition():
    return IntegrationDefinition(
        slug="linear",
        name="Linear",
        description="Issue tracker",
        integration_type="issue_tracker",
        adapter="volundr.adapters.outbound.linear.LinearAdapter",
        icon="linear",
        mcp_server=MCPServerSpec(
            name="linear",
            command="npx",
            args=("@anthropic/linear-mcp",),
            env_from_credentials={"LINEAR_API_KEY": "api_key"},
        ),
    )


def _linear_connection(*, conn_id="conn-linear", enabled=True):
    return IntegrationConnection(
        id=conn_id,
        user_id="user-1",
        integration_type="issue_tracker",
        adapter="volundr.adapters.outbound.linear.LinearAdapter",
        credential_name="linear-cred",
        config={},
        enabled=enabled,
        created_at=datetime.now(tz=UTC),
        updated_at=datetime.now(tz=UTC),
        slug="linear",
    )


def _mock_user_integration(credentials=None):
    """Create a mock UserIntegrationService."""
    ui = AsyncMock()
    ui.resolve_credentials.return_value = credentials or {}
    return ui


class TestIntegrationContributor:
    async def test_name(self):
        c = IntegrationContributor()
        assert c.name == "integrations"

    async def test_no_connections_returns_empty(self, session):
        c = IntegrationContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}

    async def test_no_registry_returns_empty(self, session, principal):
        ctx = SessionContext(
            principal=principal,
            integration_connections=(_linear_connection(),),
        )
        c = IntegrationContributor()
        result = await c.contribute(session, ctx)
        assert result.values == {}

    async def test_resolves_mcp_server(self, session, principal):
        registry = IntegrationRegistry([_linear_definition()])
        ui = _mock_user_integration({"api_key": "lin_key_123"})

        ctx = SessionContext(
            principal=principal,
            integration_connections=(_linear_connection(),),
        )
        c = IntegrationContributor(
            integration_registry=registry,
            user_integration=ui,
        )
        result = await c.contribute(session, ctx)

        assert len(result.values["mcpServers"]) == 1
        server = result.values["mcpServers"][0]
        assert server["name"] == "linear"
        assert server["command"] == "npx"
        assert server["env"]["LINEAR_API_KEY"] == "lin_key_123"

        ui.resolve_credentials.assert_called_once_with("user-1", "linear-cred")

    async def test_no_mcp_spec_skipped(self, session, principal):
        defn = IntegrationDefinition(
            slug="jira",
            name="Jira",
            description="Tracker",
            integration_type="issue_tracker",
            adapter="volundr.adapters.outbound.jira.JiraAdapter",
            icon="jira",
            mcp_server=None,
        )
        registry = IntegrationRegistry([defn])

        conn = IntegrationConnection(
            id="conn-jira",
            user_id="user-1",
            integration_type="issue_tracker",
            adapter="volundr.adapters.outbound.jira.JiraAdapter",
            credential_name="jira-cred",
            config={},
            enabled=True,
            created_at=datetime.now(tz=UTC),
            updated_at=datetime.now(tz=UTC),
            slug="jira",
        )

        ctx = SessionContext(
            principal=principal,
            integration_connections=(conn,),
        )
        c = IntegrationContributor(
            integration_registry=registry,
            user_integration=_mock_user_integration(),
        )
        result = await c.contribute(session, ctx)
        assert result.values == {}

    async def test_no_credential_still_builds_config(self, session, principal):
        """MCP server config should still build with empty credentials."""
        registry = IntegrationRegistry([_linear_definition()])
        ui = _mock_user_integration()

        ctx = SessionContext(
            principal=principal,
            integration_connections=(_linear_connection(),),
        )
        c = IntegrationContributor(
            integration_registry=registry,
            user_integration=ui,
        )
        result = await c.contribute(session, ctx)
        assert len(result.values["mcpServers"]) == 1
        assert result.values["mcpServers"][0]["env"]["LINEAR_API_KEY"] == ""

    async def test_env_from_credentials(self, session, principal):
        """Non-MCP integration with env_from_credentials produces envSecrets."""
        defn = IntegrationDefinition(
            slug="anthropic",
            name="Anthropic",
            description="AI provider",
            integration_type="ai_provider",
            adapter="volundr.adapters.outbound.anthropic.AnthropicAdapter",
            icon="anthropic",
            mcp_server=None,
            env_from_credentials={"ANTHROPIC_API_KEY": "api_key"},
        )
        registry = IntegrationRegistry([defn])

        conn = IntegrationConnection(
            id="conn-anthropic",
            user_id="user-1",
            integration_type="ai_provider",
            adapter="volundr.adapters.outbound.anthropic.AnthropicAdapter",
            credential_name="anthropic-cred",
            config={},
            enabled=True,
            created_at=datetime.now(tz=UTC),
            updated_at=datetime.now(tz=UTC),
            slug="anthropic",
        )
        ui = _mock_user_integration({"api_key": "sk-ant-123"})

        ctx = SessionContext(
            principal=principal,
            integration_connections=(conn,),
        )
        c = IntegrationContributor(
            integration_registry=registry,
            user_integration=ui,
        )
        result = await c.contribute(session, ctx)

        assert "envSecrets" in result.values
        secrets = result.values["envSecrets"]
        assert len(secrets) == 1
        assert secrets[0]["envVar"] == "ANTHROPIC_API_KEY"
        assert secrets[0]["secretName"] == "anthropic-cred"
        assert secrets[0]["secretKey"] == "api_key"

    async def test_no_principal_skips_credential_fetch(self, session):
        """Without a principal, credentials are empty dicts."""
        registry = IntegrationRegistry([_linear_definition()])
        ui = _mock_user_integration()

        ctx = SessionContext(
            integration_connections=(_linear_connection(),),
        )
        c = IntegrationContributor(
            integration_registry=registry,
            user_integration=ui,
        )
        result = await c.contribute(session, ctx)

        # Still builds MCP config but with empty credential values
        assert len(result.values["mcpServers"]) == 1
        assert result.values["mcpServers"][0]["env"]["LINEAR_API_KEY"] == ""
        ui.resolve_credentials.assert_not_called()
