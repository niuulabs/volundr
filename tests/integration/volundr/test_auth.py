"""Integration tests for authentication and authorization behaviour."""

from __future__ import annotations

import httpx
import pytest

BASE = "/api/v1/volundr"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_health_no_auth(volundr_client: httpx.AsyncClient):
    """GET /health returns 200 without any auth headers."""
    resp = await volundr_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "healthy"}


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_auth_headers_propagate_principal(
    volundr_client: httpx.AsyncClient,
    auth_headers,
):
    """The x-auth-user-id header is used as the session owner."""
    user_id = "principal-check-user"
    headers = auth_headers(user_id=user_id, email="principal@test.com")

    resp = await volundr_client.post(
        f"{BASE}/sessions",
        json={"name": "auth-principal"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    session_id = resp.json()["id"]

    # Fetch with the same principal — should succeed
    get_resp = await volundr_client.get(
        f"{BASE}/sessions/{session_id}",
        headers=headers,
    )
    assert get_resp.status_code == 200

    # Fetch with a different principal — should be denied (403)
    other_headers = auth_headers(user_id="other-user", email="other@test.com")
    deny_resp = await volundr_client.get(
        f"{BASE}/sessions/{session_id}",
        headers=other_headers,
    )
    assert deny_resp.status_code == 403
