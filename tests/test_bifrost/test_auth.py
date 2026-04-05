"""Tests for bifrost.auth — agent identity extraction."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from bifrost.app import create_app
from bifrost.auth import AgentIdentity, AuthMode, extract_identity
from bifrost.config import BifrostConfig, ProviderConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SECRET = "test-secret-key-that-is-at-least-32-bytes-long!"


def _make_token(payload: dict) -> str:
    return jwt.encode(payload, _SECRET, algorithm="HS256")


def _make_request(headers: dict | None = None):
    """Create a minimal mock Request-like object."""
    from unittest.mock import MagicMock

    req = MagicMock()
    req.headers = headers or {}
    return req


def _make_config(auth_mode: AuthMode = AuthMode.OPEN, secret: str = "") -> BifrostConfig:
    return BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        auth_mode=auth_mode,
        pat_secret=secret,
    )


# ---------------------------------------------------------------------------
# Open mode
# ---------------------------------------------------------------------------


class TestOpenMode:
    def test_anonymous_when_no_headers(self):
        req = _make_request()
        identity = extract_identity(req, AuthMode.OPEN)
        assert identity.agent_id == "anonymous"
        assert identity.tenant_id == "default"

    def test_reads_agent_and_tenant_headers(self):
        req = _make_request(
            {
                "x-agent-id": "agent-xyz",
                "x-tenant-id": "tenant-abc",
                "x-session-id": "sess-1",
                "x-saga-id": "saga-2",
            }
        )
        identity = extract_identity(req, AuthMode.OPEN)
        assert identity.agent_id == "agent-xyz"
        assert identity.tenant_id == "tenant-abc"
        assert identity.session_id == "sess-1"
        assert identity.saga_id == "saga-2"

    def test_returns_agent_identity_type(self):
        req = _make_request()
        identity = extract_identity(req, AuthMode.OPEN)
        assert isinstance(identity, AgentIdentity)


# ---------------------------------------------------------------------------
# Mesh mode
# ---------------------------------------------------------------------------


class TestMeshMode:
    def test_reads_envoy_injected_headers(self):
        req = _make_request(
            {
                "x-agent-id": "mesh-agent",
                "x-tenant-id": "mesh-tenant",
                "x-session-id": "s",
                "x-saga-id": "sg",
            }
        )
        identity = extract_identity(req, AuthMode.MESH)
        assert identity.agent_id == "mesh-agent"
        assert identity.tenant_id == "mesh-tenant"
        assert identity.session_id == "s"
        assert identity.saga_id == "sg"

    def test_defaults_when_headers_absent(self):
        req = _make_request()
        identity = extract_identity(req, AuthMode.MESH)
        assert identity.agent_id == "anonymous"
        assert identity.tenant_id == "default"


# ---------------------------------------------------------------------------
# PAT mode
# ---------------------------------------------------------------------------


class TestPATMode:
    def test_valid_token_extracts_claims(self):
        token = _make_token({"sub": "agent-1", "tenant_id": "tenant-1"})
        req = _make_request({"authorization": f"Bearer {token}"})
        identity = extract_identity(req, AuthMode.PAT, _SECRET)
        assert identity.agent_id == "agent-1"
        assert identity.tenant_id == "tenant-1"

    def test_missing_bearer_raises_401(self):
        from fastapi import HTTPException

        req = _make_request({})
        with pytest.raises(HTTPException) as exc_info:
            extract_identity(req, AuthMode.PAT, _SECRET)
        assert exc_info.value.status_code == 401

    def test_invalid_token_raises_401(self):
        from fastapi import HTTPException

        req = _make_request({"authorization": "Bearer not-a-jwt"})
        with pytest.raises(HTTPException) as exc_info:
            extract_identity(req, AuthMode.PAT, _SECRET)
        assert exc_info.value.status_code == 401

    def test_wrong_secret_raises_401(self):
        from fastapi import HTTPException

        token = _make_token({"sub": "agent-1"})
        req = _make_request({"authorization": f"Bearer {token}"})
        with pytest.raises(HTTPException) as exc_info:
            extract_identity(req, AuthMode.PAT, "wrong-secret-that-is-at-least-32-bytes-long!")
        assert exc_info.value.status_code == 401

    def test_expired_token_raises_401(self):
        import time

        from fastapi import HTTPException

        token = _make_token({"sub": "agent-1", "exp": int(time.time()) - 10})
        req = _make_request({"authorization": f"Bearer {token}"})
        with pytest.raises(HTTPException) as exc_info:
            extract_identity(req, AuthMode.PAT, _SECRET)
        assert exc_info.value.status_code == 401

    def test_defaults_when_claims_absent(self):
        token = _make_token({})
        req = _make_request({"authorization": f"Bearer {token}"})
        identity = extract_identity(req, AuthMode.PAT, _SECRET)
        assert identity.agent_id == "anonymous"
        assert identity.tenant_id == "default"

    def test_reads_attribution_headers_alongside_jwt(self):
        token = _make_token({"sub": "ag"})
        req = _make_request(
            {
                "authorization": f"Bearer {token}",
                "x-session-id": "sess",
                "x-saga-id": "saga",
            }
        )
        identity = extract_identity(req, AuthMode.PAT, _SECRET)
        assert identity.session_id == "sess"
        assert identity.saga_id == "saga"


# ---------------------------------------------------------------------------
# Integration: auth mode wired into the app via TestClient
# ---------------------------------------------------------------------------


class TestAuthIntegration:
    """Verify the FastAPI app enforces the configured auth mode end-to-end."""

    def _client_with_pat(self) -> TestClient:
        cfg = _make_config(AuthMode.PAT, _SECRET)
        app = create_app(cfg)
        with patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as m:
            from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo

            m.return_value = AnthropicResponse(
                id="msg",
                content=[TextBlock(text="hi")],
                model="claude-sonnet-4-6",
                stop_reason="end_turn",
                usage=UsageInfo(input_tokens=5, output_tokens=2),
            )
            with TestClient(app, raise_server_exceptions=False) as c:
                yield c

    def test_pat_mode_rejects_missing_token(self):
        for client in self._client_with_pat():
            resp = client.post(
                "/v1/messages",
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
            assert resp.status_code == 401

    def test_pat_mode_accepts_valid_token(self):
        token = _make_token({"sub": "agent-test"})
        for client in self._client_with_pat():
            resp = client.post(
                "/v1/messages",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 10,
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
            assert resp.status_code == 200
