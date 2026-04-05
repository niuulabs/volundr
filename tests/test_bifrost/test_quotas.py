"""Tests for quota enforcement in the Bifröst gateway."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from bifrost.adapters.memory_store import MemoryUsageStore
from bifrost.app import create_app
from bifrost.auth import AgentIdentity
from bifrost.config import AgentPermissions, BifrostConfig, ProviderConfig, QuotaConfig
from bifrost.inbound.routes import _check_quotas
from bifrost.ports.usage_store import UsageRecord
from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_response() -> AnthropicResponse:
    return AnthropicResponse(
        id="msg",
        content=[TextBlock(text="ok")],
        model="claude-sonnet-4-6",
        stop_reason="end_turn",
        usage=UsageInfo(input_tokens=10, output_tokens=5),
    )


def _base_config(**kwargs) -> BifrostConfig:
    return BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        **kwargs,
    )


def _seeded_store(*records: UsageRecord) -> MemoryUsageStore:
    store = MemoryUsageStore()
    # Seed synchronously via the internal list.
    store._records.extend(records)
    return store


def _now_record(
    tenant_id: str = "t",
    agent_id: str = "a",
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float = 0.0,
) -> UsageRecord:
    return UsageRecord(
        request_id="",
        agent_id=agent_id,
        tenant_id=tenant_id,
        session_id="",
        saga_id="",
        model="claude-sonnet-4-6",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        timestamp=datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Unit tests for _check_quotas
# ---------------------------------------------------------------------------


async def _check(identity: AgentIdentity, config: BifrostConfig, store) -> list[str]:
    """Convenience wrapper that resolves agent_perms before calling _check_quotas."""
    return await _check_quotas(
        identity, config, store, config.permissions_for_agent(identity.agent_id)
    )


class TestCheckQuotas:
    @pytest.fixture
    def identity(self) -> AgentIdentity:
        return AgentIdentity(agent_id="agent-1", tenant_id="tenant-1")

    async def test_no_limits_no_warnings(self, identity):
        config = _base_config()
        store = MemoryUsageStore()
        warnings = await _check(identity, config, store)
        assert warnings == []

    # ── Token quota ──────────────────────────────────────────────────────────

    async def test_hard_token_limit_raises_429(self, identity):
        from fastapi import HTTPException

        config = _base_config(
            default_quota=QuotaConfig(max_tokens_per_day=100),
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", input_tokens=80, output_tokens=30))
        with pytest.raises(HTTPException) as exc_info:
            await _check(identity, config, store)
        assert exc_info.value.status_code == 429

    async def test_soft_token_limit_returns_warning(self, identity):
        config = _base_config(
            default_quota=QuotaConfig(max_tokens_per_day=100, soft_limit_fraction=0.8),
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", input_tokens=85, output_tokens=0))
        warnings = await _check(identity, config, store)
        assert any("token" in w for w in warnings)

    async def test_under_soft_token_limit_no_warning(self, identity):
        config = _base_config(
            default_quota=QuotaConfig(max_tokens_per_day=1000, soft_limit_fraction=0.9),
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", input_tokens=100, output_tokens=0))
        warnings = await _check(identity, config, store)
        assert not any("token" in w for w in warnings)

    # ── Cost quota ───────────────────────────────────────────────────────────

    async def test_hard_cost_limit_raises_429(self, identity):
        from fastapi import HTTPException

        config = _base_config(
            default_quota=QuotaConfig(max_cost_per_day=1.0),
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", cost_usd=1.50))
        with pytest.raises(HTTPException) as exc_info:
            await _check(identity, config, store)
        assert exc_info.value.status_code == 429

    async def test_soft_cost_limit_returns_warning(self, identity):
        config = _base_config(
            default_quota=QuotaConfig(max_cost_per_day=1.0, soft_limit_fraction=0.9),
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", cost_usd=0.95))
        warnings = await _check(identity, config, store)
        assert any("cost" in w for w in warnings)

    # ── Request-rate quota ───────────────────────────────────────────────────

    async def test_hard_request_limit_raises_429(self, identity):
        from fastapi import HTTPException

        config = _base_config(
            default_quota=QuotaConfig(max_requests_per_hour=2),
        )
        store = _seeded_store(
            _now_record(tenant_id="tenant-1"),
            _now_record(tenant_id="tenant-1"),
            _now_record(tenant_id="tenant-1"),
        )
        with pytest.raises(HTTPException) as exc_info:
            await _check(identity, config, store)
        assert exc_info.value.status_code == 429

    async def test_soft_request_limit_returns_warning(self, identity):
        config = _base_config(
            default_quota=QuotaConfig(max_requests_per_hour=10, soft_limit_fraction=0.8),
        )
        store = _seeded_store(*[_now_record(tenant_id="tenant-1") for _ in range(9)])
        warnings = await _check(identity, config, store)
        assert any("request" in w for w in warnings)

    # ── Agent-level cost quota ───────────────────────────────────────────────

    async def test_agent_cost_hard_limit(self, identity):
        from fastapi import HTTPException

        config = _base_config(
            agent_permissions={
                "agent-1": AgentPermissions(quota=QuotaConfig(max_cost_per_day=0.50))
            }
        )
        store = _seeded_store(_now_record(agent_id="agent-1", cost_usd=0.60))
        with pytest.raises(HTTPException) as exc_info:
            await _check(identity, config, store)
        assert exc_info.value.status_code == 429

    async def test_agent_cost_soft_limit(self, identity):
        config = _base_config(
            agent_permissions={
                "agent-1": AgentPermissions(
                    quota=QuotaConfig(max_cost_per_day=1.0, soft_limit_fraction=0.8)
                )
            }
        )
        store = _seeded_store(_now_record(agent_id="agent-1", cost_usd=0.85))
        warnings = await _check(identity, config, store)
        assert any("agent" in w for w in warnings)

    # ── Per-tenant override ──────────────────────────────────────────────────

    async def test_tenant_specific_quota_used(self, identity):
        from fastapi import HTTPException

        config = _base_config(
            default_quota=QuotaConfig(max_tokens_per_day=10_000),
            tenant_quotas={"tenant-1": QuotaConfig(max_tokens_per_day=100)},
        )
        store = _seeded_store(_now_record(tenant_id="tenant-1", input_tokens=80, output_tokens=30))
        with pytest.raises(HTTPException) as exc_info:
            await _check(identity, config, store)
        assert exc_info.value.status_code == 429


# ---------------------------------------------------------------------------
# Model access control — via HTTP endpoint
# ---------------------------------------------------------------------------


class TestModelAccessControl:
    def _build_client(self, allowed_models: list[str]) -> TestClient:
        config = _base_config(
            agent_permissions={"agent-restricted": AgentPermissions(allowed_models=allowed_models)}
        )
        app = create_app(config)
        return TestClient(app, raise_server_exceptions=False)

    def test_unrestricted_agent_can_use_any_model(self):
        config = _base_config()
        app = create_app(config)
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            with TestClient(app) as client:
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
        assert resp.status_code == 200

    def test_restricted_agent_blocked_from_disallowed_model(self):
        client = self._build_client(["claude-haiku-4-5-20251001"])
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock):
            resp = client.post(
                "/v1/messages",
                headers={"x-agent-id": "agent-restricted"},
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 403

    def test_restricted_agent_allowed_for_permitted_model(self):
        client = self._build_client(["claude-sonnet-4-6"])
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            resp = client.post(
                "/v1/messages",
                headers={"x-agent-id": "agent-restricted"},
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 200

    def test_quota_warning_header_on_soft_limit(self):
        config = _base_config(
            default_quota=QuotaConfig(
                max_requests_per_hour=10,
                soft_limit_fraction=0.5,
            )
        )
        app = create_app(config)
        # Pre-seed 6 requests so we're above the 50% soft limit (6/10).
        # Access the store through the app's internal store.

        # Create a store and patch it into the app via create_app internals.
        # Simpler: just make many requests in the test.
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            with TestClient(app) as client:
                # Make 6 requests to exceed the soft limit.
                for _ in range(6):
                    client.post(
                        "/v1/messages",
                        json={
                            "model": "claude-sonnet-4-6",
                            "max_tokens": 10,
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                # 7th request should have the warning header.
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
        assert resp.status_code == 200
        assert "X-Quota-Warning" in resp.headers

    def test_hard_limit_returns_429_via_http(self):
        config = _base_config(default_quota=QuotaConfig(max_requests_per_hour=2))
        app = create_app(config)
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            m.return_value = _make_response()
            with TestClient(app, raise_server_exceptions=False) as client:
                for _ in range(2):
                    client.post(
                        "/v1/messages",
                        json={
                            "model": "claude-sonnet-4-6",
                            "max_tokens": 10,
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
        assert resp.status_code == 429
